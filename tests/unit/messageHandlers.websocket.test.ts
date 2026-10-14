const emitMock = jest.fn().mockResolvedValue(undefined)

jest.mock('../../src/plugins/manager.ts', () => ({
  PluginManager: jest.fn().mockImplementation(() => ({
    emit: emitMock
  }))
}))

import { MessageHandlers } from '../../src/handlers/messageHandlers'

describe('MessageHandlers WebSocket broadcast', () => {
  test.each([-1, 2, 5, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])('createMessage preserves priority %p through broadcast and plugins', async (priority) => {
    const appGet = jest.fn().mockResolvedValue({ userId: 7 })
    const insertReturning = jest.fn().mockResolvedValue([
      {
        id: 101,
        appId: 42,
        message: 'hello from test',
        title: 'test',
        priority,
        date: '2026-02-27T10:00:00.000Z',
        extras: '{"scope":"test"}'
      }
    ])

    const drizzleMock = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: appGet
          }))
        }))
      })),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: insertReturning
        }))
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn().mockResolvedValue({})
        }))
      }))
    }

    const hub = {
      broadcast: jest.fn().mockResolvedValue(undefined)
    }

    const handlers = new MessageHandlers(drizzleMock as any, hub as any)

    const response = await handlers.createMessage(42, 'hello from test', 'test', priority, { scope: 'test' })

    expect(response.status).toBe(200)
    expect(hub.broadcast).toHaveBeenCalledTimes(1)
    expect(hub.broadcast).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        id: 101,
        appid: 42,
        message: 'hello from test',
        title: 'test',
        priority
      })
    )
    expect(emitMock).toHaveBeenCalledWith(
      7,
      'message.create',
      expect.objectContaining({
        message: expect.objectContaining({
          id: 101,
          appId: 42,
          priority,
          date: '2026-02-27T10:00:00.000Z'
        })
      })
    )
  })
})
