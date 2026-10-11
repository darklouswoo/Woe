

















jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

const mockHashPassword = jest.fn(async (pass: string) => `hashed:${pass}`)

jest.mock('../../src/middleware/auth.ts', () => ({
  hashPassword: mockHashPassword
}))

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import * as schema from '../../src/models'
import { UserHandlers } from '../../src/handlers/userHandlers'
import { isUsernameUniqueViolation } from '../../src/utils/userConflict'
import type { DrizzleDB } from '../../src/drizzle/index.ts'






const USERS_SCHEMA_SQL = `
CREATE TABLE \`users\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`name\` text NOT NULL UNIQUE,
	\`pass\` text NOT NULL,
	\`admin\` integer DEFAULT 0 NOT NULL,
	\`disabled\` integer DEFAULT 0 NOT NULL,
	\`nickname\` text NOT NULL,
	\`email\` text NOT NULL,
	\`avatar\` text,
	\`description\` text,
	\`created_at\` text DEFAULT CURRENT_TIMESTAMP
);
`


function createUserConflictDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(USERS_SCHEMA_SQL)
  const db = drizzle(sqlite, { schema })
  return { db: db as unknown as DrizzleDB, sqlite }
}

const userRowCount = (sqlite: Database.Database) =>
  (sqlite.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c

const userRows = (sqlite: Database.Database) =>
  sqlite.prepare('SELECT * FROM users ORDER BY id').all() as Array<Record<string, unknown>>

async function readError(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>
}





function createRaceDrizzle(insertReturning: jest.Mock) {
  const get = jest.fn(async () => undefined)
  return {
    drizzle: {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ get }))
        }))
      })),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({ returning: insertReturning }))
      }))
    },
    get
  }
}

describe('createUser 重名冲突映射', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('真库唯一约束', () => {
    test('已存在 name：重复创建 => 400 username already exists，用户行仅一条且首行不被覆盖', async () => {
      const { db, sqlite } = createUserConflictDb()
      const handlers = new UserHandlers(db)

      const first = await handlers.createUser('alice', 'first-secret')
      expect(first.status).toBe(200)

      const duplicate = await handlers.createUser('alice', 'second-secret')
      const body = await readError(duplicate)

      expect(duplicate.status).toBe(400)
      expect(body.errorCode).toBe(400)
      expect(body.errorDescription).toBe('username already exists')

      const differentCase = await handlers.createUser('Alice', 'third-secret')
      expect(differentCase.status).toBe(200)

      expect(userRowCount(sqlite)).toBe(2)
      const rows = userRows(sqlite)
      expect(rows[0].pass).toBe('hashed:first-secret')
      expect(rows[1].name).toBe('Alice')
    })

    test('响应不泄露输入密码或原始 SQL（400/500 均为固定文案）', async () => {
      const { db, sqlite } = createUserConflictDb()
      const handlers = new UserHandlers(db)

      await handlers.createUser('alice', 'super-secret-pass')
      const duplicate = await handlers.createUser('alice', 'super-secret-pass')
      const dupBody = await readError(duplicate)

      expect(JSON.stringify(dupBody)).not.toContain('super-secret-pass')
      expect(JSON.stringify(dupBody)).not.toContain('UNIQUE constraint failed')

      const otherFailure = await handlers.createUser('bob\x00bad', 'p')
      const failBody = await readError(otherFailure)
      expect(JSON.stringify(failBody)).not.toContain('p\x00')
    })

    test('普通合法创建 => 200，保留 hash/昵称/email/admin 处理', async () => {
      const { db, sqlite } = createUserConflictDb()
      const handlers = new UserHandlers(db)

      const defaulted = await handlers.createUser('bob', 'secret')
      const defaultedBody = await defaulted.json() as Record<string, unknown>
      expect(defaulted.status).toBe(200)
      expect(mockHashPassword).toHaveBeenCalledWith('secret')
      expect(defaultedBody.nickname).toBe('bob')
      expect(defaultedBody.email).toBe('needupdate@example.com')
      expect(defaultedBody.admin).toBe(false)

      const full = await handlers.createUser(
        'carol', 'pw', true, ' Carol Nick ', 'carol@example.com', 'ops'
      )
      const fullBody = await full.json() as Record<string, unknown>
      expect(full.status).toBe(200)
      expect(fullBody.nickname).toBe('Carol Nick')
      expect(fullBody.email).toBe('carol@example.com')
      expect(fullBody.description).toBe('ops')
      expect(fullBody.admin).toBe(true)

      const row = userRows(sqlite).find((r) => r.name === 'carol')
      expect(row?.pass).toBe('hashed:pw')
    })
  })

  describe('竞态：预检未命中但 insert 冲突（确定性交错控制）', () => {
    test('包装 cause 为 users.name 唯一冲突 => 400 username already exists', async () => {
      const dbError = new Error('UNIQUE constraint failed: users.name')
      const wrapped = new Error('d1 batch failed', { cause: dbError })
      const insertReturning = jest.fn(async () => {
        throw wrapped
      })
      const { drizzle } = createRaceDrizzle(insertReturning)
      const handlers = new UserHandlers(drizzle as any)

      const response = await handlers.createUser('alice', 'race-secret')
      const body = await readError(response)

      expect(response.status).toBe(400)
      expect(body.errorCode).toBe(400)
      expect(body.errorDescription).toBe('username already exists')
      expect(JSON.stringify(body)).not.toContain('race-secret')
      expect(JSON.stringify(body)).not.toContain('UNIQUE constraint failed')

      expect(drizzle.insert).toHaveBeenCalledTimes(1)
    })

    test('UNIQUE constraint failed 其他表/其他字段 => 500，不包装成重名', async () => {
      const otherTable = new Error('UNIQUE constraint failed: clients.token', {
        cause: new Error('UNIQUE constraint failed: users.email')
      })
      const insertReturning = jest.fn(async () => {
        throw otherTable
      })
      const { drizzle } = createRaceDrizzle(insertReturning)
      const handlers = new UserHandlers(drizzle as any)

      const response = await handlers.createUser('alice', 'secret')
      const body = await readError(response)

      expect(response.status).toBe(500)
      expect(body.errorCode).toBe(500)
      expect(body.errorDescription).toBe('Failed to create user')
    })

    test('数据库断开/其他 SQL 错误 => 500', async () => {
      const disconnected = new Error('SQLITE_IOERR: disk I/O error', {
        cause: new Error('database connection lost')
      })
      const insertReturning = jest.fn(async () => {
        throw disconnected
      })
      const { drizzle } = createRaceDrizzle(insertReturning)
      const handlers = new UserHandlers(drizzle as any)

      const response = await handlers.createUser('alice', 'secret')
      const body = await readError(response)

      expect(response.status).toBe(500)
      expect(body.errorDescription).toBe('Failed to create user')
    })



  test('标记文本用户名 + Drizzle 包装 message 内嵌该名字的普通故障 => 500（不误判 400）', async () => {
    const markerName = 'UNIQUE constraint failed: users.name'
    const wrapper = new DrizzleQueryError(
      'insert into "users" ("name", ...) values (?, ...) returning "id"',
      [markerName],
      new Error('D1_ERROR: database is locked')
    )
    const insertReturning = jest.fn(async () => {
      throw wrapper
    })
    const { drizzle } = createRaceDrizzle(insertReturning)
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.createUser(markerName, 'secret')
    const body = await readError(response)

    expect(response.status).toBe(500)
    expect(body.errorCode).toBe(500)
    expect(body.errorDescription).toBe('Failed to create user')
    expect(isUsernameUniqueViolation(wrapper)).toBe(false)
  })




  test('Drizzle 包装 cause 携带真实 D1 扩展后缀形态 => 400 username already exists', async () => {
    const realD1Message =
      'UNIQUE constraint failed: users.name: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'
    const wrapper = new DrizzleQueryError(
      'insert into "users" ("name", ...) values (?, ...) returning "id"',
      ['dave'],
      new Error(`D1_ERROR: ${realD1Message}`)
    )
    const insertReturning = jest.fn(async () => {
      throw wrapper
    })
    const { drizzle } = createRaceDrizzle(insertReturning)
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.createUser('dave', 'race-secret')
    const body = await readError(response)

    expect(response.status).toBe(400)
    expect(body.errorDescription).toBe('username already exists')
    expect(drizzle.insert).toHaveBeenCalledTimes(1)
  })
})
})

describe('isUsernameUniqueViolation 包装链识别边界', () => {
  const usersNameViolation = 'UNIQUE constraint failed: users.name'

  test('裸 users.name 冲突错误 => true', () => {
    expect(isUsernameUniqueViolation(new Error(usersNameViolation))).toBe(true)
  })

  test('D1 云端形式（D1_ERROR: 前缀）=> true', () => {
    expect(isUsernameUniqueViolation(new Error(`D1_ERROR: ${usersNameViolation}`))).toBe(true)
  })

  test('真库重复插入抛出的原生错误 => true（message 恰为确切形态）', () => {
    const { db, sqlite } = createUserConflictDb()
    sqlite.prepare('INSERT INTO users (name, pass, nickname, email) VALUES (?, ?, ?, ?)')
      .run('alice', 'x', 'alice', 'a@example.com')
    let thrown: unknown
    try {
      db.insert(schema.users)
        .values({ name: 'alice', pass: 'x', nickname: 'alice', email: 'b@example.com' })
        .run()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeDefined()
    expect(isUsernameUniqueViolation(thrown)).toBe(true)
  })

  test('Drizzle 风格多层 cause 包装 => true', () => {
    const sqliteError = { name: 'SqliteError', code: 'SQLITE_CONSTRAINT_UNIQUE', message: usersNameViolation }
    const drizzleError = { name: 'DrizzleError', message: 'Failed query', cause: sqliteError }
    expect(isUsernameUniqueViolation({ message: 'd1 batch failed', cause: drizzleError })).toBe(true)
  })

  test('DrizzleQueryError 包装 message 内嵌标记文本（作为 SQL 参数）=> false（缺陷回归）', () => {
    const wrapper = new DrizzleQueryError(
      'select "id" from "users" where "users"."name" = ?',
      [usersNameViolation],
      new Error('D1_ERROR: database unavailable')
    )
    expect(isUsernameUniqueViolation(wrapper)).toBe(false)
  })

  test.each([
    ['前缀夹杂', `xx ${usersNameViolation}`],
    ['后缀夹杂', `${usersNameViolation} yy`],
    ['换行内嵌', `Failed query: insert into "users"\nparams: ${usersNameViolation}`]
  ])('非整串一致（%s）=> false', (_label, message) => {
    expect(isUsernameUniqueViolation(new Error(message))).toBe(false)
  })

  test.each([
    ['其他表唯一冲突', 'UNIQUE constraint failed: clients.token'],
    ['其他字段唯一冲突', 'UNIQUE constraint failed: users.email'],
    ['非约束 SQL 错误', 'SQLITE_BUSY: database is locked'],
    ['普通异常', 'unexpected failure']
  ])('%s => false', (_label, message) => {
    expect(isUsernameUniqueViolation(new Error(message, { cause: new Error(message) }))).toBe(false)
  })

  test('非对象输入（null/undefined/字符串/数字）=> false', () => {
    expect(isUsernameUniqueViolation(null)).toBe(false)
    expect(isUsernameUniqueViolation(undefined)).toBe(false)
    expect(isUsernameUniqueViolation(usersNameViolation)).toBe(false)
    expect(isUsernameUniqueViolation(500)).toBe(false)
  })

  test('循环 cause 链 => false 且正常终止', () => {
    const a: { message: string; cause?: unknown } = { message: 'outer-a' }
    const b: { message: string; cause?: unknown } = { message: 'outer-b' }
    a.cause = b
    b.cause = a
    expect(isUsernameUniqueViolation(a)).toBe(false)
  })

  test('深度边界内命中 => true；超出 MAX_CAUSE_DEPTH 的链 => false（不挂死）', () => {
    type Wrapper = { message: string; cause?: unknown }
    const makeChain = (length: number): Wrapper[] =>
      Array.from({ length }, () => ({ message: 'wrapper' }) as Wrapper)

    const within = makeChain(5)
    for (let i = 0; i < within.length - 1; i++) within[i].cause = within[i + 1]
    within[within.length - 1].cause = new Error(usersNameViolation)
    expect(isUsernameUniqueViolation(within[0])).toBe(true)

    const beyond = makeChain(50)
    for (let i = 0; i < beyond.length - 1; i++) beyond[i].cause = beyond[i + 1]
    beyond[beyond.length - 1].cause = new Error(usersNameViolation)
    expect(isUsernameUniqueViolation(beyond[0])).toBe(false)
  })
})




describe('isUsernameUniqueViolation 已验证 D1 扩展后缀形态', () => {
  const usersNameViolation = 'UNIQUE constraint failed: users.name'
  const verifiedSuffix = ': SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'
  const suffixed = `${usersNameViolation}${verifiedSuffix}`

  test.each([
    ['裸形态（无前缀无后缀）', usersNameViolation],
    ['裸形态 + 已验证 D1 后缀', suffixed],
    ['D1_ERROR: 前缀 + 裸形态', `D1_ERROR: ${usersNameViolation}`],
    ['D1_ERROR: 前缀 + 裸形态 + 已验证 D1 后缀', `D1_ERROR: ${suffixed}`]
  ])('接受：%s => true', (_label, message) => {
    expect(isUsernameUniqueViolation(new Error(message))).toBe(true)
  })

  test.each([
    [
      '包装 message 内嵌带后缀标记（SQL 参数）',
      new DrizzleQueryError(
        'insert into "users" ("name") values (?) returning "id"',
        [suffixed],
        new Error('D1_ERROR: database unavailable')
      )
    ],
    [
      '用户名字面即完整带后缀形态、cause 为普通故障',
      { message: `Failed query: insert into "users" values (?)\nparams: ${suffixed}`, cause: new Error('D1_ERROR: database is locked') }
    ],
    ['后缀形态前有额外文本', `xx ${suffixed}`],
    ['后缀形态后有额外文本', `${suffixed} yy`],
    ['后缀形态首尾额外文本', `xx ${suffixed} yy`],
    ['换行内嵌（wrapper params）', `Failed query: insert into "users"\nparams: ${suffixed}`],
    ['换行内嵌（后缀跨行拆开）', `${usersNameViolation}\n: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`],
    ['其他表 + 已验证后缀', `UNIQUE constraint failed: clients.token${verifiedSuffix}`],
    ['其他字段 + 已验证后缀', `UNIQUE constraint failed: users.email${verifiedSuffix}`],
    ['其他表（无后缀）', 'UNIQUE constraint failed: clients.token'],
    ['其他扩展码后缀', `${usersNameViolation}: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)`],
    ['截断后缀', `${usersNameViolation}: SQLITE_CONSTRAINT (extended:`],
    ['仅有后缀文本', verifiedSuffix.trim()],
    ['后缀大小写变体', `${usersNameViolation}: sqlite_constraint (extended: SQLITE_CONSTRAINT_UNIQUE)`]
  ])('拒绝：%s => false', (_label, error) => {
    expect(isUsernameUniqueViolation(error)).toBe(false)
  })

  test('其他表 + D1_ERROR: 前缀 + 已验证后缀 => false（前缀不放宽表/列判定）', () => {
    expect(
      isUsernameUniqueViolation(
        new Error(`D1_ERROR: UNIQUE constraint failed: clients.token${verifiedSuffix}`)
      )
    ).toBe(false)
  })

  test('带已验证后缀的真实 D1 形态出现在 cause 链深处 => true', () => {
    const cause = new Error(`D1_ERROR: ${suffixed}`)
    const wrapped = new Error('d1 batch failed', { cause })
    expect(isUsernameUniqueViolation(wrapped)).toBe(true)
  })
})
