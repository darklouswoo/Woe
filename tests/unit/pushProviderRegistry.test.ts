import { createProviderRegistry } from '../../src/services/push/providers/registry'

describe('push provider registry', () => {
  test('default registry is empty for every platform', () => {
    const registry = createProviderRegistry()
    expect(registry.get('test-platform')).toBeNull()
    expect(registry.get('future-platform')).toBeNull()
  })

  test('accepts externally injected providers by name', async () => {
    const provider = {
      name: 'test-platform',
      send: jest.fn().mockResolvedValue({ ok: true, retriable: false })
    }
    const registry = createProviderRegistry([provider])
    expect(registry.get('test-platform')).toBe(provider)
  })
})
