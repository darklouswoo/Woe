

















const emitMock = jest.fn().mockResolvedValue(undefined)

jest.mock('../../src/plugins/manager.ts', () => ({
  PluginManager: jest.fn().mockImplementation(() => ({
    emit: emitMock
  }))
}))

import { MessageHandlers } from '../../src/handlers/messageHandlers'
import { createMessageTestDb } from '../helpers/messageTestDb'
import { asDrizzle } from '../helpers/testDb'
import { applications, messages } from '../../src/models'
import { safeJsonParse } from '../../src/utils/response'

const USER = 7
const APP = 42


const MATRIX: Array<{
  id: number
  label: string
  raw: string | null
  expected: Record<string, unknown> | undefined
}> = [
  {
    id: 1,
    label: '合法对象（嵌套数组保留）',
    raw: '{"client::display":"dense","nested":{"list":[1,2,3]}}',
    expected: { 'client::display': 'dense', nested: { list: [1, 2, 3] } },
  },
  { id: 2, label: '合法空对象 {} 保留', raw: '{}', expected: {} },
  { id: 3, label: 'JSON null 字面量', raw: 'null', expected: undefined },
  { id: 4, label: '畸形 JSON', raw: 'not-json{', expected: undefined },
  { id: 5, label: '顶层数组', raw: '[1,2,3]', expected: undefined },
  { id: 6, label: '顶层字符串', raw: '"plain"', expected: undefined },
  { id: 7, label: '顶层数值', raw: '42', expected: undefined },
  { id: 8, label: '顶层 boolean', raw: 'true', expected: undefined },
  { id: 9, label: '空字符串', raw: '', expected: undefined },
  { id: 10, label: '纯空白', raw: '   ', expected: undefined },
  { id: 11, label: 'SQL NULL', raw: null, expected: undefined },
]


interface ResponseMessage {
  id: number
  extras?: unknown
}


function expectExtrasContract(
  actual: ResponseMessage,
  expected: Record<string, unknown> | undefined
): void {
  if (expected === undefined) {
    expect(Object.prototype.hasOwnProperty.call(actual, 'extras')).toBe(false)
  } else {
    expect(actual.extras).toEqual(expected)
  }
}


function makeFixture() {
  const testDb = createMessageTestDb()
  testDb.db
    .insert(applications)
    .values({ id: APP, userId: USER, token: 'extras-contract-app-token', name: 'Contract App' })
    .run()
  testDb.db
    .insert(messages)
    .values(
      MATRIX.map(({ id, raw }) => ({
        id,
        userid: USER,
        appid: APP,
        message: `m-${id}`,
        title: null,
        priority: 0,
        extras: raw,
      }))
    )
    .run()

  return {
    handlers: new MessageHandlers(asDrizzle(testDb)),

    rawExtras: () =>
      testDb.sqlite
        .prepare('SELECT id, extras FROM messages ORDER BY id')
        .all() as Array<{ id: number; extras: string | null }>,
  }
}


function makeCreateStub(returningExtras: string | null) {
  const returning = jest.fn().mockResolvedValue([
    {
      id: 901,
      appId: APP,
      message: 'm-create',
      title: 't-create',
      priority: 1,
      date: '2026-10-08T00:00:00.000Z',
      extras: returningExtras,
    },
  ])
  const values = jest.fn().mockReturnValue({ returning })

  const drizzle = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ userId: USER, defaultPriority: 0, name: 'Stub App' }),
        })),
      })),
    })),
    insert: jest.fn(() => ({ values })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn().mockResolvedValue({}),
      })),
    })),
  }

  const hub = { broadcast: jest.fn().mockResolvedValue(undefined) }
  return { drizzle, values, hub }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('契约矩阵 × 列表/详情读面（真实 SQLite）', () => {
  test('GET /message（getAllMessages）：全部矩阵行为一致', async () => {
    const fx = makeFixture()

    const body = await (await fx.handlers.getAllMessages(USER, 100, 0)).json()

    const byId = new Map(
      ((body as { messages: ResponseMessage[] }).messages || []).map((m) => [m.id, m])
    )
    for (const { id, expected } of MATRIX) {
      expect(byId.has(id)).toBe(true)
      expectExtrasContract(byId.get(id)!, expected)
    }
  })

  test('GET /application/:id/message（getApplicationMessages）：全部矩阵行为一致', async () => {
    const fx = makeFixture()

    const body = await (await fx.handlers.getApplicationMessages(USER, String(APP), 100, 0)).json()

    const byId = new Map(
      ((body as { messages: ResponseMessage[] }).messages || []).map((m) => [m.id, m])
    )
    for (const { id, expected } of MATRIX) {
      expect(byId.has(id)).toBe(true)
      expectExtrasContract(byId.get(id)!, expected)
    }
  })

  test.each(MATRIX)('GET /message/:id（getMessageById）：%s', async ({ id, expected }) => {
    const fx = makeFixture()

    const body = await (await fx.handlers.getMessageById(USER, String(id))).json()

    expect((body as ResponseMessage).id).toBe(id)
    expectExtrasContract(body as ResponseMessage, expected)
  })
})

describe('POST /message 创建响应与 WebSocket 广播（同一映射，可观察写入桩）', () => {
  test.each(MATRIX)('%s：响应体与 broadcast 载荷行为一致', async ({ label, raw, expected }) => {
    const { drizzle, hub } = makeCreateStub(raw)
    const handlers = new MessageHandlers(drizzle as any, hub as any)

    const response = await handlers.createMessage(APP, 'm-create', 't-create', 1)
    const body = await response.json()

    expect(response.status).toBe(200)
    expectExtrasContract(body as ResponseMessage, expected)


    expect(hub.broadcast).toHaveBeenCalledTimes(1)
    const broadcastPayload = hub.broadcast.mock.calls[0][1] as ResponseMessage
    if (expected === undefined) {
      expect(broadcastPayload.extras).toBeUndefined()
    } else {
      expect(broadcastPayload.extras).toEqual(expected)
    }
  })
})

describe('非破坏性读取（畸形存量原样留在库中）', () => {
  test('跑完所有读面后 extras 列与播种值逐字节一致（无回写/清洗）', async () => {
    const fx = makeFixture()

    await fx.handlers.getAllMessages(USER, 100, 0)
    await fx.handlers.getApplicationMessages(USER, String(APP), 100, 0)
    for (const { id } of MATRIX) {
      await fx.handlers.getMessageById(USER, String(id))
    }

    expect(fx.rawExtras()).toEqual(MATRIX.map(({ id, raw }) => ({ id, extras: raw })))
  })
})

describe('全局 safeJsonParse 不受影响（插件 capabilities 合法数组消费方）', () => {
  test('顶层数组仍透传、畸形仍回原文（仅消息读面收紧，全局解析器保持现状）', () => {
    expect(safeJsonParse('["ui","compress"]')).toEqual(['ui', 'compress'])
    expect(safeJsonParse('raw capabilities text')).toBe('raw capabilities text')
    expect(safeJsonParse('')).toBeUndefined()
  })
})
