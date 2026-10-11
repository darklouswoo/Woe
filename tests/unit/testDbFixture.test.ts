


















import Database from 'better-sqlite3';
import { getTableColumns } from 'drizzle-orm';
import { clients } from '../../src/models/client';
import { pushOutbox } from '../../src/models/pushOutbox';
import { systemState } from '../../src/models/systemState';
import { createTestDb } from '../helpers/testDb';

interface IndexRow {
  name: string;
  unique: number;
}

function tableNames(sqlite: Database.Database): string[] {
  return (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function indexRows(sqlite: Database.Database, table: string): IndexRow[] {
  return (sqlite.pragma(`index_list(${table})`) as unknown as IndexRow[]).map((r) => ({
    name: r.name,
    unique: Number(r.unique)
  }));
}


function fixtureColumns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.pragma(`table_info(${table})`) as unknown as Array<{ name: string }>).map((r) => r.name);
}


function modelColumnNames(table: typeof clients | typeof pushOutbox | typeof systemState): string[] {
  return Object.values(getTableColumns(table)).map((c) => c.name);
}

describe('testDb 真库基线 fixture', () => {
  test('基线包含 users / clients / push_outbox / system_state 四张表', () => {
    const { sqlite } = createTestDb();
    const tables = tableNames(sqlite);
    expect(tables).toContain('users');
    expect(tables).toContain('clients');
    expect(tables).toContain('push_outbox');
    expect(tables).toContain('system_state');
  });

  test('clients: 复合唯一索引 (user_id, device_uid) 与 token 唯一索引存在', () => {
    const { sqlite } = createTestDb();
    const indexes = indexRows(sqlite, 'clients');

    const composite = indexes.find((i) => i.name === 'clients_user_id_device_uid_unique');
    expect(composite).toBeDefined();
    expect(composite && composite.unique).toBe(1);

    const tokenUnique = indexes.find((i) => i.name === 'clients_token_unique');
    expect(tokenUnique).toBeDefined();
    expect(tokenUnique && tokenUnique.unique).toBe(1);


    const expiresAt = indexes.find((i) => i.name === 'clients_expires_at_idx');
    expect(expiresAt).toBeDefined();
    expect(expiresAt && expiresAt.unique).toBe(0);
  });

  test('push_outbox: 两个存量查询索引非唯一，部分唯一索引（0010 幂等键）唯一', () => {
    const { sqlite } = createTestDb();
    const indexes = indexRows(sqlite, 'push_outbox');

    const statusRetry = indexes.find((i) => i.name === 'push_outbox_status_next_retry_idx');
    expect(statusRetry).toBeDefined();
    expect(statusRetry && statusRetry.unique).toBe(0);

    const userPlatformStatus = indexes.find((i) => i.name === 'push_outbox_user_platform_status_idx');
    expect(userPlatformStatus).toBeDefined();
    expect(userPlatformStatus && userPlatformStatus.unique).toBe(0);

    const clientMessageUnique = indexes.find((i) => i.name === 'push_outbox_client_message_unique');
    expect(clientMessageUnique).toBeDefined();
    expect(clientMessageUnique && clientMessageUnique.unique).toBe(1);



    const sqlRows = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'push_outbox_client_message_unique'")
      .all() as Array<{ sql: string }>;
    expect(sqlRows).toHaveLength(1);
    expect(sqlRows[0].sql).toContain('WHERE client_id IS NOT NULL');
  });

  test('列集与模型自同步：模型增删列 → fixture 漂移显式变红（users 为刻意最小列集，不参与）', () => {
    const { sqlite } = createTestDb();
    expect([...fixtureColumns(sqlite, 'clients')].sort()).toEqual([...modelColumnNames(clients)].sort());
    expect([...fixtureColumns(sqlite, 'push_outbox')].sort()).toEqual([...modelColumnNames(pushOutbox)].sort());
    expect([...fixtureColumns(sqlite, 'system_state')].sort()).toEqual([...modelColumnNames(systemState)].sort());
  });

  test('重复 (user_id, device_uid) 真实抛出 UNIQUE 约束错误', () => {
    const { db } = createTestDb();
    const base = { userId: 1, token: 'tok-a', name: 'dev-a', deviceUid: 'uid-same' };
    db.insert(clients).values(base).run();

    let caught: unknown;
    try {
      db.insert(clients).values({ ...base, token: 'tok-b', name: 'dev-b' }).run();
    } catch (err) {
      caught = err;
    }


    expect(caught).toBeDefined();
    expect((caught as { name?: unknown }).name).toBe('SqliteError');
    const message = (caught as Error).message;
    expect(message).toContain('UNIQUE constraint failed');

    expect(message).toContain('clients.user_id');
    expect(message).toContain('clients.device_uid');
  });

  test('drizzle 往返可用且列默认值与模型一致', () => {
    const { db } = createTestDb();

    const inserted = db
      .insert(clients)
      .values({ userId: 42, token: 'tok-rt', name: 'dev-rt', deviceUid: 'uid-rt' })
      .returning()
      .all();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: expect.any(Number),
      userId: 42,
      token: 'tok-rt',
      name: 'dev-rt',
      deviceUid: 'uid-rt',
      platform: 'unknown',
      tokenStatus: 'active'
    });
    expect(inserted[0].createdAt).toBeTruthy();

    const selected = db.select().from(clients).all();
    expect(selected).toHaveLength(1);
    expect(selected[0].token).toBe('tok-rt');
  });
});
