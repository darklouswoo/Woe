import { parsePushQueueMessage } from '../../src/services/push/queueContract'

describe('queue contract', () => {
  test('accepts valid push queue message', () => {
    const parsed = parsePushQueueMessage({
      outboxId: 123,
      traceId: 'trace-1',
      attempt: 0,
      enqueueAt: '2026-02-28T12:00:00.000Z'
    })

    expect(parsed.outboxId).toBe(123)
    expect(parsed.traceId).toBe('trace-1')
    expect(parsed.attempt).toBe(0)
  })

  test('rejects invalid payload', () => {
    expect(() => parsePushQueueMessage({ outboxId: 'bad' } as any)).toThrow('Invalid push queue message')
  })
})
