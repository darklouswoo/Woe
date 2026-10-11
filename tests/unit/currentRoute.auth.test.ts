const mockRequireClient = jest.fn()
const mockRequireElevatedClient = jest.fn()
const mockGetCurrentUser = jest.fn()
const mockUpdateCurrentUserPassword = jest.fn()

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ __name: 'drizzle-mock' }))
}))

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    requireClient: mockRequireClient,
    requireElevatedClient: mockRequireElevatedClient
  })),

  SESSION_NOT_ELEVATED_MESSAGE: 'session not elevated, use basic auth or call /client:elevate'
}))

jest.mock('../../src/handlers/userHandlers.ts', () => ({
  UserHandlers: jest.fn().mockImplementation(() => ({
    getCurrentUser: mockGetCurrentUser,
    updateCurrentUserPassword: mockUpdateCurrentUserPassword
  }))
}))

import { current } from '../../src/routes/current'

describe('current route auth and password contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCurrentUser.mockResolvedValue(
      new Response(JSON.stringify({ id: 7, name: 'alice' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    mockUpdateCurrentUserPassword.mockResolvedValue(new Response(null, { status: 200 }))
  })

  test('threads client identity to getCurrentUser for client token auth (V3 clientId/elevatedUntil)', async () => {
    mockRequireClient.mockResolvedValue({
      tokenType: 'client',
      userId: 7,
      isAdmin: false,
      resourceId: 5,
      clientId: 5,
      elevatedUntil: '2026-10-05T12:00:00.000Z'
    })

    const response = await current.fetch(
      new Request('http://localhost/user', {
        method: 'GET',
        headers: { 'x-gotify-key': 'C-client-token' }
      }),
      { DB: {} as any } as any,
      {} as any
    )

    expect(response.status).toBe(200)
    expect(mockGetCurrentUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ clientId: 5, elevatedUntil: '2026-10-05T12:00:00.000Z' })
    )
  })

  test('Basic auth threads no client identity to getCurrentUser (V3 omit semantics)', async () => {
    mockRequireClient.mockResolvedValue({ tokenType: 'client', userId: 7, isAdmin: true })

    const response = await current.fetch(
      new Request('http://localhost/user', {
        method: 'GET',
        headers: { authorization: 'Basic YWxpY2U6c2VjcmV0' }
      }),
      { DB: {} as any } as any,
      {} as any
    )

    expect(response.status).toBe(200)
    expect(mockGetCurrentUser).toHaveBeenCalledWith(
      7,
      expect.not.objectContaining({ clientId: expect.anything() })
    )
  })

  test('rejects app token for GET /current/user', async () => {
    mockRequireClient.mockResolvedValue(null)

    const response = await current.fetch(
      new Request('http://localhost/user', {
        method: 'GET',
        headers: {
          'x-gotify-key': 'A-app-token'
        }
      }),
      {
        DB: {} as any
      } as any,
      {} as any
    )

    expect(response.status).toBe(401)
    expect(mockGetCurrentUser).not.toHaveBeenCalled()
  })

  test('accepts Gotify password payload { pass } for an elevated client session', async () => {
    mockRequireElevatedClient.mockResolvedValue({
      tokenType: 'client',
      userId: 7,
      isAdmin: false,
      resourceId: 8
    })

    const response = await current.fetch(
      new Request('http://localhost/user/password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': 'C-client-token'
        },
        body: JSON.stringify({ pass: 'new-secret' })
      }),
      {
        DB: {} as any
      } as any,
      {} as any
    )

    expect(response.status).toBe(200)
    expect(mockUpdateCurrentUserPassword).toHaveBeenCalledWith(7, 'new-secret')
  })

  test('rejects non-elevated session for POST /current/user/password with gotify 403', async () => {
    mockRequireElevatedClient.mockResolvedValue(null)

    const response = await current.fetch(
      new Request('http://localhost/user/password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': 'A-app-token'
        },
        body: JSON.stringify({ pass: 'new-secret' })
      }),
      {
        DB: {} as any
      } as any,
      {} as any
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden',
      errorCode: 403,
      errorDescription: 'session not elevated, use basic auth or call /client:elevate'
    })
    expect(mockUpdateCurrentUserPassword).not.toHaveBeenCalled()
  })
})
