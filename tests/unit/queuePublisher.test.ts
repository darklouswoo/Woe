import { publishOutboxJobs } from '../../src/services/push/queuePublisher'

describe('queue publisher', () => {
  test('publishes queue messages in chunks', async () => {
    const sentBatches: any[] = []
    const queue = {
      sendBatch: jest.fn(async (batch: Iterable<any>) => {
        sentBatches.push(Array.from(batch))
      })
    }

    await publishOutboxJobs(queue as any, [1, 2, 3], {
      traceId: 't-1',
      chunkSize: 2
    })

    expect(queue.sendBatch).toHaveBeenCalledTimes(2)
    expect(sentBatches[0]).toHaveLength(2)
    expect(sentBatches[1]).toHaveLength(1)
    expect(sentBatches[0][0].body).toEqual(expect.objectContaining({
      outboxId: 1,
      traceId: 't-1',
      attempt: 0
    }))
  })

  test('skips publish when outboxIds is empty', async () => {
    const queue = {
      sendBatch: jest.fn(async () => undefined)
    }

    await publishOutboxJobs(queue as any, [], {
      traceId: 't-empty'
    })

    expect(queue.sendBatch).not.toHaveBeenCalled()
  })
})
