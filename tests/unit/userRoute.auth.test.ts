const mockRequireClient = jest.fn()
const mockHasCredentials = jest.fn()
const mockRequireElevatedAdmin = jest.fn()
const mockIsOrphanClientToken = jest.fn()
const mockGetAllUsers = jest.fn()
const mockGetUser = jest.fn()
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
    getAllUsers: mockGetAllUsers,
    getUser: mockGetUser,
    createUser: mockCreateUser
  }))
}))

import { user } from '../../src/routes/user'

describe('user route auth', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHasCredentials.mockReturnValue(false)
    mockIsOrphanClientToken.mockResolvedValue(false)
    mockGetAllUsers.mockResolvedValue(
      new Response(JSON.stringify([{ id: 1, name: 'admin' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    mockGetUser.mockResolvedValue(
      new Response(JSON.stringify({ id: 8, name: 'me' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    mockCreateUser.mockResolvedValue(
      new Response(JSON.stringify({ id: 9, name: 'eve', admin: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })

  test('returns 401 when GET /user is unauthenticated', async () => {
    mockRequireClient.mockResolvedValue(null)

    const response = await user.fetch(
      new Request('http://localhost/', { method: 'GET' }),
      {
        DB: {} as any
      } as any,
      {} as any
    )

    expect(response.status).toBe(401)
    expect(mockGetAllUsers).not.toHaveBeenCalled()
  })

  test('rejects app token for GET /user even if the owning user is admin', async () => {
    mockRequireClient.mockResolvedValue(null)
    mockHasCredentials.mockReturnValue(true)

    const response = await user.fetch(
      new Request('http://localhost/', {
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
    expect(mockGetAllUsers).not.toHaveBeenCalled()
  })

  test('returns 403 for authenticated non-admin client token on GET /user', async () => {
    mockRequireClient.mockResolvedValue({
      tokenType: 'client',
      userId: 8,
      isAdmin: false,
      resourceId: 4
    })

    const response = await user.fetch(
      new Request('http://localhost/', {
        method: 'GET',
        headers: {
          'x-gotify-key': 'C-client-token'
        }
      }),
      {
        DB: {} as any
      } as any,
      {} as any
    )

    expect(response.status).toBe(403)
    expect(mockGetAllUsers).not.toHaveBeenCalled()
  })


  test('returns 403 for authenticated non-admin client token on POST /user with omitted admin', async () => {
    mockRequireClient.mockResolvedValue({
      tokenType: 'client',
      userId: 8,
      isAdmin: false,
      resourceId: 4
    })

    const response = await user.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': 'C-client-token'
        },
        body: JSON.stringify({ name: 'eve', pass: 'secret' })
      }),
      {
        DB: {} as any,
        REGISTRATION: 'true'
      } as any,
      {} as any
    )

    expect(response.status).toBe(403)
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  test.each(['abc', '0', '-1'])('returns 400 for invalid /user/%s id', async (id) => {
    mockRequireClient.mockResolvedValue({
      tokenType: 'client',
      userId: 8,
      isAdmin: false,
      resourceId: 4
    })

    const response = await user.fetch(
      new Request(`http://localhost/${id}`, {
        method: 'GET',
        headers: {
          'x-gotify-key': 'C-client-token'
        }
      }),
      {
        DB: {} as any
      } as any,
      {} as any
    )

    expect(response.status).toBe(400)
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})
