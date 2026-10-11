







jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { ApplicationHandlers } from '../../src/handlers/applicationHandlers'
import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { UserHandlers } from '../../src/handlers/userHandlers'


function createApplicationDrizzleMock(rows: Array<Record<string, unknown>>) {
  const orderByMock = jest.fn().mockResolvedValue(rows)
  const getMock = jest.fn().mockResolvedValue(rows[0])
  const returningMock = jest.fn().mockImplementation(async () => rows.slice(0, 1))
  const drizzle = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ orderBy: orderByMock, get: getMock }))
      }))
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({ returning: returningMock }))
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve({ meta: { changes: 1 } }))
      }))
    }))
  }
  return { drizzle, orderByMock, getMock }
}


function createRegenerateDrizzleMock(existingApp: Record<string, unknown> | null) {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ get: jest.fn().mockResolvedValue(existingApp) }))
      }))
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve({ meta: { changes: 1 } }))
      }))
    }))
  }
}


function createClientDrizzleMock(rows: Array<Record<string, unknown>>) {
  const orderByMock = jest.fn().mockResolvedValue(rows)
  const getMock = jest.fn().mockResolvedValue(rows[0])
  const returningMock = jest.fn().mockImplementation(async () => rows.slice(0, 1))
  const drizzle = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ orderBy: orderByMock, get: getMock }))
      }))
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({ returning: returningMock }))
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({ returning: returningMock }))
      }))
    }))
  }
  return { drizzle, orderByMock, getMock }
}


function createUserDrizzleMock(rows: Array<Record<string, unknown>>) {
  const orderByMock = jest.fn().mockResolvedValue(rows)
  const getMock = jest.fn().mockResolvedValue(rows[0])
  const drizzle = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ orderBy: orderByMock, get: getMock }))
      }))
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({ returning: jest.fn().mockImplementation(async () => rows.slice(0, 1)) }))
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({ returning: jest.fn().mockImplementation(async () => rows.slice(0, 1)) }))
      }))
    }))
  }
  return { drizzle }
}

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 7,
    token: 'A-app-token',
    name: 'App A',
    sortKey: 'a',
    description: '',
    defaultPriority: 0,
    image: '',
    internal: false,
    lastUsed: null,
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}

function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    userId: 7,
    token: 'C-client-token',
    name: 'Pixel 9',
    platform: 'test-platform',
    deviceUid: null,
    deviceToken: null,
    tokenUpdatedAt: null,
    tokenStatus: 'active',
    appVersion: null,
    deviceModel: null,
    lastUsed: null,
    elevatedUntil: null,
    expiresAfterInactivitySeconds: 0,
    expiresAt: null,
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}

describe('token visibility（后端半：读响应置空 token）', () => {
  describe('GET 读响应 token 恒为空字符串（字段保留）', () => {
    test('GET /application 列表 token 全部为空字符串', async () => {
      const { drizzle } = createApplicationDrizzleMock([
        applicationRow(),
        applicationRow({ id: 2, token: 'A-app-token-2', name: 'App B' })
      ])
      const handlers = new ApplicationHandlers(drizzle as any)

      const response = await handlers.getAllApplications(7)
      const body = await response.json() as Array<Record<string, unknown>>

      expect(response.status).toBe(200)
      expect(body).toHaveLength(2)
      expect(body.every(app => app.token === '')).toBe(true)

      expect(body[0]).toHaveProperty('token', '')
    })

    test('GET /application/:id token 为空字符串', async () => {
      const { drizzle } = createApplicationDrizzleMock([applicationRow()])
      const handlers = new ApplicationHandlers(drizzle as any)

      const response = await handlers.getApplication(7, '1')
      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('token', '')
    })

    test('GET /client 列表 token 全部为空字符串', async () => {
      const { drizzle } = createClientDrizzleMock([
        clientRow(),
        clientRow({ id: 12, token: 'C-client-token-2', name: 'Pixel 9 Pro' })
      ])
      const handlers = new ClientHandlers(drizzle as any)

      const response = await handlers.getAllClients(7)
      const body = await response.json() as Array<Record<string, unknown>>

      expect(response.status).toBe(200)
      expect(body).toHaveLength(2)
      expect(body.every(client => client.token === '')).toBe(true)
      expect(body[0]).toHaveProperty('token', '')
    })

    test('GET /client/:id token 为空字符串', async () => {
      const { drizzle } = createClientDrizzleMock([clientRow()])
      const handlers = new ClientHandlers(drizzle as any)

      const response = await handlers.getClient(7, '11')
      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(body).toHaveProperty('token', '')
    })

    test('GET /user/:id/applications 中 token 全部为空字符串', async () => {
      const { drizzle } = createUserDrizzleMock([
        applicationRow(),
        applicationRow({ id: 2, token: 'A-app-token-2', name: 'App B' })
      ])
      const handlers = new UserHandlers(drizzle as any)

      const response = await handlers.getUserApplications(7)
      const body = await response.json() as Array<Record<string, unknown>>

      expect(response.status).toBe(200)
      expect(body).toHaveLength(2)
      expect(body.every(app => app.token === '')).toBe(true)
      expect(body[0]).toHaveProperty('token', '')
    })

    test('GET /user/:id/clients 中 token 全部为空字符串', async () => {
      const { drizzle } = createUserDrizzleMock([
        clientRow(),
        clientRow({ id: 12, token: 'C-client-token-2', name: 'Pixel 9 Pro' })
      ])
      const handlers = new UserHandlers(drizzle as any)

      const response = await handlers.getUserClients(7)
      const body = await response.json() as Array<Record<string, unknown>>

      expect(response.status).toBe(200)
      expect(body).toHaveLength(2)
      expect(body.every(client => client.token === '')).toBe(true)
      expect(body[0]).toHaveProperty('token', '')
    })
  })

  describe('创建与轮换响应仍携带真实 token（回归保护）', () => {
    test('POST /application 响应含真实 token（privateForm 一次性可见）', async () => {
      const { drizzle } = createApplicationDrizzleMock([applicationRow()])
      const handlers = new ApplicationHandlers(drizzle as any)

      const response = await handlers.createApplication(7, 'App A')
      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)

      expect(body.token).toMatch(/^gtfya\.[A-Za-z0-9\-_]{43}$/)
    })

    test('POST /client 响应含真实 token（privateForm 一次性可见）', async () => {
      const { drizzle } = createClientDrizzleMock([clientRow()])
      const handlers = new ClientHandlers(drizzle as any)

      const response = await handlers.createClient(7, 'Pixel 9')
      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(body.token).toMatch(/^gtfyc\.[A-Za-z0-9\-_]{43}$/)
    })

    test('PUT /application/:id/security 轮换响应含真实新 token（privateForm）', async () => {
      const drizzle = createRegenerateDrizzleMock({ id: 1 })
      const handlers = new ApplicationHandlers(drizzle as any)

      const response = await handlers.regenerateApplicationToken(7, '1')
      const body = await response.json() as { regenerateToken: { token: string } }

      expect(response.status).toBe(200)
      expect(body.regenerateToken.token).toMatch(/^gtfya\.[A-Za-z0-9\-_]{43}$/)
    })
  })
})
