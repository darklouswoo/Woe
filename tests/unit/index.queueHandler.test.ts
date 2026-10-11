const cleanupSpy = jest.fn().mockResolvedValue({ success: true, deletedCount: 0 })
const cleanupOutboxSpy = jest.fn().mockResolvedValue({ success: true, deletedCount: 0 })
const reclaimSpy = jest.fn().mockResolvedValue(0)
const runOnceSpy = jest.fn().mockResolvedValue(undefined)
const consumeSpy = jest.fn().mockResolvedValue(undefined)
const cleanupExpiredClientsSpy = jest.fn().mockResolvedValue(0)

jest.mock('../../src/services/cleanupService.ts', () => ({
  CleanupService: jest.fn().mockImplementation(() => ({
    cleanupOldPluginLogs: cleanupSpy,
    cleanupPushOutbox: cleanupOutboxSpy
  }))
}))

jest.mock('../../src/services/push/dispatcher.ts', () => ({
  PushDispatcher: jest.fn().mockImplementation(() => ({
    runOnce: runOnceSpy
  }))
}))

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ __name: 'drizzle' }))
}))

jest.mock('../../src/services/push/configService.ts', () => ({
  PushConfigService: jest.fn().mockImplementation(() => ({
    getRuntimeConfig: jest.fn().mockResolvedValue({
      enabledGlobal: true,
      timeoutMs: 3000,
      maxRetries: 3,
      retryBackoffMs: 2000,
      credentials: {
        projectId: 'pid',
        clientId: 'cid',
        clientSecret: 'secret'
      }
    })
  }))
}))

jest.mock('../../src/services/push/providers/registry.ts', () => ({
  createProviderRegistry: jest.fn(() => ({ get: jest.fn() }))
}))

jest.mock('../../src/services/push/outboxService.ts', () => ({
  PushOutboxService: jest.fn().mockImplementation(() => ({
    getDueJobs: jest.fn().mockResolvedValue([]),
    markProcessing: jest.fn(),
    markSuccess: jest.fn(),
    scheduleRetry: jest.fn(),
    markDead: jest.fn(),
    suspend: jest.fn(),
    reclaimStaleProcessing: reclaimSpy
  }))
}))

jest.mock('../../src/services/push/queueConsumer.ts', () => ({
  consumePushQueueBatch: (...args: any[]) => consumeSpy(...args)
}))

jest.mock('../../src/services/clientExpiry.ts', () => ({
  cleanupExpiredClients: (...args: any[]) => cleanupExpiredClientsSpy(...args)
}))

jest.mock('../../src/app.ts', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn()
  }
}))

import worker from '../../src/index'

describe('worker queue handler and scheduled', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('scheduled cleans plugin logs and runs push reconciliation pump', async () => {
    await worker.scheduled(
      { cron: '* * * * *' } as any,
      { DB: {} } as any,
      {} as any
    )

    expect(cleanupSpy).toHaveBeenCalledWith(30)
    expect(reclaimSpy).toHaveBeenCalledTimes(1)
    expect(runOnceSpy).toHaveBeenCalledTimes(1)
    expect(cleanupOutboxSpy).toHaveBeenCalledWith(30)
  })

  test('scheduled triggers expired-client cleanup ', async () => {
    await worker.scheduled(
      { cron: '0 2 * * *' } as any,
      { DB: {} } as any,
      {} as any
    )


    expect(cleanupExpiredClientsSpy).toHaveBeenCalledTimes(1)
    expect(cleanupExpiredClientsSpy.mock.calls[0][1]).toBeUndefined()
  })

  test('scheduled expired-client cleanup receives a stream hub when MESSAGE_STREAM_HUB is bound', async () => {
    await worker.scheduled(
      { cron: '0 2 * * *' } as any,
      { DB: {}, MESSAGE_STREAM_HUB: { idFromName: jest.fn(), get: jest.fn() } } as any,
      {} as any
    )

    expect(cleanupExpiredClientsSpy).toHaveBeenCalledTimes(1)
    const streamHub = cleanupExpiredClientsSpy.mock.calls[0][1]
    expect(streamHub).toBeDefined()
    expect(typeof streamHub.disconnectClient).toBe('function')
  })

  test('scheduled expired-client cleanup failure is isolated from other tasks', async () => {
    cleanupExpiredClientsSpy.mockRejectedValueOnce(new Error('D1 down'))

    await expect(
      worker.scheduled(
        { cron: '0 2 * * *' } as any,
        { DB: {} } as any,
        {} as any
      )
    ).resolves.toBeUndefined()

    expect(cleanupSpy).toHaveBeenCalledWith(30)
    expect(runOnceSpy).toHaveBeenCalledTimes(1)
  })

  test('scheduled reconciliation failure is isolated from plugin log cleanup', async () => {
    reclaimSpy.mockRejectedValueOnce(new Error('D1 down'))

    await expect(
      worker.scheduled(
        { cron: '* * * * *' } as any,
        { DB: {} } as any,
        {} as any
      )
    ).resolves.toBeUndefined()

    expect(cleanupSpy).toHaveBeenCalledWith(30)
    expect(runOnceSpy).not.toHaveBeenCalled()
  })

  test('queue handler delegates to queue consumer', async () => {
    expect(typeof (worker as any).queue).toBe('function')

    const batch = {
      messages: [],
      queue: 'woe-push-queue',
      retryAll: jest.fn(),
      ackAll: jest.fn()
    }

    await (worker as any).queue(batch, {
      DB: {},
      PROVIDER_PROJECT_ID: 'pid',
      PROVIDER_CLIENT_ID: 'cid',
      PROVIDER_CLIENT_SECRET: 'secret',
      PUSH_QUEUE: { sendBatch: jest.fn().mockResolvedValue(undefined) }
    }, {})

    expect(consumeSpy).toHaveBeenCalledTimes(1)
  })
})
