














const mockRequireClient = jest.fn()
const mockLogoutClient = jest.fn()
const mockDisconnectClient = jest.fn()

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
    logoutClient: mockLogoutClient
  }))
}))

jest.mock('../../src/services/messageStreamHub.ts', () => ({
  DurableObjectMessageStreamHub: jest.fn().mockImplementation(() => ({
    disconnectClient: mockDisconnectClient
  }))
}))

import { auth } from '../../src/routes/auth'
import { ClientHandlers } from '../../src/handlers/clientHandlers'

const MockedClientHandlers = ClientHandlers as unknown as jest.Mock

const CLIENT_TOKEN_SNAPSHOT = 'CrouteSnapshot1'


function clientTokenInfo(overrides: Record<string, unknown> = {}) {
  return {
    userId: 7,
    isAdmin: false,
    tokenType: 'client' as const,
    resourceId: 5,
    clientId: 5,
    elevatedUntil: null,
    clientTokenLookup: CLIENT_TOKEN_SNAPSHOT,
    ...overrides
  }
}

function makeEnv(withHub = true) {
  const env: Record<string, unknown> = { DB: { __rawDb: true } }
  if (withHub) env.MESSAGE_STREAM_HUB = { __hub: true }
  return env as any
}

function logoutRequest(url = 'http://localhost/auth/logout', init: RequestInit = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'x-gotify-key': CLIENT_TOKEN_SNAPSHOT },
    ...init
  })
}

describe('POST /auth/logout route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequireClient.mockResolvedValue(clientTokenInfo())
    mockLogoutClient.mockResolvedValue({ ok: true, revoked: true })
    mockDisconnectClient.mockResolvedValue(undefined)
  })

  test('non-elevated client token threads triple snapshot to logoutClient and disconnects stream', async () => {

    mockRequireClient.mockResolvedValue(
      clientTokenInfo({ elevatedUntil: '2020-01-01T00:00:00.000Z' })
    )
    const env = makeEnv()

    const response = await auth.fetch(logoutRequest(), env, {} as any)

    expect(response.status).toBe(200)

    expect(mockLogoutClient).toHaveBeenCalledWith(7, 5, CLIENT_TOKEN_SNAPSHOT)

    expect(MockedClientHandlers).toHaveBeenCalledTimes(1)
    expect(MockedClientHandlers).toHaveBeenCalledWith(expect.anything(), env.DB)

    expect(mockDisconnectClient).toHaveBeenCalledTimes(1)
    expect(mockDisconnectClient).toHaveBeenCalledWith(7, 5)
  })

  test('Basic auth (no client context) returns 403 with verbatim description and no side effects', async () => {
    mockRequireClient.mockResolvedValue({ userId: 7, isAdmin: true, tokenType: 'client' })

    const response = await auth.fetch(logoutRequest(), makeEnv(), {} as any)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden',
      errorCode: 403,
      errorDescription: 'no client auth provided'
    })
    expect(mockLogoutClient).not.toHaveBeenCalled()
    expect(mockDisconnectClient).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('invalid or app token (requireClient null) returns 401 with verbatim gotify description', async () => {
    mockRequireClient.mockResolvedValue(null)

    const response = await auth.fetch(logoutRequest(), makeEnv(), {} as any)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
      errorCode: 401,
      errorDescription:
        'you need to provide a valid access token or user credentials to access this api'
    })
    expect(mockLogoutClient).not.toHaveBeenCalled()
    expect(mockDisconnectClient).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('clientId present but clientTokenLookup missing returns 500 and never falls back to id-only delete', async () => {
    mockRequireClient.mockResolvedValue({
      userId: 7,
      isAdmin: false,
      tokenType: 'client',
      clientId: 5
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await auth.fetch(logoutRequest(), makeEnv(), {} as any)

    expect(response.status).toBe(500)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.errorCode).toBe(500)
    expect(typeof body.errorDescription).toBe('string')
    expect(mockLogoutClient).not.toHaveBeenCalled()
    expect(mockDisconnectClient).not.toHaveBeenCalled()

    expect(errorSpy).toHaveBeenCalled()
    for (const callArgs of errorSpy.mock.calls) {
      const text = callArgs.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
      expect(text).not.toContain(CLIENT_TOKEN_SNAPSHOT)
    }
    errorSpy.mockRestore()
  })

  test('spoofed clientId in query or body does not change the revocation target', async () => {
    const response = await auth.fetch(
      logoutRequest('http://localhost/auth/logout?clientId=999', {
        headers: {
          'x-gotify-key': CLIENT_TOKEN_SNAPSHOT,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ clientId: 888 })
      }),
      makeEnv(),
      {} as any
    )

    expect(response.status).toBe(200)

    expect(mockLogoutClient).toHaveBeenCalledWith(7, 5, CLIENT_TOKEN_SNAPSHOT)
    expect(mockLogoutClient).toHaveBeenCalledTimes(1)
    expect(mockDisconnectClient).toHaveBeenCalledWith(7, 5)
  })

  test('revoked=true returns 200 {} and disconnects the client stream', async () => {
    mockLogoutClient.mockResolvedValue({ ok: true, revoked: true })

    const response = await auth.fetch(logoutRequest(), makeEnv(), {} as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expect(mockDisconnectClient).toHaveBeenCalledWith(7, 5)
  })

  test('revoked=false (credential already deleted or rotated) returns 200 without disconnect', async () => {
    mockLogoutClient.mockResolvedValue({ ok: true, revoked: false })

    const response = await auth.fetch(logoutRequest(), makeEnv(), {} as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})

    expect(mockDisconnectClient).not.toHaveBeenCalled()
  })

  test('handler failure response passes through without stream disconnect', async () => {
    mockLogoutClient.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({
          error: 'Database error',
          errorCode: 500,
          errorDescription: 'Failed to logout'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    })

    const response = await auth.fetch(logoutRequest(), makeEnv(), {} as any)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Database error',
      errorCode: 500,
      errorDescription: 'Failed to logout'
    })
    expect(mockDisconnectClient).not.toHaveBeenCalled()
  })

  test('DO disconnectClient rejection still yields 200 with observable credential-free error log', async () => {
    mockDisconnectClient.mockRejectedValue(new Error('DO unavailable'))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await auth.fetch(logoutRequest(), makeEnv(), {} as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})

    expect(errorSpy).toHaveBeenCalled()
    const logged = errorSpy.mock.calls
      .map((callArgs) =>
        callArgs.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
      )
      .join('\n')
    expect(logged).toContain('disconnect')
    expect(logged).not.toContain(CLIENT_TOKEN_SNAPSHOT)
    expect(logged).not.toContain('/auth/logout')
    errorSpy.mockRestore()
  })

  test('missing MESSAGE_STREAM_HUB binding skips stream disconnect and still returns 200', async () => {
    const response = await auth.fetch(logoutRequest(), makeEnv(false), {} as any)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expect(mockDisconnectClient).not.toHaveBeenCalled()
    const { DurableObjectMessageStreamHub } = jest.requireMock(
      '../../src/services/messageStreamHub.ts'
    )
    expect(DurableObjectMessageStreamHub).not.toHaveBeenCalled()
  })

  test('success response carries no Set-Cookie header and no credential fields', async () => {
    const response = await auth.fetch(logoutRequest(), makeEnv(), {} as any)

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    const body = (await response.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('token')
    expect(body).not.toHaveProperty('clientTokenLookup')
    expect(JSON.stringify(body)).not.toContain(CLIENT_TOKEN_SNAPSHOT)
  })
})
