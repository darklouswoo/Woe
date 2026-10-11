const mockIsDefaultInitAuth = jest.fn()


const CLAIM_TOKEN = '5b3b6a1e-9c2d-4e8f-a0b1-2c3d4e5f6a7b'

const mockInitService = {
  getInitStatus: jest.fn(),
  isSystemInitialized: jest.fn(),
  hasAdminUser: jest.fn(),
  isInitializationLocked: jest.fn(),
  isInitializationInProgress: jest.fn(),
  ensureSchema: jest.fn(),
  validateDatabase: jest.fn(),
  claimInitialization: jest.fn(),
  assertClaimOwnership: jest.fn(),
  createAdminUser: jest.fn(),
  markAsInitialized: jest.fn(),
  lockInitialization: jest.fn(),
  releaseInitializationClaim: jest.fn()
}

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ $client: {} }))
}))

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    isDefaultInitAuth: (...args: any[]) => mockIsDefaultInitAuth(...args)
  }))
}))

jest.mock('../../src/services/initService.ts', () => ({
  InitService: jest.fn().mockImplementation(() => mockInitService)
}))

import { init } from '../../src/routes/init'

function buildExecutionCtx() {
  return {
    waitUntil: jest.fn(),
    passThroughOnException: jest.fn()
  } as any
}

describe('init route locking behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDefaultInitAuth.mockResolvedValue(true)
    mockInitService.isSystemInitialized.mockResolvedValue(false)
    mockInitService.hasAdminUser.mockResolvedValue(false)
    mockInitService.isInitializationLocked.mockResolvedValue(false)
    mockInitService.isInitializationInProgress.mockResolvedValue(false)
    mockInitService.claimInitialization.mockResolvedValue(CLAIM_TOKEN)
    mockInitService.assertClaimOwnership.mockResolvedValue(true)
    mockInitService.releaseInitializationClaim.mockResolvedValue(undefined)
    mockInitService.ensureSchema.mockResolvedValue(undefined)
    mockInitService.validateDatabase.mockResolvedValue(true)
    mockInitService.createAdminUser.mockResolvedValue(1)
    mockInitService.markAsInitialized.mockResolvedValue(undefined)
    mockInitService.lockInitialization.mockResolvedValue(undefined)
  })

  test('rejects /init/admin when system is already initialized', async () => {
    mockInitService.isSystemInitialized.mockResolvedValue(true)

    const response = await init.fetch(
      new Request('http://localhost/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'admin2', pass: 'StrongPass123!' })
      }),
      { DB: {} } as any,
      buildExecutionCtx()
    )

    expect(response.status).toBe(403)
    expect(mockInitService.createAdminUser).not.toHaveBeenCalled()
  })

  test('rejects /init/admin when initialization is locked', async () => {
    mockInitService.isInitializationLocked.mockResolvedValue(true)

    const response = await init.fetch(
      new Request('http://localhost/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'admin2', pass: 'StrongPass123!' })
      }),
      { DB: {} } as any,
      buildExecutionCtx()
    )

    expect(response.status).toBe(403)
    expect(mockInitService.createAdminUser).not.toHaveBeenCalled()
  })

  test('allows first initialization and locks it immediately', async () => {
    const response = await init.fetch(
      new Request('http://localhost/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'admin1', pass: 'StrongPass123!' })
      }),
      { DB: {} } as any,
      buildExecutionCtx()
    )

    expect(response.status).toBe(200)
    expect(mockInitService.markAsInitialized).toHaveBeenCalledTimes(1)
    expect(mockInitService.lockInitialization).toHaveBeenCalledTimes(1)

    const body = await response.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
