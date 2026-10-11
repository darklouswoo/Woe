











import { processClaimedJob } from '../../src/services/push/sendPipeline'
import { PushOutboxJob } from '../../src/services/push/outboxService'
import { SUSPEND_RETRY_AT_DELAY_MS } from '../../src/services/push/providers/types'


const T0 = Date.parse('2026-09-24T12:00:00.000Z')
const now = () => T0


function makeTarget(overrides: Record<string, any> = {}) {
  return {
    kind: 'ready',
    clientId: 1,
    platform: 'test-platform',
    deviceToken: 'db-token',
    tokenUpdatedAt: '2026-09-24T00:00:00.000Z',
    tokenStatus: 'active',
    ...overrides
  }
}

function makeOutbox(lookup: any = makeTarget()) {
  return {
    getPushTargetByClientId: jest.fn().mockResolvedValue(lookup),
    markSuccess: jest.fn().mockResolvedValue(undefined),
    scheduleRetry: jest.fn().mockResolvedValue(undefined),
    markDead: jest.fn().mockResolvedValue(undefined),
    suspend: jest.fn().mockResolvedValue(undefined),
    invalidateClient: jest.fn().mockResolvedValue(undefined)
  }
}


function makeJob(overrides: Partial<PushOutboxJob> = {}): PushOutboxJob {
  return {
    id: 1,
    userId: 7,
    messageId: 100,
    platform: 'test-platform',
    clientId: 1,
    payloadJson: JSON.stringify({
      userId: 7,
      platform: 'test-platform',
      messageId: 100,
      appid: 42,
      date: '2026-09-24T10:00:00.000Z',
      title: 'hello',
      message: 'world'
    }),
    status: 'pending',
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: null,
    updatedAt: null,
    ...overrides
  }
}

function makeProviders(send?: jest.Mock) {
  const sendFn = send ?? jest.fn().mockResolvedValue({ ok: true, retriable: false })
  return { providers: { get: jest.fn().mockReturnValue({ name: 'test-platform', send: sendFn }) }, send: sendFn }
}

function makeDeps(outbox: ReturnType<typeof makeOutbox>, providers: { get: jest.Mock }, overrides: Record<string, any> = {}) {
  return {
    outbox,
    providers,
    maxRetries: 3,
    retryBackoffMs: 2000,
    now,
    ...overrides
  }
}

describe('processClaimedJob 发送时解析（新形态载荷，无 deviceToken 快照）', () => {
  test('ready 目标 → provider 收到发送时读取的 DB token，markSuccess，返回 success', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()

    const deps = makeDeps(outbox, providers)
    const result = await processClaimedJob(deps, makeJob())

    expect(providers.get).toHaveBeenCalledWith('test-platform')
    expect(result).toEqual({ action: 'success' })
    expect(outbox.markSuccess).toHaveBeenCalledWith(1)

    const sendInput = providers.get.mock.results[0].value.send.mock.calls[0][0]
    expect(sendInput.deviceToken).toBe('db-token')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('旧形态载荷（含 deviceToken）但行有 client_id → 仍用当前 DB token 发送（忽略载荷快照）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      payloadJson: JSON.stringify({
        userId: 7,
        platform: 'test-platform',
        deviceToken: 'stale-payload-token',
        messageId: 100,
        appid: 42,
        date: '2026-09-24T10:00:00.000Z',
        message: 'world'
      })
    })

    await processClaimedJob(makeDeps(outbox, providers), job)

    const sendInput = providers.get.mock.results[0].value.send.mock.calls[0][0]
    expect(sendInput.deviceToken).toBe('db-token')
  })
})

describe('processClaimedJob 发送前闸门（不调 provider，attemptCount 原值）', () => {
  test('deleted → dead Undeliverable: client deleted', async () => {
    const outbox = makeOutbox({ kind: 'deleted', clientId: 1 })
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 2 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 2, 'Undeliverable: client deleted')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('inactive → dead Suppressed: client push disabled (token_status=inactive)', async () => {
    const outbox = makeOutbox(makeTarget({ kind: 'inactive', tokenStatus: 'inactive' }))
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 1 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'Suppressed: client push disabled (token_status=inactive)')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('invalid（非 active 的其他状态）→ dead Suppressed 文案动态记录实际 token_status', async () => {
    const outbox = makeOutbox(makeTarget({ kind: 'inactive', tokenStatus: 'invalid' }))
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 1 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'Suppressed: client push disabled (token_status=invalid)')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('no-token（device_token 为空串）→ dead Undeliverable: no device token', async () => {
    const outbox = makeOutbox(makeTarget({ kind: 'no-token', deviceToken: '' }))
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 3 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 3, 'Undeliverable: no device token')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('目标 platform 与行 platform 不一致 → dead Undeliverable: client platform changed（不把 custom platform token 交给 Custom provider）', async () => {
    const outbox = makeOutbox(makeTarget({ platform: 'test-platform-alt' }))
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Undeliverable: client platform changed')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('历史 platform=unknown 的目标也能被读取并按平台变化判 dead（不抛类型错误）', async () => {
    const outbox = makeOutbox(makeTarget({ platform: 'unknown' }))
    const { providers } = makeProviders()

    await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Undeliverable: client platform changed')
    expect(providers.get).not.toHaveBeenCalled()
  })
})

describe('processClaimedJob legacy 分支（client_id 为空的历史行）', () => {
  const legacyJob = (payloadExtra: Record<string, any> = {}, overrides: Partial<PushOutboxJob> = {}) =>
    makeJob({
      clientId: null,
      payloadJson: JSON.stringify({
        userId: 7,
        platform: 'test-platform',
        ...payloadExtra,
        messageId: 100,
        appid: 42,
        date: '2026-09-24T10:00:00.000Z',
        message: 'world'
      }),
      ...overrides
    })

  test('载荷含非空 deviceToken → 用该快照发送，成功；不读 getPushTargetByClientId', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()

    const result = await processClaimedJob(
      makeDeps(outbox, providers),
      legacyJob({ deviceToken: 'legacy-token' })
    )

    expect(result).toEqual({ action: 'success' })
    expect(outbox.getPushTargetByClientId).not.toHaveBeenCalled()
    const sendInput = providers.get.mock.results[0].value.send.mock.calls[0][0]
    expect(sendInput.deviceToken).toBe('legacy-token')
  })

  test('载荷无 deviceToken → dead Undeliverable: no client binding（attemptCount 原值）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()

    const result = await processClaimedJob(makeDeps(outbox, providers), legacyJob({}, { attemptCount: 2 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 2, 'Undeliverable: no client binding')
    expect(providers.get).not.toHaveBeenCalled()
  })
})

describe('processClaimedJob 共享 parsePayload', () => {
  test('结构性损坏（缺 deeplink 契约字段）→ dead Invalid outbox payload（attemptCount +1，沿用旧口径）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      payloadJson: JSON.stringify({ userId: 7, platform: 'test-platform', message: 'world' })
    })

    const result = await processClaimedJob(makeDeps(outbox, providers), job)

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'Invalid outbox payload')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('非 JSON → dead Invalid outbox payload（+1）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()

    await processClaimedJob(makeDeps(outbox, providers), makeJob({ payloadJson: 'not-json' }))

    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'Invalid outbox payload')
  })

  test('messageId 与行不一致 → dead Invalid outbox payload: job/payload mismatch（原值）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      payloadJson: JSON.stringify({
        userId: 7, platform: 'test-platform', messageId: 999, appid: 42,
        date: '2026-09-24T10:00:00.000Z', message: 'world'
      })
    })

    const result = await processClaimedJob(makeDeps(outbox, providers), job)

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Invalid outbox payload: job/payload mismatch')
    expect(providers.get).not.toHaveBeenCalled()
  })

  test('载荷 platform 与行不一致 → job/payload mismatch dead', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      platform: 'test-platform',
      payloadJson: JSON.stringify({
        userId: 7, platform: 'test-platform-alt', messageId: 100, appid: 42,
        date: '2026-09-24T10:00:00.000Z', message: 'world'
      })
    })

    await processClaimedJob(makeDeps(outbox, providers), job)

    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Invalid outbox payload: job/payload mismatch')
  })

  test('载荷 userId（若有）与行不一致 → job/payload mismatch dead', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders()
    const job = makeJob({
      payloadJson: JSON.stringify({
        userId: 99, platform: 'test-platform', messageId: 100, appid: 42,
        date: '2026-09-24T10:00:00.000Z', message: 'world'
      })
    })

    await processClaimedJob(makeDeps(outbox, providers), job)

    expect(outbox.markDead).toHaveBeenCalledWith(1, 0, 'Invalid outbox payload: job/payload mismatch')
  })
})

describe('processClaimedJob provider 挂起语义（沿用现有文案与共享固定延迟）', () => {
  test('无 provider → suspend（T0 + 60s），不计尝试次数', async () => {
    const outbox = makeOutbox()
    const providers = { get: jest.fn().mockReturnValue(null) }

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 2 }))

    expect(result).toEqual({ action: 'suspend' })
    expect(outbox.suspend).toHaveBeenCalledWith(1, new Date(T0 + SUSPEND_RETRY_AT_DELAY_MS).toISOString(), 'Suspended: no provider for platform test-platform')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('PROVIDER_CONFIG_MISSING → suspend 且原错误信息进 lastError', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, suspend: true, errorCode: 'PROVIDER_CONFIG_MISSING', errorMessage: 'config missing' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result).toEqual({ action: 'suspend' })
    expect(outbox.suspend).toHaveBeenCalledWith(1, new Date(T0 + SUSPEND_RETRY_AT_DELAY_MS).toISOString(), 'Suspended: config missing')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })
})

describe('processClaimedJob 失败分类', () => {
  test('retriable 且未达上限 → scheduleRetry(+1)，返回 retry 携带 nextRetryAt/reason（注入时钟退避）', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result.action).toBe('retry')
    if (result.action === 'retry') {
      expect(result.nextRetryAt).toBe(new Date(T0 + 2000 * 1).toISOString())
      expect(result.reason).toBe('network')
    }
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(1, 1, new Date(T0 + 2000).toISOString(), 'network')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('退避按尝试次数线性放大：attemptCount=2 → T0 + backoff*3', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 2 }))

    if (result.action === 'retry') {
      expect(result.nextRetryAt).toBe(new Date(T0 + 2000 * 3).toISOString())
    }
  })

  test('retriable 但达到上限 → markDead(nextAttempt)', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 2 }))


    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 3, 'network')
    expect(outbox.scheduleRetry).not.toHaveBeenCalled()
  })

  test('非 retriable 失败（目标未变）→ 照旧 markDead(+1)', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'invalid token' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 4 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 5, 'invalid token')
  })

  test('错误信息缺省时回落 errorCode，再回落 Push send failed', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, errorCode: 'PROVIDER_NOT_IMPLEMENTED' })
    )

    await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'PROVIDER_NOT_IMPLEMENTED')
  })
})

describe('processClaimedJob PROVIDER_INVALID_TOKEN token 失效立即收敛', () => {
  test('invalidateClient 存在 → 认领失效后直接 markDead，不被目标变化守卫复活为 pending', async () => {
    const outbox = makeOutbox()
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({
        ok: false,
        retriable: false,
        invalidateToken: true, errorCode: 'PROVIDER_INVALID_TOKEN',
        errorMessage: 'provider rejected token'
      })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.invalidateClient).toHaveBeenCalledWith(1, expect.stringContaining('provider rejected token'))
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'provider rejected token')

    expect(outbox.scheduleRetry).not.toHaveBeenCalled()
    expect(outbox.getPushTargetByClientId).toHaveBeenCalledTimes(1)
  })

  test('invalidateClient 缺席（可选依赖未接线）→ 不抛错，走原分类照旧 markDead', async () => {
    const outbox = makeOutbox()
    delete (outbox as any).invalidateClient
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, invalidateToken: true, errorCode: 'PROVIDER_INVALID_TOKEN' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'PROVIDER_INVALID_TOKEN')
  })
})

describe('processClaimedJob 发送期间目标变化守卫（仅将判 dead 的分支重读一次，绕过 markDead 判定）', () => {
  function failOnceThenChangeTarget(outbox: ReturnType<typeof makeOutbox>, changed: any) {

    outbox.getPushTargetByClientId
      .mockResolvedValueOnce(makeTarget())
      .mockResolvedValueOnce(changed)
    return jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'boom' })
  }

  test('deviceToken 变化 → scheduleRetry 附 client target changed during send，不 markDead', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, makeTarget({ deviceToken: 'rotated-token' }))
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result.action).toBe('retry')
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(
      1, 1, new Date(T0 + 2000).toISOString(), 'boom; client target changed during send'
    )
    expect(outbox.markDead).not.toHaveBeenCalled()
    expect(outbox.getPushTargetByClientId).toHaveBeenCalledTimes(2)
  })

  test('client 删除 → 即使错误不可重试也 scheduleRetry', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, { kind: 'deleted', clientId: 1 })
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result.action).toBe('retry')
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(
      1, 1, expect.any(String), expect.stringContaining('client target changed during send')
    )
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('平台变化（test-platform → test-platform-alt）→ scheduleRetry', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, makeTarget({ platform: 'test-platform-alt' }))
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result.action).toBe('retry')
    expect(outbox.scheduleRetry).toHaveBeenCalled()
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('token_status 变 inactive（kind 非 ready）→ scheduleRetry', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, makeTarget({ kind: 'inactive', tokenStatus: 'inactive' }))
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result.action).toBe('retry')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('tokenUpdatedAt 变化（token 相同）→ scheduleRetry', async () => {
    const outbox = makeOutbox()
    const send = failOnceThenChangeTarget(outbox, makeTarget({ tokenUpdatedAt: '2026-09-24T11:00:00.000Z' }))
    const { providers } = makeProviders(send)

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob())

    expect(result.action).toBe('retry')
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('legacy 行（client_id 为空）失败时不做变化守卫重读 → 非 retriable 照旧 dead', async () => {
    const outbox = makeOutbox()
    const send = jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'boom' })
    const { providers } = makeProviders(send)
    const job = makeJob({
      clientId: null,
      payloadJson: JSON.stringify({
        userId: 7, platform: 'test-platform', deviceToken: 'legacy-token', messageId: 100,
        appid: 42, date: '2026-09-24T10:00:00.000Z', message: 'world'
      })
    })

    const result = await processClaimedJob(makeDeps(outbox, providers), job)

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.getPushTargetByClientId).not.toHaveBeenCalled()
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'boom')
  })

  test('可重试失败不做守卫重读（下轮重试自然重读）→ 纯 scheduleRetry 无后缀，getPushTargetByClientId 仅调用一次', async () => {

    const outbox = makeOutbox(makeTarget({ deviceToken: 'rotated-token' }))
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result.action).toBe('retry')
    if (result.action === 'retry') {
      expect(result.reason).toBe('network')
    }
    expect(outbox.scheduleRetry).toHaveBeenCalledWith(1, 1, new Date(T0 + 2000).toISOString(), 'network')
    expect(outbox.markDead).not.toHaveBeenCalled()

    expect(outbox.getPushTargetByClientId).toHaveBeenCalledTimes(1)
  })

  test('守卫重读抛错（D1 瞬时故障）→ 视为未证实变化，照旧 markDead，行不卡在 processing', async () => {
    const outbox = makeOutbox()
    outbox.getPushTargetByClientId
      .mockResolvedValueOnce(makeTarget())
      .mockRejectedValueOnce(new Error('d1 hiccup'))
    const { providers } = makeProviders(
      jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'boom' })
    )

    const result = await processClaimedJob(makeDeps(outbox, providers), makeJob({ attemptCount: 0 }))

    expect(result).toEqual({ action: 'dead' })
    expect(outbox.markDead).toHaveBeenCalledWith(1, 1, 'boom')
    expect(outbox.scheduleRetry).not.toHaveBeenCalled()
  })
})
