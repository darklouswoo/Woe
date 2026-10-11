











jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

jest.mock('../../src/middleware/auth.ts', () => ({
  hashPassword: jest.fn(async (pass: string) => `hashed:${pass}`),
  randomTokenString: jest.fn((len: number) => 'r'.repeat(len)),
  TOKEN_RANDOM_LENGTH: 22
}))

import { UserHandlers } from '../../src/handlers/userHandlers'


function createUserDrizzleMock(getResult: unknown) {
  const getMock = jest.fn().mockResolvedValue(getResult)
  const drizzle = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ get: getMock }))
      }))
    }))
  }
  return { drizzle, getMock }
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'alice',
    nickname: 'Alice',
    email: 'alice@example.com',
    avatar: null,
    description: null,
    admin: 0,
    disabled: 0,
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

describe('GET /current/user V3 会话字段序列化（CurrentUserExternal）', () => {
  test('client token + 未过期提升：clientId 与 elevatedUntil 均返回', async () => {
    const { drizzle } = createUserDrizzleMock(userRow())
    const handlers = new UserHandlers(drizzle as any)
    const elevatedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')

    const response = await handlers.getCurrentUser(7, { clientId: 5, elevatedUntil })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.clientId).toBe(5)
    expect(body.elevatedUntil).toBe(elevatedUntil)
    expect(body.elevatedUntil).toMatch(RFC3339)

    expect(body).toMatchObject({
      id: 7,
      name: 'alice',
      nickname: 'Alice',
      admin: false,
      disabled: false,
      createdAt: '2026-10-05T08:30:00Z'
    })
  })

  test('client token + 已过期提升：clientId 返回，elevatedUntil 省略', async () => {
    const { drizzle } = createUserDrizzleMock(userRow())
    const handlers = new UserHandlers(drizzle as any)
    const expired = new Date(Date.now() - 60 * 1000).toISOString()

    const response = await handlers.getCurrentUser(7, { clientId: 5, elevatedUntil: expired })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.clientId).toBe(5)
    expect('elevatedUntil' in body).toBe(false)
  })

  test('client token + 无提升记录（NULL）：clientId 返回，elevatedUntil 省略', async () => {
    const { drizzle } = createUserDrizzleMock(userRow())
    const handlers = new UserHandlers(drizzle as any)

    const nullRes = await handlers.getCurrentUser(7, { clientId: 5, elevatedUntil: null })
    const nullBody = await nullRes.json() as Record<string, unknown>
    expect(nullRes.status).toBe(200)
    expect(nullBody.clientId).toBe(5)
    expect('elevatedUntil' in nullBody).toBe(false)

    const undefRes = await handlers.getCurrentUser(7, { clientId: 5 })
    const undefBody = await undefRes.json() as Record<string, unknown>
    expect(undefRes.status).toBe(200)
    expect(undefBody.clientId).toBe(5)
    expect('elevatedUntil' in undefBody).toBe(false)
  })

  test('Basic auth（无 client 会话上下文）：clientId 与 elevatedUntil 均省略', async () => {
    const { drizzle } = createUserDrizzleMock(userRow())
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.getCurrentUser(7)
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect('clientId' in body).toBe(false)
    expect('elevatedUntil' in body).toBe(false)

    expect(body).toMatchObject({ id: 7, name: 'alice', createdAt: '2026-10-05T08:30:00Z' })
  })

  test('提升恰好到期（== now 边界）：elevatedUntil 省略（V3 now.Before 语义）', async () => {
    const { drizzle } = createUserDrizzleMock(userRow())
    const handlers = new UserHandlers(drizzle as any)

    const justExpired = new Date(Date.now() - 1).toISOString()

    const response = await handlers.getCurrentUser(7, { clientId: 5, elevatedUntil: justExpired })
    const body = await response.json() as Record<string, unknown>

    expect(body.clientId).toBe(5)
    expect('elevatedUntil' in body).toBe(false)
  })
})
