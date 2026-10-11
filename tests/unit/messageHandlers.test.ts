import { MessageHandlers } from '../../src/handlers/messageHandlers'

const emitMock = jest.fn().mockResolvedValue(undefined)

jest.mock('../../src/plugins/manager.ts', () => ({
  PluginManager: jest.fn().mockImplementation(() => ({
    emit: emitMock
  }))
}))

function createCountDrizzleMock(total: number) {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ count: total })
        }))
      }))
    }))
  }
}

function createGetByIdDrizzleMock(row: Record<string, unknown> | null) {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(row)
        }))
      }))
    }))
  }
}

function createCreateMessageDrizzleMock(defaultPriority: number) {
  let insertedValues: Record<string, unknown> | undefined

  const returning = jest.fn().mockImplementation(async () => [
    {
      id: 501,
      appId: 42,
      message: insertedValues?.message,
      title: insertedValues?.title,
      priority: insertedValues?.priority,
      date: '2026-04-03T12:00:00.000Z',
      extras: insertedValues?.extras ?? null
    }
  ])

  const values = jest.fn().mockImplementation((payload) => {
    insertedValues = payload
    return { returning }
  })

  const drizzle = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ userId: 7, defaultPriority })
        }))
      }))
    })),
    insert: jest.fn(() => ({
      values
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn().mockResolvedValue({})
      }))
    }))
  }

  return { drizzle, values }
}

function createPagedMessagesDrizzleMock(rows: Array<Record<string, unknown>>) {
  const executeMock = jest.fn().mockResolvedValue(rows)
  const limitMock = jest.fn().mockReturnValue({ execute: executeMock })
  const orderByMock = jest.fn().mockReturnValue({ limit: limitMock })
  const whereMock = jest.fn().mockReturnValue({ orderBy: orderByMock })
  const fromMock = jest.fn().mockReturnValue({ where: whereMock })
  const selectMock = jest.fn().mockReturnValue({ from: fromMock })

  return {
    drizzle: {
      select: selectMock
    },
    limitMock
  }
}

describe('MessageHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('getMessageCount returns the current user message count', async () => {
    const drizzle = createCountDrizzleMock(7)
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.getMessageCount(42)
    const body = await response.json() as { count: number }

    expect(response.status).toBe(200)
    expect(body).toEqual({ count: 7 })
  })

  test('getMessageById returns the canonical single-message shape', async () => {
    const drizzle = createGetByIdDrizzleMock({
      id: 101,
      appId: 42,
      message: 'hello',
      title: null,
      priority: null,
      date: '2026-02-27T10:00:00.000Z',
      extras: '{"scope":"test"}'
    })
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.getMessageById(7, '101')
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toEqual({
      id: 101,
      appid: 42,
      message: 'hello',
      title: '',
      priority: 0,
      date: '2026-02-27T10:00:00.000Z',
      extras: { scope: 'test' }
    })
  })

  test('getMessageById returns 400 for an invalid message id', async () => {
    const drizzle = {
      select: jest.fn()
    }
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.getMessageById(7, 'not-a-number')
    const body = await response.json() as { errorCode: number }

    expect(response.status).toBe(400)
    expect(body.errorCode).toBe(400)
    expect(drizzle.select).not.toHaveBeenCalled()
  })

  test('getMessageById returns 404 when the message does not belong to the current user', async () => {
    const drizzle = createGetByIdDrizzleMock(null)
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.getMessageById(7, '999')
    const body = await response.json() as { errorCode: number }

    expect(response.status).toBe(404)
    expect(body.errorCode).toBe(404)
  })

  test('createMessage inherits application defaultPriority when priority is omitted', async () => {
    const { drizzle, values } = createCreateMessageDrizzleMock(3)
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.createMessage(42, 'hello inherited priority')
    const body = await response.json() as { priority: number }

    expect(response.status).toBe(200)
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      priority: 3
    }))
    expect(body.priority).toBe(3)
  })

  test('createMessage keeps an explicit priority inside the supported Woe range', async () => {
    const { drizzle, values } = createCreateMessageDrizzleMock(3)
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.createMessage(42, 'hello explicit priority', 'notice', 2)
    const body = await response.json() as { priority: number }

    expect(response.status).toBe(200)
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      priority: 2
    }))
    expect(body.priority).toBe(2)
  })

  test('createMessage rejects priorities outside the Woe 0..3 range', async () => {
    const { drizzle } = createCreateMessageDrizzleMock(1)
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.createMessage(42, 'hello invalid priority', 'notice', 4)
    const body = await response.json() as { errorCode: number; errorDescription: string }

    expect(response.status).toBe(400)
    expect(body.errorCode).toBe(400)
    expect(body.errorDescription).toContain('0 and 3')
  })

  test('getAllMessages omits paging.next when result count is below limit', async () => {
    const { drizzle, limitMock } = createPagedMessagesDrizzleMock([
      {
        id: 11,
        userId: 7,
        appId: 42,
        message: 'm-11',
        title: 't-11',
        priority: 1,
        date: '2026-04-03T12:00:00.000Z',
        expires: null,
        extras: null
      }
    ])
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.getAllMessages(7, 2, 0)
    const body = await response.json() as {
      messages: Array<{ id: number }>
      paging: { size: number; limit: number; since: number; next?: string }
    }

    expect(response.status).toBe(200)
    expect(limitMock).toHaveBeenCalledWith(3)
    expect(body.messages).toHaveLength(1)
    expect(body.paging.size).toBe(1)
    expect(body.paging.since).toBe(0)
    expect(body.paging.next).toBeUndefined()
  })

  test('getAllMessages sets paging.next only when an extra row exists', async () => {
    const { drizzle, limitMock } = createPagedMessagesDrizzleMock([
      {
        id: 21,
        userId: 7,
        appId: 42,
        message: 'm-21',
        title: '',
        priority: 0,
        date: '2026-04-03T12:00:00.000Z',
        expires: null,
        extras: null
      },
      {
        id: 20,
        userId: 7,
        appId: 42,
        message: 'm-20',
        title: '',
        priority: 0,
        date: '2026-04-03T12:00:00.000Z',
        expires: null,
        extras: null
      },
      {
        id: 19,
        userId: 7,
        appId: 42,
        message: 'm-19',
        title: '',
        priority: 0,
        date: '2026-04-03T12:00:00.000Z',
        expires: null,
        extras: null
      }
    ])
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.getAllMessages(7, 2, 0)
    const body = await response.json() as {
      messages: Array<{ id: number }>
      paging: { size: number; limit: number; since: number; next?: string }
    }

    expect(response.status).toBe(200)
    expect(limitMock).toHaveBeenCalledWith(3)
    expect(body.messages).toHaveLength(2)
    expect(body.messages.map((message) => message.id)).toEqual([21, 20])
    expect(body.paging.size).toBe(2)
    expect(body.paging.since).toBe(20)
    expect(body.paging.next).toBe('/message?limit=2&since=20')
  })

  test('getApplicationMessages follows the same paging.next probe rule', async () => {
    const { drizzle, limitMock } = createPagedMessagesDrizzleMock([
      {
        id: 31,
        userId: 7,
        appId: 42,
        message: 'm-31',
        title: '',
        priority: 0,
        date: '2026-04-03T12:00:00.000Z',
        expires: null,
        extras: null
      },
      {
        id: 30,
        userId: 7,
        appId: 42,
        message: 'm-30',
        title: '',
        priority: 0,
        date: '2026-04-03T12:00:00.000Z',
        expires: null,
        extras: null
      }
    ])
    const handlers = new MessageHandlers(drizzle as any)

    const response = await handlers.getApplicationMessages(7, '42', 2, 0)
    const body = await response.json() as {
      messages: Array<{ id: number }>
      paging: { size: number; limit: number; since: number; next?: string }
    }

    expect(response.status).toBe(200)
    expect(limitMock).toHaveBeenCalledWith(3)
    expect(body.messages).toHaveLength(2)
    expect(body.paging.size).toBe(2)
    expect(body.paging.since).toBe(0)
    expect(body.paging.next).toBeUndefined()
  })

  describe('createMessage field defense (直接调用 handler 走同一字段校验)', () => {
    test.each([
      ['字符串 extras（绕过对象约束）', 'hello', undefined, undefined, 'text'],
      ['数字字符串 priority', 'hello', undefined, '2', undefined],
      ['小数 priority', 'hello', undefined, 2.5, undefined],
      ['非字符串 message', 123, undefined, undefined, undefined],
      ['布尔 message', true, undefined, undefined, undefined],
      ['数组 extras', 'hello', undefined, undefined, []]
    ])('createMessage(%s) => 400 且不查询不入库', async (_label, message, title, priority, extras) => {
      const drizzle = { select: jest.fn(), insert: jest.fn() }
      const handlers = new MessageHandlers(drizzle as any)

      const response = await handlers.createMessage(42, message as any, title as any, priority as any, extras as any)
      const body = await response.json() as { errorCode: number; errorDescription: string }

      expect(response.status).toBe(400)
      expect(body.errorCode).toBe(400)
      expect(drizzle.select).not.toHaveBeenCalled()
      expect(drizzle.insert).not.toHaveBeenCalled()
    })

    test('createMessage 防御不误伤合法调用：缺省 priority 走应用默认', async () => {
      const { drizzle, values } = createCreateMessageDrizzleMock(3)
      const handlers = new MessageHandlers(drizzle as any)

      const response = await handlers.createMessage(42, 'hello defense ok')

      expect(response.status).toBe(200)
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ priority: 3 }))
    })
  })

  describe('pagination defense (直接调用 handler 的非法分页也 400)', () => {
    test.each([
      ['limit NaN', Number.NaN, 0],
      ['limit 0', 0, 0],
      ['limit 201', 201, 0],
      ['limit 1.5', 1.5, 0],
      ['limit Infinity', Number.POSITIVE_INFINITY, 0],
      ['since NaN', 100, Number.NaN],
      ['since -1', 100, -1],
      ['since 1.5', 100, 1.5],
      ['since 超安全整数', 100, Number.MAX_SAFE_INTEGER + 1]
    ])('getAllMessages(%s) => 400 且不查询', async (_label, limit, since) => {
      const drizzle = { select: jest.fn() }
      const handlers = new MessageHandlers(drizzle as any)

      const response = await handlers.getAllMessages(7, limit, since)
      const body = await response.json() as { errorCode: number; errorDescription: string }

      expect(response.status).toBe(400)
      expect(body.errorCode).toBe(400)

      const limitInvalid = !(Number.isInteger(limit) && limit >= 1 && limit <= 200)
      if (limitInvalid) {
        expect(body.errorDescription).toContain('limit')
      } else {
        expect(body.errorDescription).toContain('since')
      }
      expect(drizzle.select).not.toHaveBeenCalled()
    })

    test.each([
      ['limit NaN', Number.NaN, 0],
      ['limit 0', 0, 0],
      ['limit 201', 201, 0],
      ['since NaN', 100, Number.NaN],
      ['since -1', 100, -1]
    ])('getApplicationMessages(%s) => 400 且不查询', async (_label, limit, since) => {
      const drizzle = { select: jest.fn() }
      const handlers = new MessageHandlers(drizzle as any)

      const response = await handlers.getApplicationMessages(7, '42', limit, since)
      const body = await response.json() as { errorCode: number; errorDescription: string }

      expect(response.status).toBe(400)
      expect(body.errorCode).toBe(400)
      expect(typeof body.errorDescription).toBe('string')
      expect(drizzle.select).not.toHaveBeenCalled()
    })

    test('handler 防御默认参数仍合法：getAllMessages(7) 走正常查询路径', async () => {
      const { drizzle } = createPagedMessagesDrizzleMock([])
      const handlers = new MessageHandlers(drizzle as any)

      const response = await handlers.getAllMessages(7)

      expect(response.status).toBe(200)
      expect(drizzle.select).toHaveBeenCalled()
    })
  })
})
