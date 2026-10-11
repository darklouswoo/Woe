const mockDeleteClient = jest.fn()
const mockRequireElevatedClient = jest.fn()
const mockDisconnectClient = jest.fn()

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ __name: 'drizzle-mock' }))
}))

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    requireElevatedClient: mockRequireElevatedClient
  })),
  SESSION_NOT_ELEVATED_MESSAGE: 'Session is not elevated'
}))

jest.mock('../../src/handlers/clientHandlers.ts', () => ({
  ClientHandlers: jest.fn().mockImplementation(() => ({
    deleteClient: mockDeleteClient
  }))
}))

jest.mock('../../src/services/messageStreamHub.ts', () => ({
  DurableObjectMessageStreamHub: jest.fn().mockImplementation(() => ({
    disconnectClient: mockDisconnectClient
  }))
}))

import { client } from '../../src/routes/client'

describe('client route delete kick', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequireElevatedClient.mockResolvedValue({ userId: 7, tokenType: 'client', resourceId: 5 })
    mockDeleteClient.mockResolvedValue(new Response('{}', { status: 200 }))
    mockDisconnectClient.mockResolvedValue(undefined)
  })

  test('disconnects deleted client after database deletion succeeds', async () => {
    const response = await client.fetch(
      new Request('http://localhost/5', { method: 'DELETE', headers: { 'x-gotify-key': 'C-token' } }),
      { DB: {} as any, MESSAGE_STREAM_HUB: {} as any } as any,
      {} as any
    )

    expect(response.status).toBe(200)
    expect(mockDeleteClient).toHaveBeenCalledWith(7, '5')
    expect(mockDisconnectClient).toHaveBeenCalledWith(7, 5)
  })

  test('keeps delete success when stream disconnect fails', async () => {
    mockDisconnectClient.mockRejectedValue(new Error('DO unavailable'))

    const response = await client.fetch(
      new Request('http://localhost/5', { method: 'DELETE', headers: { 'x-gotify-key': 'C-token' } }),
      { DB: {} as any, MESSAGE_STREAM_HUB: {} as any } as any,
      {} as any
    )

    expect(response.status).toBe(200)
  })
})
