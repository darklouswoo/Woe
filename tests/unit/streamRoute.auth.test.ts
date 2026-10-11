const mockRequireClient = jest.fn()
const mockUpdateLastUsed = jest.fn()
const mockConnect = jest.fn().mockResolvedValue(new Response(null, { status: 200 }))

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ __name: 'drizzle-mock' }))
}))

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    requireClient: mockRequireClient
  }))
}))

jest.mock('../../src/handlers/clientHandlers.ts', () => ({
  ClientHandlers: jest.fn().mockImplementation(() => ({
    updateLastUsed: mockUpdateLastUsed
  }))
}))

jest.mock('../../src/services/messageStreamHub.ts', () => ({
  DurableObjectMessageStreamHub: jest.fn().mockImplementation(() => ({
    connect: mockConnect
  }))
}))

import { stream } from '../../src/routes/stream'

describe('stream route auth', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('rejects app token for GET /stream', async () => {
    mockRequireClient.mockResolvedValue(null)

    const response = await stream.fetch(
      new Request('http://localhost/', {
        method: 'GET',
        headers: {
          'x-gotify-key': 'A-app-token'
        }
      }),
      {
        DB: {} as any,
        MESSAGE_STREAM_HUB: {} as any
      } as any,
      {} as any
    )

    expect(response.status).toBe(401)
    expect(mockUpdateLastUsed).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
  })

  test('forwards authenticated client resourceId to stream hub', async () => {
    mockRequireClient.mockResolvedValue({ userId: 9, tokenType: 'client', resourceId: 12 })

    const response = await stream.fetch(
      new Request('http://localhost/', {
        method: 'GET',
        headers: { Upgrade: 'websocket', 'x-gotify-key': 'C-client-token' }
      }),
      { DB: {} as any, MESSAGE_STREAM_HUB: {} as any } as any,
      {} as any
    )

    expect(response.status).toBe(200)
    expect(mockConnect).toHaveBeenCalledWith(9, 12, expect.any(Request), undefined)
  })

  test('client token 认证携带绑定快照：userId/clientId/clientTokenLookup 传给 hub', async () => {
    mockRequireClient.mockResolvedValue({
      userId: 9,
      tokenType: 'client',
      resourceId: 12,
      clientId: 12,
      clientTokenLookup: 'Cdb-public-form'
    })

    const response = await stream.fetch(
      new Request('http://localhost/', {
        method: 'GET',
        headers: { Upgrade: 'websocket', 'x-gotify-key': 'C-client-private-form' }
      }),
      { DB: {} as any, MESSAGE_STREAM_HUB: {} as any } as any,
      {} as any
    )

    expect(response.status).toBe(200)

    expect(mockConnect).toHaveBeenCalledWith(9, 12, expect.any(Request), {
      userId: 9,
      clientId: 12,
      tokenLookup: 'Cdb-public-form'
    })
  })

  test('Basic 认证（无 client 上下文）：不绑定、不参与续期，连接功能保持', async () => {
    mockRequireClient.mockResolvedValue({ userId: 9, tokenType: 'client' })

    const response = await stream.fetch(
      new Request('http://localhost/', {
        method: 'GET',
        headers: { Upgrade: 'websocket', authorization: 'Basic dXNlcjpwYXNz' }
      }),
      { DB: {} as any, MESSAGE_STREAM_HUB: {} as any } as any,
      {} as any
    )

    expect(response.status).toBe(200)
    expect(mockConnect).toHaveBeenCalledWith(9, undefined, expect.any(Request), undefined)
  })
})
