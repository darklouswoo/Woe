




















import { ApplicationHandlers } from '../../src/handlers/applicationHandlers'
import { createApplicationDeleteDb } from '../helpers/applicationDeleteDb'
import { asDrizzle } from '../helpers/testDb'
import type { TestDb } from '../helpers/testDb'
import { makeD1Sqlite } from '../helpers/d1Sqlite'
import { applications, messages } from '../../src/models'
import { eq } from 'drizzle-orm'


jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })


const openDbs: TestDb[] = []

afterEach(() => {
  while (openDbs.length) {
    openDbs.pop()!.sqlite.close()
  }
})


function makeDeleteFixture() {
  const testDb = createApplicationDeleteDb()
  openDbs.push(testDb)
  const handlers = new ApplicationHandlers(asDrizzle(testDb), makeD1Sqlite(testDb))
  return { testDb, handlers }
}

function getAppRow(testDb: TestDb, id: number) {
  return testDb.db.select().from(applications).where(eq(applications.id, id)).all()[0]
}

function getMessageRow(testDb: TestDb, id: number) {
  return testDb.db.select().from(messages).where(eq(messages.id, id)).all()[0]
}

function countMessagesByApp(testDb: TestDb, appid: number) {
  return testDb.db.select().from(messages).where(eq(messages.appid, appid)).all().length
}


function seedApp(
  testDb: TestDb,
  overrides: Partial<typeof applications.$inferInsert> = {}
): typeof applications.$inferSelect {
  const base: typeof applications.$inferInsert = {
    userId: 7,
    token: 'Atarget-' + Math.random().toString(36).slice(2),
    name: 'Target App',
    ...overrides
  }
  const [row] = testDb.db.insert(applications).values(base).returning().all()
  return row
}


function seedMessage(
  testDb: TestDb,
  overrides: Partial<typeof messages.$inferInsert> = {}
): typeof messages.$inferSelect {
  const base: typeof messages.$inferInsert = {
    userid: 7,
    appid: 1,
    message: 'm',
    ...overrides
  }
  const [row] = testDb.db.insert(messages).values(base).returning().all()
  return row
}


function interleaveBeforeBatch(
  testDb: TestDb,
  mutate: () => void
): { testDb: TestDb; handlers: ApplicationHandlers } {
  const base = makeD1Sqlite(testDb)
  const interleaved = {
    prepare: (sql: string) => base.prepare(sql),
    batch: async (stmts: Parameters<typeof base.batch>[0]) => {
      mutate()
      return base.batch(stmts)
    }
  }
  const handlers = new ApplicationHandlers(asDrizzle(testDb), interleaved as any)
  return { testDb, handlers }
}

describe('deleteApplication：含消息应用的原子删除', () => {
  test('目标应用含 2 条消息（其中一条历史异常 userid）：200 {}，应用与全部 appid 子消息消失，另一属主应用/消息仍在', async () => {
    const { testDb, handlers } = makeDeleteFixture()
    const target = seedApp(testDb)
    const normalMessage = seedMessage(testDb, { appid: target.id, userid: 7 })

    const legacyMessage = seedMessage(testDb, { appid: target.id, userid: 999 })
    const otherOwnerApp = seedApp(testDb, { userId: 8, token: 'Aother-owner' })
    const otherOwnerMessage = seedMessage(testDb, { appid: otherOwnerApp.id, userid: 8 })

    const response = await handlers.deleteApplication(7, String(target.id))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})

    expect(getAppRow(testDb, target.id)).toBeUndefined()
    expect(getMessageRow(testDb, normalMessage.id)).toBeUndefined()
    expect(getMessageRow(testDb, legacyMessage.id)).toBeUndefined()
    expect(countMessagesByApp(testDb, target.id)).toBe(0)

    expect(getAppRow(testDb, otherOwnerApp.id)).toBeDefined()
    expect(getMessageRow(testDb, otherOwnerMessage.id)).toBeDefined()
    expect(countMessagesByApp(testDb, otherOwnerApp.id)).toBe(1)
  })

  test('无消息应用删除也 200 {}', async () => {
    const { testDb, handlers } = makeDeleteFixture()
    const target = seedApp(testDb)

    const response = await handlers.deleteApplication(7, String(target.id))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expect(getAppRow(testDb, target.id)).toBeUndefined()
  })

  test('非属主删除 → 404（原响应形状），零写入', async () => {
    const { testDb, handlers } = makeDeleteFixture()
    const target = seedApp(testDb)
    const targetMessage = seedMessage(testDb, { appid: target.id })

    const response = await handlers.deleteApplication(8, String(target.id))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Not Found',
      errorCode: 404,
      errorDescription: 'Application not found'
    })
    expect(getAppRow(testDb, target.id)).toBeDefined()
    expect(getMessageRow(testDb, targetMessage.id)).toBeDefined()
  })

  test('internal=1 → 403（原响应形状），零写入', async () => {
    const { testDb, handlers } = makeDeleteFixture()
    const internalApp = seedApp(testDb, { internal: true })
    const internalMessage = seedMessage(testDb, { appid: internalApp.id })

    const response = await handlers.deleteApplication(7, String(internalApp.id))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden',
      errorCode: 403,
      errorDescription: 'Internal applications cannot be deleted'
    })
    expect(getAppRow(testDb, internalApp.id)).toBeDefined()
    expect(getMessageRow(testDb, internalMessage.id)).toBeDefined()
  })

  test('批内第二句 DELETE applications 失败（BEFORE DELETE RAISE ABORT）→ 500，消息/应用均保留（整批回滚）', async () => {
    const { testDb, handlers } = makeDeleteFixture()
    const target = seedApp(testDb)
    const targetMessage = seedMessage(testDb, { appid: target.id })


    testDb.sqlite.exec(
      `CREATE TRIGGER app_delete_fail BEFORE DELETE ON applications
       BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END`
    )

    const response = await handlers.deleteApplication(7, String(target.id))

    expect(response.status).toBe(500)
    expect(getAppRow(testDb, target.id)).toBeDefined()
    expect(getMessageRow(testDb, targetMessage.id)).toBeDefined()
  })

  test('预查后目标应用已被并发删除 → 404，零写入且不删其它数据', async () => {
    const testDb = createApplicationDeleteDb()
    openDbs.push(testDb)
    const target = seedApp(testDb)
    seedMessage(testDb, { appid: target.id })
    const bystander = seedApp(testDb, { userId: 8, token: 'Abystander' })
    const bystanderMessage = seedMessage(testDb, { appid: bystander.id, userid: 8 })


    const { handlers } = interleaveBeforeBatch(testDb, () => {
      testDb.sqlite.prepare('DELETE FROM messages WHERE appid = ?').run(target.id)
      testDb.sqlite.prepare('DELETE FROM applications WHERE id = ?').run(target.id)
    })

    const response = await handlers.deleteApplication(7, String(target.id))

    expect(response.status).toBe(404)
    expect(getAppRow(testDb, bystander.id)).toBeDefined()
    expect(getMessageRow(testDb, bystanderMessage.id)).toBeDefined()
  })

  test('预查后目标应用被改属主 → 404，零写入（不删他人应用/消息）', async () => {
    const testDb = createApplicationDeleteDb()
    openDbs.push(testDb)
    const target = seedApp(testDb)
    const targetMessage = seedMessage(testDb, { appid: target.id })


    const { handlers } = interleaveBeforeBatch(testDb, () => {
      testDb.sqlite.prepare('UPDATE applications SET user_id = 8 WHERE id = ?').run(target.id)
    })

    const response = await handlers.deleteApplication(7, String(target.id))

    expect(response.status).toBe(404)

    expect(getAppRow(testDb, target.id)).toMatchObject({ id: target.id, userId: 8 })
    expect(getMessageRow(testDb, targetMessage.id)).toBeDefined()
  })

  test('预查后目标应用被转为 internal → 404，零写入（internal 规则在批内复核）', async () => {
    const testDb = createApplicationDeleteDb()
    openDbs.push(testDb)
    const target = seedApp(testDb)
    const targetMessage = seedMessage(testDb, { appid: target.id })


    const { handlers } = interleaveBeforeBatch(testDb, () => {
      testDb.sqlite.prepare('UPDATE applications SET internal = 1 WHERE id = ?').run(target.id)
    })

    const response = await handlers.deleteApplication(7, String(target.id))

    expect(response.status).toBe(404)

    expect(getAppRow(testDb, target.id)).toMatchObject({ id: target.id, internal: true })
    expect(getMessageRow(testDb, targetMessage.id)).toBeDefined()
  })

  test('异常 D1Result 形状不默认成功 → 500；形状异常无事务回滚保证，不宣称写入可撤回', async () => {
    const testDb = createApplicationDeleteDb()
    openDbs.push(testDb)
    const target = seedApp(testDb)
    const base = makeD1Sqlite(testDb)

    const malformed = {
      prepare: (sql: string) => base.prepare(sql),
      batch: async () => [{ success: true }, { success: true }]
    }
    const handlers = new ApplicationHandlers(asDrizzle(testDb), malformed as any)

    const response = await handlers.deleteApplication(7, String(target.id))

    expect(response.status).toBe(500)
    expect(getAppRow(testDb, target.id)).toBeDefined()
  })

  test('缺 rawDb binding → 500，零写入（不退化为不原子的单句删除）', async () => {
    const testDb = createApplicationDeleteDb()
    openDbs.push(testDb)
    const handlers = new ApplicationHandlers(asDrizzle(testDb))
    const target = seedApp(testDb)
    const targetMessage = seedMessage(testDb, { appid: target.id })

    const response = await handlers.deleteApplication(7, String(target.id))

    expect(response.status).toBe(500)
    expect(getAppRow(testDb, target.id)).toBeDefined()
    expect(getMessageRow(testDb, targetMessage.id)).toBeDefined()
  })
})
