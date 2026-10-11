





const mockUpdateClient = jest.fn()

const mockAuthenticateBasic = jest.fn()
const mockAuthenticate = jest.fn()

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ __name: 'drizzle-mock' }))
}))

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    authenticateBasic: mockAuthenticateBasic,
    authenticate: mockAuthenticate
  })),
  SESSION_NOT_ELEVATED_MESSAGE: 'Session is not elevated'
}))

jest.mock('../../src/handlers/clientHandlers.ts', () => ({
  ClientHandlers: jest.fn().mockImplementation(() => ({
    getAllClients: jest.fn(),
    createClient: jest.fn(),
    getClient: jest.fn(),
    updateClient: mockUpdateClient,
    updatePushState: jest.fn(),
    deleteClient: jest.fn()
  }))
}))

import { client } from '../../src/routes/client'

function putClient(id: string, body: string) {
  return client.fetch(
    new Request(`http://localhost/${id}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-gotify-key': 'client-token'
      },
      body
    }),
    {
      DB: {} as any
    } as any,
    {
      waitUntil: jest.fn(),
      passThroughOnException: jest.fn()
    } as any
  )
}

describe('client route updateClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthenticateBasic.mockResolvedValue(null)
    mockAuthenticate.mockResolvedValue({ tokenType: 'client', userId: 7, resourceId: 5 })
    mockUpdateClient.mockResolvedValue(
      new Response(JSON.stringify({ id: 5, name: 'Updated', token: 'Ctoken' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })

  test('passes the whole parsed body to updateClient (not just body.name)', async () => {
    const body = {
      name: 'New Name',
      deviceUid: 'device-1',
      expiresAfterInactivitySeconds: 432000,
      unknownField: true
    }
    const response = await putClient('5', JSON.stringify(body))

    expect(response.status).toBe(200)
    expect(mockUpdateClient).toHaveBeenCalledTimes(1)
    expect(mockUpdateClient).toHaveBeenCalledWith(7, '5', body)
  })

  test('returns 401 when no valid credentials are provided', async () => {
    mockAuthenticateBasic.mockResolvedValue(null)
    mockAuthenticate.mockResolvedValue(null)

    const response = await putClient('5', JSON.stringify({ name: 'New Name' }))

    expect(response.status).toBe(401)
    expect(mockUpdateClient).not.toHaveBeenCalled()
  })

  test.each(['abc', '0', '-1'])('returns 400 for invalid /client/%s id', async (id) => {
    const response = await putClient(id, JSON.stringify({ name: 'New Name' }))

    expect(response.status).toBe(400)
    expect(mockUpdateClient).not.toHaveBeenCalled()
  })

  test('returns 400 for a malformed JSON body without calling the handler', async () => {
    const response = await putClient('5', '{not json')
    const body = await response.json() as any

    expect(response.status).toBe(400)
    expect(body.errorDescription).toBe('Invalid JSON body')
    expect(mockUpdateClient).not.toHaveBeenCalled()
  })

  test('returns 400 for a literal null JSON body', async () => {
    const response = await putClient('5', 'null')

    expect(response.status).toBe(400)
    expect(mockUpdateClient).not.toHaveBeenCalled()
  })

  test('passes a JSON array body through to the handler for contract-level rejection', async () => {
    mockUpdateClient.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Bad Request', errorCode: 400, errorDescription: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    const response = await putClient('5', '["name"]')

    expect(mockUpdateClient).toHaveBeenCalledWith(7, '5', ['name'])
    expect(response.status).toBe(400)
  })
})
