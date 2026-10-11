import { clients } from '../../src/models/client'
import { pushOutbox } from '../../src/models/pushOutbox'

describe('push schema', () => {
  test('clients table exposes push device fields', () => {
    expect((clients as any).platform).toBeDefined()
    expect((clients as any).deviceUid).toBeDefined()
    expect((clients as any).deviceToken).toBeDefined()
    expect((clients as any).tokenStatus).toBeDefined()
  })

  test('pushOutbox table exists with queue status fields', () => {
    expect((pushOutbox as any).platform).toBeDefined()
    expect((pushOutbox as any).status).toBeDefined()
    expect((pushOutbox as any).attemptCount).toBeDefined()
    expect((pushOutbox as any).nextRetryAt).toBeDefined()
  })
})
