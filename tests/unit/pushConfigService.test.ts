import { PushConfigService } from '../../src/services/push/configService'

function mockDbWithState(state: Record<string, string>) {
  return {
    $client: {
      prepare: jest.fn().mockReturnValue({
        bind: (key: string) => ({
          first: async () => (state[key] !== undefined ? { value: state[key] } : null)
        })
      })
    }
  }
}

describe('PushConfigService', () => {
  test('reads generic retry settings from system_state', async () => {
    const svc = new PushConfigService(mockDbWithState({
      'push.max_retries': '5',
      'push.retry_backoff_ms': '4000'
    }) as any)
    await expect(svc.getRuntimeConfig()).resolves.toEqual({ maxRetries: 5, retryBackoffMs: 4000 })
  })

  test('falls back to safe defaults on missing or invalid values', async () => {
    const svc = new PushConfigService(mockDbWithState({
      'push.max_retries': 'not-number',
      'push.retry_backoff_ms': '0'
    }) as any)
    await expect(svc.getRuntimeConfig()).resolves.toEqual({ maxRetries: 3, retryBackoffMs: 0 })
  })
})
