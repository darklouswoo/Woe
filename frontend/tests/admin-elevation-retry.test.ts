import { describe, it, expect, vi, beforeEach } from 'vitest'




const hoisted = vi.hoisted(() => ({
  withElevation: vi.fn(),
}))

vi.mock('@/composables/useElevatedAction', () => ({
  useElevatedAction: () => ({ withElevation: hoisted.withElevation }),
}))

import { withElevationRetry } from '@/services/auth'

describe('withElevationRetry（/user 管理端点提升重试）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('将 action 透传给 withElevation 并返回其结果（重试语义由 withElevation 保证）', async () => {
    const action = vi.fn().mockResolvedValue('ok')
    hoisted.withElevation.mockImplementation((fn: () => Promise<unknown>) => fn())

    const result = await withElevationRetry(action)

    expect(hoisted.withElevation).toHaveBeenCalledTimes(1)
    expect(hoisted.withElevation).toHaveBeenCalledWith(action)
    expect(action).toHaveBeenCalledTimes(1)
    expect(result).toBe('ok')
  })

  it('非提升类错误（如 403 Admin access required）原样上抛，不触发 elevate 流程', async () => {
    const forbidden = new Error('Admin access required')
    const action = vi.fn().mockRejectedValue(forbidden)
    hoisted.withElevation.mockImplementation(async (fn: () => Promise<unknown>) => {
      try {
        return await fn()
      } catch (e) {

        throw e
      }
    })

    await expect(withElevationRetry(action)).rejects.toBe(forbidden)
  })

  it('用户取消 elevate（ElevationCancelledError）原样上抛，由调用点静默处理', async () => {
    const cancelled = new Error('elevation-cancelled')
    const action = vi.fn()
    hoisted.withElevation.mockRejectedValue(cancelled)

    await expect(withElevationRetry(action)).rejects.toBe(cancelled)
    expect(action).not.toHaveBeenCalled()
  })
})
