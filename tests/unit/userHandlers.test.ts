jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

const mockHashPassword = jest.fn(async (pass: string) => `hashed:${pass}`)

jest.mock('../../src/middleware/auth.ts', () => ({
  hashPassword: mockHashPassword
}))

import { UserHandlers } from '../../src/handlers/userHandlers'

function createUserListDrizzleMock(rows: Array<Record<string, unknown>>) {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn().mockResolvedValue(rows)
        }))
      }))
    }))
  }
}

function createUserCreateDrizzleMock() {
  let insertedValues: Record<string, unknown> | undefined

  const returning = jest.fn().mockImplementation(async () => [
    {
      id: 2,
      name: insertedValues?.name,
      nickname: insertedValues?.nickname,
      email: insertedValues?.email,
      avatar: null,
      description: insertedValues?.description ?? null,
      admin: insertedValues?.admin,
      disabled: false
    }
  ])

  const values = jest.fn().mockImplementation((payload: Record<string, unknown>) => {
    insertedValues = payload
    return { returning }
  })


  const selectGet = jest.fn(async () => undefined)
  const select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({ get: selectGet }))
    }))
  }))

  return {
    drizzle: {
      insert: jest.fn(() => ({ values })),
      select
    },
    values,
    select,
    selectGet
  }
}

describe('UserHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('getAllUsers maps active users into API shape', async () => {
    const drizzle = createUserListDrizzleMock([
      {
        id: 1,
        name: 'alice',
        nickname: '',
        email: 'alice@example.com',
        avatar: null,
        description: 'owner',
        admin: 1,
        disabled: 0,
        createdAt: '2026-01-02 03:04:05'
      }
    ])
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.getAllUsers()
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body).toEqual([
      {
        id: 1,
        name: 'alice',
        nickname: 'alice',
        email: 'alice@example.com',
        avatar: null,
        description: 'owner',
        admin: true,
        disabled: false,
        createdAt: '2026-01-02T03:04:05Z'
      }
    ])
  })

  test('createUser defaults nickname and email when omitted', async () => {
    const { drizzle, values } = createUserCreateDrizzleMock()
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.createUser(
      'bob',
      'secret',
      false,
      undefined as unknown as string,
      undefined as unknown as string
    )
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(mockHashPassword).toHaveBeenCalledWith('secret')
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      name: 'bob',
      nickname: 'bob',
      email: 'needupdate@example.com',
      pass: 'hashed:secret'
    }))
    expect(body.nickname).toBe('bob')
    expect(body.email).toBe('needupdate@example.com')
  })

  test('createUser rejects invalid non-empty email values', async () => {
    const drizzle = {
      insert: jest.fn()
    }
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.createUser('bob', 'secret', false, 'Bobby', 'invalid-email')
    const body = await response.json() as { errorCode: number; errorDescription: string }

    expect(response.status).toBe(400)
    expect(body.errorCode).toBe(400)
    expect(body.errorDescription).toContain('Invalid email format')
    expect(drizzle.insert).not.toHaveBeenCalled()
  })

  test('deleteUser disconnects all deleted client streams after database deletion', async () => {
    let selectCall = 0
    const disconnectClient = jest.fn().mockResolvedValue(undefined)
    const select = jest.fn(() => {
      selectCall += 1
      let chain: any
      chain = {
        from: jest.fn(() => chain),
        where: jest.fn(() => chain),
        get: jest.fn(async () => selectCall === 1 ? { count: 2 } : { admin: false }),
        all: jest.fn(async () => [{ id: 11 }, { id: 12 }])
      }
      return chain
    })
    const drizzle = {
      select,
      delete: jest.fn(() => ({
        where: jest.fn().mockResolvedValue({ meta: { changes: 1 } })
      }))
    }
    const handlers = new UserHandlers(drizzle as any, { disconnectClient } as any)

    const response = await handlers.deleteUser('7')

    expect(response.status).toBe(200)
    expect(disconnectClient).toHaveBeenCalledWith(7, 11)
    expect(disconnectClient).toHaveBeenCalledWith(7, 12)
    expect(disconnectClient).toHaveBeenCalledTimes(2)
  })
})
