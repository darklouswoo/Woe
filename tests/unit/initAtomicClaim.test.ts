












const mockIsDefaultInitAuth = jest.fn()


const mockRun = jest.fn()
const mockBoundRun = jest.fn()
const mockBind = jest.fn()
const mockDb = {
  prepare: jest.fn()
}
const mockDrizzle = {
  $client: mockDb,
  select: jest.fn()
}

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => mockDrizzle)
}))

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    isDefaultInitAuth: (...args: any[]) => mockIsDefaultInitAuth(...args)
  })),
  hashPassword: jest.fn(async () => 'hashed')
}))




jest.mock('../../src/services/migrationRunner.ts', () => ({
  MigrationRunner: class {
    async runPendingMigrations() {}
  }
}))

import { init } from '../../src/routes/init'
import { InitService } from '../../src/services/initService'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_A = '7d4f6ee0-1a2b-4c3d-9e0f-3a4b5c6d7e8f'

function buildExecutionCtx() {
  return {
    waitUntil: jest.fn(),
    passThroughOnException: jest.fn()
  } as any
}

function postAdmin(body?: unknown) {
  return init.fetch(
    new Request('http://localhost/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? { name: 'admin1', pass: 'StrongPass123!' })
    }),
    { DB: {} } as any,
    buildExecutionCtx()
  )
}

describe('InitService.claimInitialization / releaseInitializationClaim / assertClaimOwnership', () => {
  let svc: InitService
  let tablePresent: boolean
  let selectRow: { value: string } | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    tablePresent = true
    selectRow = undefined

    mockDb.prepare.mockImplementation((sqlText: string) => {
      if (sqlText.includes('sqlite_master')) {
        return {
          bind: (name: string) => ({
            first: async () => (name === 'system_state' && tablePresent ? { name } : null)
          })
        }
      }
      return {
        run: mockRun,
        bind: (...args: unknown[]) => {
          mockBind(...args)
          return { run: mockBoundRun }
        }
      }
    })
    mockDrizzle.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          get: async () => selectRow
        })
      })
    }))

    svc = new InitService(mockDb as any)
  })

  test('claimInitialization: changes=1 → 抢占成功，返回 UUID owner token', async () => {
    mockBoundRun.mockResolvedValue({ meta: { changes: 1 } })
    await expect(svc.claimInitialization()).resolves.toMatch(UUID_RE)
  })

  test('claimInitialization: changes=0 → 抢占失败 null', async () => {
    mockBoundRun.mockResolvedValue({ meta: { changes: 0 } })
    await expect(svc.claimInitialization()).resolves.toBeNull()
  })

  test('claimInitialization: meta 缺失/为空 → null（防御式）', async () => {
    mockBoundRun.mockResolvedValue({} as any)
    await expect(svc.claimInitialization()).resolves.toBeNull()
    mockBoundRun.mockResolvedValue({ meta: {} } as any)
    await expect(svc.claimInitialization()).resolves.toBeNull()
  })

  test('claimInitialization: 单条条件 INSERT，同时守护 is_initialized 与 is_initializing；token 经 bind 传入而非拼进 SQL', async () => {
    mockBoundRun.mockResolvedValue({ meta: { changes: 1 } })
    const token = await svc.claimInitialization()
    expect(token).toMatch(UUID_RE)

    expect(mockDb.prepare).toHaveBeenCalled()

    const sql = String(mockDb.prepare.mock.calls[1][0])
    expect(sql).toMatch(/INSERT\s+INTO\s+system_state/i)
    expect(sql).toContain("'is_initializing'")

    expect(sql).toMatch(/SELECT\s+'is_initializing',\s*\?/)
    expect(sql).not.toContain(token)
    expect(mockBind).toHaveBeenCalledTimes(1)
    expect(mockBind).toHaveBeenCalledWith(token)
    const guardCount = (sql.match(/NOT\s+EXISTS/gi) || []).length
    expect(guardCount).toBe(2)
    expect(sql).toContain("key = 'is_initialized'")
    expect(sql).toContain("key = 'is_initializing'")
  })

  test('claimInitialization: INSERT 前先执行过期 claim 清扫（-10 分钟阈值）', async () => {
    mockBoundRun.mockResolvedValue({ meta: { changes: 1 } })
    await svc.claimInitialization()

    expect(mockDb.prepare).toHaveBeenCalledTimes(2)

    const sweepSql = String(mockDb.prepare.mock.calls[0][0])
    expect(sweepSql).toMatch(/DELETE\s+FROM\s+system_state/i)
    expect(sweepSql).toContain("'is_initializing'")
    expect(sweepSql).toContain("-10 minutes")
    expect(sweepSql).toMatch(/datetime\('now',\s*'-10 minutes'\)/i)

    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockBoundRun).toHaveBeenCalledTimes(1)
  })

  test('sweepStaleInitializationClaims: 无参数 DELETE，仅清超过 10 分钟的 is_initializing 残留行', async () => {
    mockRun.mockResolvedValue({ meta: { changes: 0 } })
    await svc.sweepStaleInitializationClaims()

    expect(mockDb.prepare).toHaveBeenCalledTimes(1)
    const sql = String(mockDb.prepare.mock.calls[0][0])
    expect(sql).toMatch(/DELETE\s+FROM\s+system_state/i)
    expect(sql).toContain("'is_initializing'")
    expect(sql).toContain("-10 minutes")
    expect(sql).toMatch(/datetime\('now',\s*'-10 minutes'\)/i)
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockBind).not.toHaveBeenCalled()
  })

  test('releaseInitializationClaim: DELETE 只针对自己的 claim——key+value 双条件、token 经 bind 传入（交叉释放无效）', async () => {

    mockBoundRun.mockResolvedValue({ meta: { changes: 1 } })
    await svc.releaseInitializationClaim('token-a')

    expect(mockDb.prepare).toHaveBeenCalledTimes(1)
    const sql = String(mockDb.prepare.mock.calls[0][0])
    expect(sql).toMatch(/DELETE\s+FROM\s+system_state/i)
    expect(sql).toContain("'is_initializing'")
    expect(sql).toContain("key = 'is_initializing'")
    expect(sql).toMatch(/AND\s+value\s*=\s*\?/)
    expect(sql).not.toContain('token-a')
    expect(mockBind).toHaveBeenCalledTimes(1)
    expect(mockBind).toHaveBeenCalledWith('token-a')
    expect(mockBind).not.toHaveBeenCalledWith('token-b')
    expect(mockRun).not.toHaveBeenCalled()
    expect(mockBoundRun).toHaveBeenCalledTimes(1)
  })

  test('stale-steal 沙盘：A 的 token-a 被清扫后 B 抢得 token-b → A 的迟到 release(token-a) 绑定 token-a、栅栏 assert(token-a) 失败', async () => {

    mockBoundRun.mockResolvedValue({ meta: { changes: 1 } })
    const tokenA = await svc.claimInitialization()
    expect(tokenA).toMatch(UUID_RE)

    const tokenB = await svc.claimInitialization()
    expect(tokenB).toMatch(UUID_RE)
    expect(tokenB).not.toBe(tokenA)
    if (tokenA === null || tokenB === null) throw new Error('stale-steal sandbox: both claims should succeed')


    const prepareCalls = mockDb.prepare.mock.calls.length
    const bindCalls = mockBind.mock.calls.length
    await svc.releaseInitializationClaim(tokenA)
    const releaseSql = String(mockDb.prepare.mock.calls[prepareCalls][0])
    expect(releaseSql).toMatch(/DELETE\s+FROM\s+system_state/i)
    expect(releaseSql).toMatch(/AND\s+value\s*=\s*\?/)
    expect(mockBind.mock.calls[bindCalls][0]).toBe(tokenA)


    selectRow = { value: tokenB }
    await expect(svc.assertClaimOwnership(tokenA)).resolves.toBe(false)
    await expect(svc.assertClaimOwnership(tokenB)).resolves.toBe(true)
  })

  test('assertClaimOwnership: claim 行存在且 value 与 owner 一致 → true', async () => {
    selectRow = { value: 'token-a' }
    await expect(svc.assertClaimOwnership('token-a')).resolves.toBe(true)
  })

  test('assertClaimOwnership: claim 行是他人的 token（被清扫重抢）→ false', async () => {
    selectRow = { value: 'token-b' }
    await expect(svc.assertClaimOwnership('token-a')).resolves.toBe(false)
  })

  test('assertClaimOwnership: 无 claim 行 → false', async () => {
    selectRow = undefined
    await expect(svc.assertClaimOwnership('token-a')).resolves.toBe(false)
  })

  test('assertClaimOwnership: system_state 表不存在 → false 且不查询', async () => {
    tablePresent = false
    await expect(svc.assertClaimOwnership('token-a')).resolves.toBe(false)
    expect(mockDrizzle.select).not.toHaveBeenCalled()
  })

  test('assertClaimOwnership: 数据库错误向上抛出（路由层据此返回 500 而非误报 409）', async () => {
    selectRow = { value: 'token-a' }
    mockDrizzle.select.mockImplementationOnce(() => {
      throw new Error('d1 transient error')
    })
    await expect(svc.assertClaimOwnership('token-a')).rejects.toThrow('d1 transient error')
  })

  test('isInitializationInProgress: claim 行存在（value 为 UUID）→ true', async () => {
    selectRow = { value: TOKEN_A }
    await expect(svc.isInitializationInProgress()).resolves.toBe(true)
  })

  test('isInitializationInProgress: 无 claim 行 → false', async () => {
    selectRow = undefined
    await expect(svc.isInitializationInProgress()).resolves.toBe(false)
  })

  test('isInitializationInProgress: system_state 表不存在 → false 且不查询', async () => {
    tablePresent = false
    await expect(svc.isInitializationInProgress()).resolves.toBe(false)
    expect(mockDrizzle.select).not.toHaveBeenCalled()
  })

  test('getInitStatus: 组合 initializing 状态，进行中时 canInitialize=false', async () => {
    jest.spyOn(InitService.prototype, 'isSystemInitialized').mockResolvedValue(false)
    jest.spyOn(InitService.prototype, 'hasAdminUser').mockResolvedValue(false)
    jest.spyOn(InitService.prototype, 'isInitializationLocked').mockResolvedValue(false)
    const progressSpy = jest
      .spyOn(InitService.prototype, 'isInitializationInProgress')
      .mockResolvedValue(true)

    const status = await svc.getInitStatus()

    expect(progressSpy).toHaveBeenCalledTimes(1)
    expect(status).toEqual({
      initialized: false,
      hasAdmin: false,
      locked: false,
      initializing: true,
      canInitialize: false
    })

    progressSpy.mockResolvedValue(false)
    const status2 = await svc.getInitStatus()
    expect(status2.initializing).toBe(false)
    expect(status2.canInitialize).toBe(true)
  })
})

describe('POST /init/admin claim-first + 双栅栏流程', () => {
  let spies: Record<string, jest.SpyInstance>

  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    mockIsDefaultInitAuth.mockResolvedValue(true)

    spies = {
      isSystemInitialized: jest.spyOn(InitService.prototype, 'isSystemInitialized').mockResolvedValue(false),
      isInitializationLocked: jest.spyOn(InitService.prototype, 'isInitializationLocked').mockResolvedValue(false),
      isInitializationInProgress: jest.spyOn(InitService.prototype, 'isInitializationInProgress').mockResolvedValue(false),
      ensureSchema: jest.spyOn(InitService.prototype, 'ensureSchema').mockResolvedValue(undefined),
      validateDatabase: jest.spyOn(InitService.prototype, 'validateDatabase').mockResolvedValue(true),
      sweepStaleInitializationClaims: jest.spyOn(InitService.prototype, 'sweepStaleInitializationClaims').mockResolvedValue(undefined),
      claimInitialization: jest.spyOn(InitService.prototype, 'claimInitialization').mockResolvedValue(TOKEN_A),
      assertClaimOwnership: jest.spyOn(InitService.prototype, 'assertClaimOwnership').mockResolvedValue(true),
      createAdminUser: jest.spyOn(InitService.prototype, 'createAdminUser').mockResolvedValue(1),
      markAsInitialized: jest.spyOn(InitService.prototype, 'markAsInitialized').mockResolvedValue(undefined),
      lockInitialization: jest.spyOn(InitService.prototype, 'lockInitialization').mockResolvedValue(undefined),
      releaseInitializationClaim: jest.spyOn(InitService.prototype, 'releaseInitializationClaim').mockResolvedValue(undefined)
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('成功路径：claim → assert → create → assert → mark → lock 顺序执行，release 携带 claim token；响应形状保持 { ok: true }', async () => {
    const response = await postAdmin()

    expect(response.status).toBe(200)
    const body = (await response.json()) as any
    expect(body).toEqual({ ok: true })

    const order = (s: jest.SpyInstance, call = 0) => s.mock.invocationCallOrder[call]
    expect(order(spies.claimInitialization)).toBeLessThan(order(spies.assertClaimOwnership, 0))
    expect(order(spies.assertClaimOwnership, 0)).toBeLessThan(order(spies.createAdminUser))
    expect(order(spies.createAdminUser)).toBeLessThan(order(spies.assertClaimOwnership, 1))
    expect(order(spies.assertClaimOwnership, 1)).toBeLessThan(order(spies.markAsInitialized))
    expect(spies.markAsInitialized).toHaveBeenCalledTimes(1)
    expect(order(spies.markAsInitialized)).toBeLessThan(order(spies.lockInitialization))

    expect(spies.releaseInitializationClaim).toHaveBeenCalledTimes(1)
    expect(spies.releaseInitializationClaim).toHaveBeenCalledWith(TOKEN_A)
    expect(order(spies.lockInitialization)).toBeLessThan(order(spies.releaseInitializationClaim))

    expect(spies.assertClaimOwnership).toHaveBeenCalledTimes(2)
    expect(spies.assertClaimOwnership).toHaveBeenNthCalledWith(1, TOKEN_A)
    expect(spies.assertClaimOwnership).toHaveBeenNthCalledWith(2, TOKEN_A)
  })

  test('claim 失败（已被并发抢占）→ 403，且不建号不栅栏不释放', async () => {
    spies.claimInitialization.mockResolvedValue(null)

    const response = await postAdmin()

    expect(response.status).toBe(403)
    const body = (await response.json()) as any
    expect(body.errorDescription).toContain('being initialized')
    expect(spies.assertClaimOwnership).not.toHaveBeenCalled()
    expect(spies.createAdminUser).not.toHaveBeenCalled()
    expect(spies.markAsInitialized).not.toHaveBeenCalled()
    expect(spies.releaseInitializationClaim).not.toHaveBeenCalled()
  })

  test('栅栏失效（建号前失去所有权）→ 409 精确消息，不建号、不写完成态、不释放他人 claim', async () => {
    spies.assertClaimOwnership.mockResolvedValue(false)

    const response = await postAdmin()

    expect(response.status).toBe(409)
    const body = (await response.json()) as any
    expect(body.errorDescription).toBe('Initialization claim lost to a concurrent attempt')
    expect(spies.assertClaimOwnership).toHaveBeenCalledTimes(1)
    expect(spies.assertClaimOwnership).toHaveBeenCalledWith(TOKEN_A)
    expect(spies.createAdminUser).not.toHaveBeenCalled()
    expect(spies.markAsInitialized).not.toHaveBeenCalled()
    expect(spies.lockInitialization).not.toHaveBeenCalled()

    expect(spies.releaseInitializationClaim).not.toHaveBeenCalled()
  })

  test('栅栏失效（finalize 前失去所有权）→ 409（注明管理员可能已建），不写完成态、不释放他人 claim', async () => {
    spies.assertClaimOwnership.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const response = await postAdmin()

    expect(response.status).toBe(409)
    const body = (await response.json()) as any

    expect(body.errorDescription).toBe(
      'Initialization claim lost to a concurrent attempt; admin user may exist — check server logs before retry'
    )
    expect(spies.assertClaimOwnership).toHaveBeenCalledTimes(2)
    expect(spies.createAdminUser).toHaveBeenCalledTimes(1)
    expect(spies.markAsInitialized).not.toHaveBeenCalled()
    expect(spies.lockInitialization).not.toHaveBeenCalled()
    expect(spies.releaseInitializationClaim).not.toHaveBeenCalled()
  })

  test('栅栏校验自身抛错（建号前）→ 500 而非 409，并释放自己的 claim', async () => {
    spies.assertClaimOwnership.mockRejectedValue(new Error('d1 hiccup'))

    const response = await postAdmin()

    expect(response.status).toBe(500)
    const body = (await response.json()) as any
    expect(body.errorDescription).toBe('Initialization state check failed')
    expect(spies.createAdminUser).not.toHaveBeenCalled()
    expect(spies.releaseInitializationClaim).toHaveBeenCalledTimes(1)
    expect(spies.releaseInitializationClaim).toHaveBeenCalledWith(TOKEN_A)
  })

  test('栅栏校验自身抛错（finalize 前）→ 500 而非 409，并释放自己的 claim', async () => {
    spies.assertClaimOwnership.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('d1 hiccup'))

    const response = await postAdmin()

    expect(response.status).toBe(500)
    const body = (await response.json()) as any

    expect(body.errorDescription).toBe(
      'Initialization state check failed; admin user may exist — check server logs before retry'
    )
    expect(spies.createAdminUser).toHaveBeenCalledTimes(1)
    expect(spies.markAsInitialized).not.toHaveBeenCalled()
    expect(spies.releaseInitializationClaim).toHaveBeenCalledTimes(1)
    expect(spies.releaseInitializationClaim).toHaveBeenCalledWith(TOKEN_A)
  })

  test('预检发现初始化进行中 → 403，且不尝试抢占', async () => {
    spies.isInitializationInProgress.mockResolvedValue(true)

    const response = await postAdmin()

    expect(response.status).toBe(403)
    expect(spies.claimInitialization).not.toHaveBeenCalled()
    expect(spies.createAdminUser).not.toHaveBeenCalled()
  })

  test('预检自动清扫：sweep 先于 in-progress 检查与 claim 执行，过期残留 claim 不再把请求卡在 403', async () => {


    const response = await postAdmin()

    expect(response.status).toBe(200)
    const order = (s: jest.SpyInstance, call = 0) => s.mock.invocationCallOrder[call]
    expect(spies.sweepStaleInitializationClaims).toHaveBeenCalledTimes(1)
    expect(order(spies.sweepStaleInitializationClaims)).toBeLessThan(order(spies.isInitializationInProgress))
    expect(order(spies.isInitializationInProgress)).toBeLessThan(order(spies.claimInitialization))
    expect(spies.claimInitialization).toHaveBeenCalledTimes(1)
  })

  test('预检清扫失败（best-effort）→ console.warn 后不阻断预检，请求继续', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    spies.sweepStaleInitializationClaims.mockRejectedValue(new Error('no such table: system_state'))

    const response = await postAdmin()

    expect(response.status).toBe(200)
    expect(warnSpy).toHaveBeenCalled()
    expect(spies.claimInitialization).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  test('createAdminUser 返回 null（重名）→ 409 并释放自己的 claim（携带 token）', async () => {
    spies.createAdminUser.mockResolvedValue(null)

    const response = await postAdmin()

    expect(response.status).toBe(409)
    const body = (await response.json()) as any
    expect(body.errorDescription).toContain('already exists')
    expect(spies.releaseInitializationClaim).toHaveBeenCalledTimes(1)
    expect(spies.releaseInitializationClaim).toHaveBeenCalledWith(TOKEN_A)
    expect(spies.markAsInitialized).not.toHaveBeenCalled()
    expect(spies.lockInitialization).not.toHaveBeenCalled()
  })

  test('createAdminUser 抛异常 → 500 并释放自己的 claim（携带 token）', async () => {
    spies.createAdminUser.mockRejectedValue(new Error('db explode'))

    const response = await postAdmin()

    expect(response.status).toBe(500)
    expect(spies.releaseInitializationClaim).toHaveBeenCalledTimes(1)
    expect(spies.releaseInitializationClaim).toHaveBeenCalledWith(TOKEN_A)
    expect(spies.markAsInitialized).not.toHaveBeenCalled()
  })

  test('markAsInitialized 抛异常 → 500 并释放自己的 claim（携带 token）', async () => {
    spies.markAsInitialized.mockRejectedValue(new Error('state write failed'))

    const response = await postAdmin()

    expect(response.status).toBe(500)
    expect(spies.lockInitialization).not.toHaveBeenCalled()
    expect(spies.releaseInitializationClaim).toHaveBeenCalledTimes(1)
    expect(spies.releaseInitializationClaim).toHaveBeenCalledWith(TOKEN_A)
  })

  test('lockInitialization 抛异常 → 500 并释放自己的 claim（携带 token）', async () => {
    spies.lockInitialization.mockRejectedValue(new Error('lock write failed'))

    const response = await postAdmin()

    expect(response.status).toBe(500)
    expect(spies.releaseInitializationClaim).toHaveBeenCalledTimes(1)
    expect(spies.releaseInitializationClaim).toHaveBeenCalledWith(TOKEN_A)
  })

  test('claim 之前失败的路径（body 缺字段）不产生 claim，也不需要释放', async () => {
    const response = await postAdmin({ name: 'admin1' })

    expect(response.status).toBe(400)
    expect(spies.claimInitialization).not.toHaveBeenCalled()
    expect(spies.createAdminUser).not.toHaveBeenCalled()
    expect(spies.releaseInitializationClaim).not.toHaveBeenCalled()
  })

  test('ensureSchema 失败 → 500 返回通用消息（不回显异常细节）且未抢占 claim', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    spies.ensureSchema.mockRejectedValue(new Error('secret-migration-detail'))

    const response = await postAdmin()

    expect(response.status).toBe(500)
    const body = (await response.json()) as any
    expect(body.errorDescription).not.toContain('secret-migration-detail')
    expect(body.errorDescription.length).toBeGreaterThan(0)
    expect(consoleSpy).toHaveBeenCalled()
    expect(spies.claimInitialization).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('GET /init/status 暴露 initializing 状态', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  test('状态响应包含 initializing 字段', async () => {
    jest.spyOn(InitService.prototype, 'getInitStatus').mockResolvedValue({
      initialized: false,
      hasAdmin: false,
      locked: false,
      initializing: true,
      canInitialize: false
    })

    const response = await init.fetch(
      new Request('http://localhost/status', { method: 'GET' }),
      { DB: {} } as any,
      {
        waitUntil: jest.fn(),
        passThroughOnException: jest.fn()
      } as any
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as any
    expect(body.initializing).toBe(true)
    expect(body.canInitialize).toBe(false)
  })
})
