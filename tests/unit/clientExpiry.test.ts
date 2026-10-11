

















import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { Authenticator } from '../../src/middleware/auth'
import {
  cleanupExpiredClients,
  refreshClientActivity,
  refreshClientActivityById,
  isClientExpired,
  CLIENT_ACTIVITY_THROTTLE_MS
} from '../../src/services/clientExpiry'
import { createTestDb, asDrizzle, seedClient } from '../helpers/testDb'
import { clients } from '../../src/models'
import { eq } from 'drizzle-orm'

const T0 = new Date('2026-10-05T08:00:00.000Z')

function makeHandlers() {
  const testDb = createTestDb()
  const handlers = new ClientHandlers(asDrizzle(testDb))
  return { testDb, handlers }
}

function getRow(testDb: ReturnType<typeof createTestDb>, id: number) {
  return testDb.db.select().from(clients).where(eq(clients.id, id)).all()[0]
}

function authRequest(token: string) {
  return new Request('http://localhost/message', { headers: { 'X-Gotify-Key': token } })
}

afterEach(() => {
  jest.useRealTimers()
})

describe('ClientHandlers 创建/更新的 expiresAfterInactivitySeconds 持久化', () => {
  test('创建 client 时持久化 expiresAfterInactivitySeconds 且响应含 expiresAt', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const { testDb, handlers } = makeHandlers()

    const res = await handlers.createClient(7, { name: 'Phone', expiresAfterInactivitySeconds: 3600 })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.expiresAfterInactivitySeconds).toBe(3600)
    expect(typeof body.expiresAt).toBe('string')

    expect(new Date(body.expiresAt).getTime()).toBe(T0.getTime() + 3600_000)

    const row = getRow(testDb, body.id)
    expect(row.expiresAfterInactivitySeconds).toBe(3600)
    expect(row.expiresAt).toBe(body.expiresAt)
  })

  test('未设置时响应省略 expiresAt，持久化 seconds=0 / expires_at=NULL（永不过期）', async () => {
    const { testDb, handlers } = makeHandlers()

    const res = await handlers.createClient(7, { name: 'Phone' })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.expiresAfterInactivitySeconds).toBe(0)
    expect('expiresAt' in body).toBe(false)

    const row = getRow(testDb, body.id)
    expect(row.expiresAfterInactivitySeconds).toBe(0)
    expect(row.expiresAt).toBeNull()
  })

  test.each([-1, 1.5, '60', Number.MAX_SAFE_INTEGER])(
    '创建时 expiresAfterInactivitySeconds=%p → 400（负/非整数/超大，上游 uint）',
    async (value) => {
      const { handlers } = makeHandlers()

      const res = await handlers.createClient(7, { name: 'Phone', expiresAfterInactivitySeconds: value as any })

      expect(res.status).toBe(400)
    }
  )

  test('PUT /client/:id 可更新 expiresAfterInactivitySeconds，expiresAt 以 (lastUsed ?? createdAt) 为 base 重算', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, {
      lastUsed: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z'
    })

    const res = await handlers.updateClient(7, String(seed.id), {
      name: seed.name,
      expiresAfterInactivitySeconds: 7200
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.expiresAfterInactivitySeconds).toBe(7200)

    expect(body.expiresAt).toBe('2026-10-01T02:00:00.000Z')

    const row = getRow(testDb, seed.id)
    expect(row.expiresAfterInactivitySeconds).toBe(7200)
    expect(row.expiresAt).toBe('2026-10-01T02:00:00.000Z')
  })

  test('PUT 改回 0 → expiresAt 置 NULL 且响应省略（恢复永不过期）', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, {
      expiresAfterInactivitySeconds: 3600,
      expiresAt: '2026-10-06T00:00:00.000Z'
    })

    const res = await handlers.updateClient(7, String(seed.id), {
      name: seed.name,
      expiresAfterInactivitySeconds: 0
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.expiresAfterInactivitySeconds).toBe(0)
    expect('expiresAt' in body).toBe(false)

    const row = getRow(testDb, seed.id)
    expect(row.expiresAfterInactivitySeconds).toBe(0)
    expect(row.expiresAt).toBeNull()
  })

  test.each([-5, 2.5, '3600', Number.MAX_SAFE_INTEGER])(
    'PUT expiresAfterInactivitySeconds=%p → 400 且不写库',
    async (value) => {
      const { testDb, handlers } = makeHandlers()
      const seed = seedClient(testDb, { expiresAfterInactivitySeconds: 0 })

      const res = await handlers.updateClient(7, String(seed.id), {
        name: seed.name,
        expiresAfterInactivitySeconds: value as any
      })

      expect(res.status).toBe(400)
      expect(getRow(testDb, seed.id).expiresAfterInactivitySeconds).toBe(0)
    }
  )

  test('PUT 缺省 expiresAfterInactivitySeconds → 既有过期设置不动', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, {
      expiresAfterInactivitySeconds: 3600,
      expiresAt: '2026-10-06T00:00:00.000Z'
    })

    const res = await handlers.updateClient(7, String(seed.id), { name: 'Renamed' })

    expect(res.status).toBe(200)
    const row = getRow(testDb, seed.id)
    expect(row.name).toBe('Renamed')
    expect(row.expiresAfterInactivitySeconds).toBe(3600)
    expect(row.expiresAt).toBe('2026-10-06T00:00:00.000Z')
  })
})

describe('Authenticator client token 过期拒绝与节流刷新', () => {
  function seedTokenClient(overrides: Parameters<typeof seedClient>[1]) {
    const testDb = createTestDb()

    testDb.sqlite.prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, ?)').run(7, 'user7', 0, 0)
    const token = 'C' + Math.random().toString(36).slice(2, 24)
    const seed = seedClient(testDb, { token, ...overrides })
    return { testDb, token, seed, auth: new Authenticator(asDrizzle(testDb)) }
  }

  test('now > expiresAt 的 client token → 401，且 lastUsed 不被刷新（不续命）', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const lastUsed = '2026-10-04T00:00:00.000Z'
    const { testDb, token, seed, auth } = seedTokenClient({
      lastUsed,
      expiresAfterInactivitySeconds: 3600,
      expiresAt: '2026-10-05T07:59:59.000Z'
    })

    expect(await auth.authenticate(authRequest(token))).toBeNull()
    expect(getRow(testDb, seed.id).lastUsed).toBe(lastUsed)
  })

  test('now == expiresAt → 401（边界判过期，对齐 V3 !now.Before；节流写不得在边界续命）', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const lastUsed = '2026-10-04T00:00:00.000Z'
    const { testDb, token, seed, auth } = seedTokenClient({
      lastUsed,
      expiresAfterInactivitySeconds: 3600,
      expiresAt: T0.toISOString()
    })

    expect(await auth.authenticate(authRequest(token))).toBeNull()

    const row = getRow(testDb, seed.id)
    expect(row.lastUsed).toBe(lastUsed)
    expect(row.expiresAt).toBe(T0.toISOString())
  })

  test('未过期 client token 正常认证，距上次刷新超过 5 分钟时刷新 lastUsed/expiresAt', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const { testDb, token, seed, auth } = seedTokenClient({
      lastUsed: '2026-10-05T07:00:00.000Z',
      expiresAfterInactivitySeconds: 3600,
      expiresAt: '2026-10-05T08:00:00.000Z'
    })

    jest.setSystemTime(new Date(T0.getTime() - 1000))

    const result = await auth.authenticate(authRequest(token))

    expect(result).toEqual({
      userId: 7,
      isAdmin: false,
      tokenType: 'client',
      resourceId: seed.id,

      clientId: seed.id,
      elevatedUntil: null,

      clientTokenLookup: token
    })
    const row = getRow(testDb, seed.id)
    const nowIso = new Date(T0.getTime() - 1000).toISOString()
    expect(row.lastUsed).toBe(nowIso)

    expect(row.expiresAt).toBe(new Date(T0.getTime() - 1000 + 3600_000).toISOString())
  })

  test('5 分钟节流窗口内的认证跳过写库（lastUsed 保持原值）', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const lastUsed = new Date(T0.getTime() - CLIENT_ACTIVITY_THROTTLE_MS + 60_000).toISOString()
    const expiresAt = new Date(T0.getTime() + 3600_000).toISOString()
    const { testDb, token, seed, auth } = seedTokenClient({
      lastUsed,
      expiresAfterInactivitySeconds: 3600,
      expiresAt
    })

    const result = await auth.authenticate(authRequest(token))

    expect(result).not.toBeNull()
    const row = getRow(testDb, seed.id)
    expect(row.lastUsed).toBe(lastUsed)
    expect(row.expiresAt).toBe(expiresAt)
  })

  test('expiresAt 为 NULL（seconds=0）的 client 永不过期', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const { token, seed, auth } = seedTokenClient({
      lastUsed: '2020-01-01T00:00:00.000Z',
      expiresAfterInactivitySeconds: 0,
      expiresAt: null
    })

    const result = await auth.authenticate(authRequest(token))

    expect(result).toEqual({
      userId: 7,
      isAdmin: false,
      tokenType: 'client',
      resourceId: seed.id,

      clientId: seed.id,
      elevatedUntil: null,

      clientTokenLookup: token
    })
  })
})

describe('WebSocket ping 续期（refreshClientActivityById，DO 文本 ping 处理器共用）', () => {
  test('仅保持长连接的活跃 client 刷新 lastUsed/expiresAt 后不被定时清理误删', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const testDb = createTestDb()
    const drizzle = asDrizzle(testDb)
    const seed = seedClient(testDb, {
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString()
    })


    jest.setSystemTime(new Date(T0.getTime() + 540_000))
    await refreshClientActivityById(drizzle, seed.id)

    const refreshed = getRow(testDb, seed.id)
    const pingAt = T0.getTime() + 540_000
    expect(refreshed.lastUsed).toBe(new Date(pingAt).toISOString())
    expect(refreshed.expiresAt).toBe(new Date(pingAt + 600_000).toISOString())


    jest.setSystemTime(new Date(T0.getTime() + 610_000))
    const disconnect = jest.fn().mockResolvedValue(undefined)
    const deleted = await cleanupExpiredClients(drizzle, { disconnectClient: disconnect })

    expect(deleted).toBe(0)
    expect(disconnect).not.toHaveBeenCalled()
    expect(getRow(testDb, seed.id)).toBeDefined()
  })

  test('ping 刷新同样受 5 分钟节流：窗口内重复 ping 不写库', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const testDb = createTestDb()
    const drizzle = asDrizzle(testDb)
    const lastUsed = new Date(T0.getTime() - 60_000).toISOString()
    const expiresAt = new Date(T0.getTime() + 600_000).toISOString()
    const seed = seedClient(testDb, {
      lastUsed,
      expiresAfterInactivitySeconds: 600,
      expiresAt
    })

    await refreshClientActivityById(drizzle, seed.id)

    const row = getRow(testDb, seed.id)
    expect(row.lastUsed).toBe(lastUsed)
    expect(row.expiresAt).toBe(expiresAt)
  })

  test('已过期的 client 不被 ping 刷新续命（WHERE 守卫）', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const testDb = createTestDb()
    const drizzle = asDrizzle(testDb)
    const lastUsed = '2026-10-04T00:00:00.000Z'
    const expiresAt = '2026-10-05T07:00:00.000Z'
    const seed = seedClient(testDb, {
      lastUsed,
      expiresAfterInactivitySeconds: 600,
      expiresAt
    })

    await refreshClientActivityById(drizzle, seed.id)

    const row = getRow(testDb, seed.id)
    expect(row.lastUsed).toBe(lastUsed)
    expect(row.expiresAt).toBe(expiresAt)
  })
})

describe('HTTP 活跃刷新快照一致性守卫（重登录/并发活跃交错）', () => {
  function seedRaceClient(overrides: Parameters<typeof seedClient>[1]) {
    const testDb = createTestDb()

    testDb.sqlite.prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, ?)').run(7, 'user7', 0, 0)
    const token = 'C' + Math.random().toString(36).slice(2, 24)
    const seed = seedClient(testDb, { token, ...overrides })
    return { testDb, token, seed, drizzle: asDrizzle(testDb) }
  }

  test('重登录交错：认证读到 (tokenA,10s) 后行变为 (tokenB,策略0) → 旧请求刷新零写入，不出现「策略0 + expiresAt 非空」；新凭据认证正常', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const oldLastUsed = '2026-10-05T06:00:00.000Z'
    const { testDb, token, seed, drizzle } = seedRaceClient({
      lastUsed: oldLastUsed,
      expiresAfterInactivitySeconds: 10,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString()
    })
    const tokenB = 'C' + Math.random().toString(36).slice(2, 24)


    const realUpdate = drizzle.update.bind(drizzle)
    let injected = false
    const interleaved = new Proxy(drizzle, {
      get(target, prop, receiver) {
        if (prop === 'update' && !injected) {
          return (table: unknown) => {
            injected = true
            testDb.db.update(clients).set({
              token: tokenB,
              expiresAfterInactivitySeconds: 0,
              expiresAt: null,
              lastUsed: T0.toISOString()
            }).where(eq(clients.id, seed.id)).run()
            return realUpdate(table as any)
          }
        }
        return Reflect.get(target, prop, receiver)
      }
    }) as any

    const result = await new Authenticator(interleaved).authenticate(authRequest(token))

    expect(injected).toBe(true)
    expect(result).not.toBeNull()
    const row = getRow(testDb, seed.id)
    expect(row.token).toBe(tokenB)
    expect(row.expiresAfterInactivitySeconds).toBe(0)
    expect(row.expiresAt).toBeNull()
    expect(row.lastUsed).toBe(T0.toISOString())



    jest.setSystemTime(new Date(T0.getTime() + 11_000))
    expect(isClientExpired(getRow(testDb, seed.id).expiresAt)).toBe(false)
    expect(await new Authenticator(asDrizzle(testDb)).authenticate(authRequest(tokenB))).not.toBeNull()
  })

  test('并发活跃写入：lastUsed 已被他方推进 → 快照不匹配静默跳过（不覆盖他方刷新）', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const { testDb, token, seed, drizzle } = seedRaceClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString()
    })

    const otherLastUsed = new Date(T0.getTime() - 1_000).toISOString()
    const otherExpiresAt = new Date(T0.getTime() + 599_000).toISOString()
    testDb.db.update(clients)
      .set({ lastUsed: otherLastUsed, expiresAt: otherExpiresAt })
      .where(eq(clients.id, seed.id)).run()


    await refreshClientActivity(drizzle, {
      id: seed.id,
      userId: 7,
      token,
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600
    })

    const row = getRow(testDb, seed.id)
    expect(row.lastUsed).toBe(otherLastUsed)
    expect(row.expiresAt).toBe(otherExpiresAt)
    expect(token).toBeTruthy()
  })

  test('日志脱敏：refreshClientActivity 失败且包装 message 含 token → console 输出不含 token', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const { token, seed } = seedRaceClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString()
    })
    const leaking = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'update') {
          return () => {
            throw new Error(`Failed query: update "clients" ...\nparams: ${token}`)
          }
        }
        return () => { throw new Error('unexpected') }
      }
    }) as any
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await refreshClientActivity(leaking, {
      id: seed.id,
      userId: 7,
      token,
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600
    })

    const captured = errorSpy.mock.calls.map((args) => args.map((a: unknown) => String(a)).join(' ')).join('\n')
    errorSpy.mockRestore()
    expect(captured).not.toContain(token)
    expect(captured).toContain('Failed to refresh client activity')
    expect(captured.length).toBeGreaterThan('Failed to refresh client activity'.length)
  })

  test('日志脱敏：refreshClientActivityById 读行失败且包装 message 含 token → console 输出不含 token', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const testDb = createTestDb()
    const token = 'C' + Math.random().toString(36).slice(2, 24)
    const seed = seedClient(testDb, { token })
    const leaking = {
      select() {
        throw new Error(`Failed query: select ... where "id" = ?\nparams: ${token}`)
      }
    } as any
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await refreshClientActivityById(leaking, seed.id)

    const captured = errorSpy.mock.calls.map((args) => args.map((a: unknown) => String(a)).join(' ')).join('\n')
    errorSpy.mockRestore()
    expect(captured).not.toContain(token)
    expect(captured).toContain('Failed to refresh client activity by id')
    expect(captured.length).toBeGreaterThan('Failed to refresh client activity by id'.length)
  })

  test('日志脱敏：cleanupExpiredClients 断连失败且 message 含 token → console 输出不含 token', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const testDb = createTestDb()
    const token = 'C' + Math.random().toString(36).slice(2, 24)
    const seed = seedClient(testDb, {
      userId: 7,
      deviceUid: 'uid-leak-clean',
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() - 1000).toISOString()
    })
    const drizzle = asDrizzle(testDb)
    const disconnectClient = jest.fn(async () => {
      throw new Error(`DO fetch failed: https://hub/do?x=1 token=${token}`)
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const deleted = await cleanupExpiredClients(drizzle, { disconnectClient })

    const captured = errorSpy.mock.calls.map((args) => args.map((a: unknown) => String(a)).join(' ')).join('\n')
    errorSpy.mockRestore()
    expect(deleted).toBe(1)
    expect(captured).not.toContain(token)
    expect(captured).toContain('Failed to disconnect expired client')
  })
})

describe('cleanupExpiredClients（每日 cron 清理）', () => {
  test('删除 expires_at <= now 的 client 并关闭其 WebSocket 连接；未过期与永不过期保留', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const testDb = createTestDb()
    const drizzle = asDrizzle(testDb)
    const expired = seedClient(testDb, {
      userId: 7,
      deviceUid: 'uid-expired',
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() - 1000).toISOString()
    })
    const boundary = seedClient(testDb, {
      userId: 8,
      deviceUid: 'uid-boundary',
      expiresAfterInactivitySeconds: 600,
      expiresAt: T0.toISOString()
    })
    const active = seedClient(testDb, {
      userId: 7,
      deviceUid: 'uid-active',
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString()
    })
    const neverExpires = seedClient(testDb, {
      userId: 7,
      deviceUid: 'uid-never',
      expiresAfterInactivitySeconds: 0,
      expiresAt: null
    })
    const calls: Array<[number, number]> = []
    const disconnectClient = jest.fn(async (userId: number, clientId: number) => {
      calls.push([userId, clientId])
    })

    const deleted = await cleanupExpiredClients(drizzle, { disconnectClient })

    expect(deleted).toBe(2)
    expect(calls).toContainEqual([7, expired.id])
    expect(calls).toContainEqual([8, boundary.id])
    expect(disconnectClient).toHaveBeenCalledTimes(2)
    const remaining = testDb.db.select({ id: clients.id }).from(clients).all().map((r) => r.id)
    expect(remaining).toEqual(expect.arrayContaining([active.id, neverExpires.id]))
    expect(remaining).not.toContainEqual(expired.id)
    expect(remaining).not.toContainEqual(boundary.id)
  })

  test('disconnect 单点失败不影响其他 client 的清理', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const testDb = createTestDb()
    const drizzle = asDrizzle(testDb)
    const a = seedClient(testDb, {
      userId: 7,
      deviceUid: 'uid-a',
      expiresAt: new Date(T0.getTime() - 1000).toISOString()
    })
    const b = seedClient(testDb, {
      userId: 8,
      deviceUid: 'uid-b',
      expiresAt: new Date(T0.getTime() - 1000).toISOString()
    })
    const disconnectClient = jest.fn(async (userId: number) => {
      if (userId === 7) throw new Error('DO unreachable')
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const deleted = await cleanupExpiredClients(drizzle, { disconnectClient })

    expect(deleted).toBe(2)
    const remaining = testDb.db.select({ id: clients.id }).from(clients).all()
    expect(remaining).toHaveLength(0)
    expect(disconnectClient).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })

  test('竞态：SELECT 候选之后续期先生效 → 不删除已续期行，计数以实际删除为准', async () => {
    jest.useFakeTimers().setSystemTime(T0)
    const testDb = createTestDb()
    const drizzle = asDrizzle(testDb)
    const doomed = seedClient(testDb, {
      userId: 7,
      deviceUid: 'uid-doomed',
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() - 1000).toISOString()
    })
    const renewed = seedClient(testDb, {
      userId: 7,
      deviceUid: 'uid-renewed',
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() - 1000).toISOString()
    })

    const realDelete = drizzle.delete.bind(drizzle)
    let injected = false
    const interleaved = new Proxy(drizzle, {
      get(target, prop, receiver) {
        if (prop === 'delete') {
          return (table: unknown) => {
            if (!injected) {
              injected = true
              testDb.db.update(clients).set({
                lastUsed: T0.toISOString(),
                expiresAt: new Date(T0.getTime() + 600_000).toISOString()
              }).where(eq(clients.id, renewed.id)).run()
            }
            return realDelete(table as any)
          }
        }
        return Reflect.get(target, prop, receiver)
      }
    }) as any
    const disconnectClient = jest.fn().mockResolvedValue(undefined)

    const deleted = await cleanupExpiredClients(interleaved, { disconnectClient })


    expect(deleted).toBe(1)
    expect(disconnectClient).toHaveBeenCalledTimes(1)
    expect(disconnectClient).toHaveBeenCalledWith(7, doomed.id)
    expect(getRow(testDb, renewed.id)).toBeDefined()
    expect(getRow(testDb, renewed.id).expiresAt).toBe(new Date(T0.getTime() + 600_000).toISOString())
    expect(getRow(testDb, doomed.id)).toBeUndefined()
  })
})
