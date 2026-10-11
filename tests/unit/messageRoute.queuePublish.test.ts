const mockPublishOutboxJobs = jest.fn().mockResolvedValue(undefined)
const mockGetPendingJobIdsByMessage = jest.fn().mockResolvedValue([10, 11])
const mockCreateMessage = jest.fn().mockResolvedValue(
  new Response(JSON.stringify({ id: 101, appid: 42, message: 'hello' }), {
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
    authenticate: jest.fn().mockResolvedValue({ tokenType: 'app', userId: 7, resourceId: 42 }),
    requireApp: jest.fn().mockResolvedValue({ tokenType: 'app', userId: 7, resourceId: 42 }),
    requireClient: jest.fn().mockResolvedValue(null)
  }))
}))

jest.mock('../../src/handlers/messageHandlers.ts', () => ({

  ...jest.requireActual('../../src/handlers/messageHandlers.ts'),
  MessageHandlers: jest.fn().mockImplementation(() => ({
    createMessage: mockCreateMessage
  }))
}))

jest.mock('../../src/services/push/outboxService.ts', () => ({
  PushOutboxService: jest.fn().mockImplementation(() => ({
    getPendingJobIdsByMessage: mockGetPendingJobIdsByMessage
  }))
}))

jest.mock('../../src/services/push/queuePublisher.ts', () => ({
  publishOutboxJobs: (...args: any[]) => mockPublishOutboxJobs(...args)
}))


jest.mock('../../src/services/writeGateService.ts', () => ({
  isEnqueueWritePaused: jest.fn().mockResolvedValue(false),
  ENQUEUE_WRITE_GATE_KEY: 'enqueue_write_gate',
  ENQUEUE_WRITE_GATE_PAUSED: 'paused'
}))

import { message } from '../../src/routes/message'

describe('message route queue publish', () => {
  test('publishes pending outbox jobs with waitUntil after successful message creation', async () => {
    const waitUntilMock = jest.fn((promise: Promise<unknown>) => promise)
    const response = await message.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': 'app-token'
        },
        body: JSON.stringify({ message: 'hello' })
      }),
      {
        DB: {} as any,
        PUSH_QUEUE: {} as any
      } as any,
      {
        waitUntil: waitUntilMock,
        passThroughOnException: jest.fn()
      } as any
    )

    expect(response.status).toBe(200)
    expect(waitUntilMock).toHaveBeenCalledTimes(1)
    await waitUntilMock.mock.calls[0][0]
    expect(mockGetPendingJobIdsByMessage).toHaveBeenCalledWith(7, 101)
    expect(mockPublishOutboxJobs).toHaveBeenCalledWith(
      expect.anything(),
      [10, 11],
      expect.objectContaining({ traceId: expect.any(String) })
    )
  })
})
