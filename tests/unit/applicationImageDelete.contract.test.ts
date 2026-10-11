









jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { ApplicationHandlers } from '../../src/handlers/applicationHandlers'

const DEFAULT_APP_IMAGE = 'static/defaultapp.png'

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 7,
    token: 'A-app-token',
    name: 'App A',
    sortKey: 'a',
    description: 'desc',
    defaultPriority: 5,
    image: '/api/v1/image/app-images/1-123',
    internal: false,
    lastUsed: '2026-10-05 08:30:00',
    createdAt: '2026-10-01 08:30:00',
    ...overrides
  }
}






function createDeleteDrizzle(options: {
  existingApp?: Record<string, unknown> | null
  updatedRows?: Array<Record<string, unknown>>
} = {}) {
  const state = {
    updatePayloads: [] as Array<Record<string, unknown>>
  }
  const existing = options.existingApp === undefined ? applicationRow() : options.existingApp
  const updatedRows = options.updatedRows ?? [
    applicationRow({ image: null, name: 'App A' })
  ]

  const updateWhereResult: any = Promise.resolve({ meta: { changes: 1 } })
  updateWhereResult.returning = jest.fn().mockResolvedValue(updatedRows)

  const drizzle = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ get: jest.fn().mockResolvedValue(existing) }))
      }))
    })),
    update: jest.fn(() => ({
      set: jest.fn((payload: Record<string, unknown>) => {
        state.updatePayloads.push(payload)
        return { where: jest.fn(() => updateWhereResult) }
      })
    }))
  }
  return { drizzle, state }
}

describe('deleteApplicationImage 返回模型', () => {
  test('成功删除 → 200 返回更新后的 Application 读模型（默认图、无可用 token）', async () => {
    const { drizzle, state } = createDeleteDrizzle()
    const handlers = new ApplicationHandlers(drizzle as any)
    const deleteMock = jest.fn().mockResolvedValue(undefined)

    const response = await handlers.deleteApplicationImage(7, '1', false, {
      R2: { delete: deleteMock }
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)

    expect(body.id).toBe(1)
    expect(body.name).toBe('App A')
    expect(body.description).toBe('desc')
    expect(body.defaultPriority).toBe(5)
    expect(body.token).toBe('')

    expect(body.image).toBe(DEFAULT_APP_IMAGE)


    expect(state.updatePayloads).toHaveLength(1)
    expect(state.updatePayloads[0].image).toBeNull()

    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).toHaveBeenCalledWith('app-images/1-123')
  })

  test('新格式存量值同样完成 R2 清理与读模型返回（存量值不变式：新值不入库）', async () => {


    const { drizzle } = createDeleteDrizzle({
      existingApp: applicationRow({ image: 'image/app-images/8-77' })
    })
    const handlers = new ApplicationHandlers(drizzle as any)
    const deleteMock = jest.fn().mockResolvedValue(undefined)

    const response = await handlers.deleteApplicationImage(7, '1', false, {
      R2: { delete: deleteMock }
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.image).toBe(DEFAULT_APP_IMAGE)
    expect(body.token).toBe('')
  })

  test('无图删除 → 404 "No image to delete"（状态不变）', async () => {
    const { drizzle, state } = createDeleteDrizzle({
      existingApp: applicationRow({ image: null })
    })
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.deleteApplicationImage(7, '1', false, {
      R2: { delete: jest.fn() }
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(404)
    expect(body.errorDescription).toBe('No image to delete')
    expect(state.updatePayloads).toHaveLength(0)
  })

  test('非管理员非属主 → 404（跨属主策略不变）', async () => {
    const { drizzle, state } = createDeleteDrizzle({ existingApp: null })
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.deleteApplicationImage(8, '1', false, {
      R2: { delete: jest.fn() }
    })

    expect(response.status).toBe(404)
    expect(state.updatePayloads).toHaveLength(0)
  })

  test('管理员跨属主删除 → 200 返回属主应用读模型（策略保留）', async () => {
    const { drizzle } = createDeleteDrizzle({
      existingApp: applicationRow({ userId: 7, name: 'Owned App' }),
      updatedRows: [applicationRow({ userId: 7, name: 'Owned App', image: null })]
    })
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.deleteApplicationImage(99, '1', true, {
      R2: { delete: jest.fn() }
    })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.name).toBe('Owned App')
    expect(body.image).toBe(DEFAULT_APP_IMAGE)
    expect(body.token).toBe('')
  })
})
