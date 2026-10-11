const mockGetMessageById = jest.fn().mockResolvedValue(
  new Response(JSON.stringify({
    id: 101,
    appid: 42,
    message: 'hello',
    title: 'notice',
    priority: 5,
    date: '2026-02-27T10:00:00.000Z',
    extras: { scope: 'test' }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
)

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ __name: 'drizzle-mock' }))
}))

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    authenticateBasic: jest.fn().mockResolvedValue(null),
    authenticate: jest.fn().mockResolvedValue({ tokenType: 'client', userId: 7, resourceId: 9 })
  }))
}))

jest.mock('../../src/handlers/messageHandlers.ts', () => ({
  MessageHandlers: jest.fn().mockImplementation(() => ({
    getMessageById: mockGetMessageById
  }))
}))

import { message } from '../../src/routes/message'

describe('message route get by id', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns the single message for an authenticated client', async () => {
    const response = await message.fetch(
      new Request('http://localhost/101', {
        method: 'GET',
        headers: {
          'x-gotify-key': 'client-token'
        }
      }),
      {
        DB: {} as any
      } as any,
      {
        waitUntil: jest.fn(),
        passThroughOnException: jest.fn()
      } as any
    )

    expect(response.status).toBe(200)
    expect(mockGetMessageById).toHaveBeenCalledWith(7, '101')
  })

  test.each(['abc', '0', '-1'])('returns 400 for invalid /message/%s id', async (id) => {
    const response = await message.fetch(
      new Request(`http://localhost/${id}`, {
        method: 'GET',
        headers: {
          'x-gotify-key': 'client-token'
        }
      }),
      {
        DB: {} as any
      } as any,
      {
        waitUntil: jest.fn(),
        passThroughOnException: jest.fn()
      } as any
    )

    expect(response.status).toBe(400)
    expect(mockGetMessageById).not.toHaveBeenCalled()
  })
})
