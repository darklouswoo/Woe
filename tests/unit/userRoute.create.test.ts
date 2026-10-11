const mockRequireClient = jest.fn()
const mockHasCredentials = jest.fn()
const mockRequireElevatedAdmin = jest.fn()
const mockIsOrphanClientToken = jest.fn()
const mockCreateUser = jest.fn()

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ __name: 'drizzle-mock' }))
}))

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    requireClient: mockRequireClient,
    hasCredentials: mockHasCredentials,
    requireElevatedAdmin: mockRequireElevatedAdmin,
    isOrphanClientToken: mockIsOrphanClientToken
  }))
}))

jest.mock('../../src/handlers/userHandlers.ts', () => ({
  UserHandlers: jest.fn().mockImplementation(() => ({
    createUser: mockCreateUser
  }))
}))

import { user } from '../../src/routes/user'

describe('user route create', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHasCredentials.mockReturnValue(false)
    mockIsOrphanClientToken.mockResolvedValue(false)
    mockCreateUser.mockResolvedValue(
      new Response(JSON.stringify({ id: 1, name: 'alice', nickname: 'alice', email: 'needupdate@example.com', admin: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })

  test('rejects unauthenticated admin=true registration attempt with fixed 401 (never silently clamps)', async () => {
    mockRequireClient.mockResolvedValue(null)

    const response = await user.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'alice', pass: 'secret', admin: true })
      }),
      {
        DB: {} as any,
        REGISTRATION: 'true'
      } as any,
      {} as any
    )

    expect(response.status).toBe(401)
    const body: any = await response.json()
    expect(body.errorDescription).toBe('you are not allowed to create an admin user')
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  test('allows unauthenticated baseline registration when REGISTRATION=true and forces admin=false', async () => {
    mockRequireClient.mockResolvedValue(null)

    const response = await user.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'alice', pass: 'secret', admin: false })
      }),
      {
        DB: {} as any,
        REGISTRATION: 'true'
      } as any,
      {} as any
    )

    expect(response.status).toBe(200)
    expect(mockCreateUser).toHaveBeenCalledWith(
      'alice',
      'secret',
      false,
      undefined,
      undefined,
      undefined
    )
  })

  test('rejects app token credential attempts with 401', async () => {
    mockRequireClient.mockResolvedValue(null)
    mockHasCredentials.mockReturnValue(true)

    const response = await user.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': 'A-app-token'
        },
        body: JSON.stringify({ name: 'alice', pass: 'secret', admin: false })
      }),
      {
        DB: {} as any,
        REGISTRATION: 'true'
      } as any,
      {} as any
    )

    expect(response.status).toBe(401)
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  test('returns 401 for credentialed non-client auth when REGISTRATION=false', async () => {
    mockRequireClient.mockResolvedValue(null)
    mockHasCredentials.mockReturnValue(true)

    const response = await user.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': 'A-app-token'
        },
        body: JSON.stringify({ name: 'alice', pass: 'secret', admin: false })
      }),
      {
        DB: {} as any,
        REGISTRATION: 'false'
      } as any,
      {} as any
    )

    expect(response.status).toBe(401)
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  test('allows elevated admin creation with baseline body when registration is disabled', async () => {
    mockRequireClient.mockResolvedValue({
      tokenType: 'client',
      userId: 1,
      isAdmin: true,
      resourceId: 1
    })
    mockRequireElevatedAdmin.mockResolvedValue({
      tokenType: 'client',
      userId: 1,
      isAdmin: true,
      resourceId: 1
    })

    const response = await user.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bob', pass: 'secret', admin: true })
      }),
      {
        DB: {} as any,
        REGISTRATION: 'false'
      } as any,
      {} as any
    )

    expect(response.status).toBe(200)
    expect(mockCreateUser).toHaveBeenCalledWith(
      'bob',
      'secret',
      true,
      undefined,
      undefined,
      undefined
    )
  })

  test('requires elevation for authenticated admin creating users', async () => {
    mockRequireClient.mockResolvedValue({
      tokenType: 'client',
      userId: 1,
      isAdmin: true,
      resourceId: 1
    })
    mockRequireElevatedAdmin.mockResolvedValue(null)

    const response = await user.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bob', pass: 'secret', admin: false })
      }),
      {
        DB: {} as any,
        REGISTRATION: 'false'
      } as any,
      {} as any
    )

    expect(response.status).toBe(403)
    expect(mockCreateUser).not.toHaveBeenCalled()
  })


  describe('admin field normalization', () => {
    test('defaults omitted admin to false for anonymous registration when REGISTRATION=true', async () => {
      mockRequireClient.mockResolvedValue(null)

      const response = await user.fetch(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'alice', pass: 'secret' })
        }),
        {
          DB: {} as any,
          REGISTRATION: 'true'
        } as any,
        {} as any
      )

      expect(response.status).toBe(200)
      expect(mockCreateUser).toHaveBeenCalledTimes(1)

      expect(typeof mockCreateUser.mock.calls[0][2]).toBe('boolean')
      expect(mockCreateUser.mock.calls[0][2]).toBe(false)
      expect(mockCreateUser).toHaveBeenCalledWith(
        'alice',
        'secret',
        false,
        undefined,
        undefined,
        undefined
      )
    })

    test('normalizes null admin to false for anonymous registration when REGISTRATION=true', async () => {
      mockRequireClient.mockResolvedValue(null)

      const response = await user.fetch(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'alice', pass: 'secret', admin: null })
        }),
        {
          DB: {} as any,
          REGISTRATION: 'true'
        } as any,
        {} as any
      )

      expect(response.status).toBe(200)
      expect(mockCreateUser).toHaveBeenCalledTimes(1)
      expect(typeof mockCreateUser.mock.calls[0][2]).toBe('boolean')
      expect(mockCreateUser.mock.calls[0][2]).toBe(false)
      expect(mockCreateUser).toHaveBeenCalledWith(
        'alice',
        'secret',
        false,
        undefined,
        undefined,
        undefined
      )
    })

    test.each([
      ['string', 'true'],
      ['falsy string', 'false'],
      ['number', 1],
      ['number zero', 0],
      ['array', []],
      ['object', {}]
    ])('rejects %s admin with 400 and zero writes', async (_label, adminValue) => {
      mockRequireClient.mockResolvedValue(null)

      const response = await user.fetch(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'alice', pass: 'secret', admin: adminValue })
        }),
        {
          DB: {} as any,
          REGISTRATION: 'true'
        } as any,
        {} as any
      )

      expect(response.status).toBe(400)
      expect(mockCreateUser).not.toHaveBeenCalled()
    })

    test('still rejects anonymous creation when REGISTRATION=false even with omitted admin', async () => {
      mockRequireClient.mockResolvedValue(null)

      const response = await user.fetch(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'alice', pass: 'secret' })
        }),
        {
          DB: {} as any,
          REGISTRATION: 'false'
        } as any,
        {} as any
      )

      expect(response.status).toBe(401)
      expect(mockCreateUser).not.toHaveBeenCalled()
    })

    test('still rejects anonymous creation when boolean REGISTRATION=false even with omitted admin', async () => {
      mockRequireClient.mockResolvedValue(null)

      const response = await user.fetch(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'alice', pass: 'secret' })
        }),
        {
          DB: {} as any,
          REGISTRATION: false
        } as any,
        {} as any
      )

      expect(response.status).toBe(401)
      expect(mockCreateUser).not.toHaveBeenCalled()
    })

    test('allows elevated admin creation with explicit admin=false', async () => {
      mockRequireClient.mockResolvedValue({
        tokenType: 'client',
        userId: 1,
        isAdmin: true,
        resourceId: 1
      })
      mockRequireElevatedAdmin.mockResolvedValue({
        tokenType: 'client',
        userId: 1,
        isAdmin: true,
        resourceId: 1
      })

      const response = await user.fetch(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'carol', pass: 'secret', admin: false })
        }),
        {
          DB: {} as any,
          REGISTRATION: 'false'
        } as any,
        {} as any
      )

      expect(response.status).toBe(200)
      expect(mockCreateUser).toHaveBeenCalledTimes(1)
      expect(typeof mockCreateUser.mock.calls[0][2]).toBe('boolean')
      expect(mockCreateUser.mock.calls[0][2]).toBe(false)
      expect(mockCreateUser).toHaveBeenCalledWith(
        'carol',
        'secret',
        false,
        undefined,
        undefined,
        undefined
      )
    })
  })



  describe('REGISTRATION boolean 部署（F2）', () => {
    test('boolean true 匿名普通注册 → 200', async () => {
      mockRequireClient.mockResolvedValue(null)

      const response = await user.fetch(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'alice', pass: 'secret', admin: false })
        }),
        {
          DB: {} as any,
          REGISTRATION: true
        } as any,
        {} as any
      )

      expect(response.status).toBe(200)
      expect(mockCreateUser).toHaveBeenCalledTimes(1)
      expect(mockCreateUser).toHaveBeenCalledWith(
        'alice',
        'secret',
        false,
        undefined,
        undefined,
        undefined
      )
    })

    test('boolean true 匿名 admin=true → 401 且零调用 createUser', async () => {
      mockRequireClient.mockResolvedValue(null)

      const response = await user.fetch(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'alice', pass: 'secret', admin: true })
        }),
        {
          DB: {} as any,
          REGISTRATION: true
        } as any,
        {} as any
      )

      expect(response.status).toBe(401)
      const body: any = await response.json()
      expect(body.errorDescription).toBe('you are not allowed to create an admin user')
      expect(mockCreateUser).not.toHaveBeenCalled()
    })

    test('boolean false 匿名普通注册 → 401 且零调用 createUser', async () => {
      mockRequireClient.mockResolvedValue(null)

      const response = await user.fetch(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'alice', pass: 'secret', admin: false })
        }),
        {
          DB: {} as any,
          REGISTRATION: false
        } as any,
        {} as any
      )

      expect(response.status).toBe(401)
      expect(mockCreateUser).not.toHaveBeenCalled()
    })
  })
})
