








import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { clients } from '../../src/models/client';
import { pushOutbox } from '../../src/models/pushOutbox';
import { applications } from '../../src/models/application';

interface IndexConfig {
  name: string;
  unique: boolean;
  columns: { name: string }[];
}

function indexConfigs(table: unknown): IndexConfig[] {
  const { indexes } = getTableConfig(table as never);
  return indexes.map((idx: unknown) => {
    const config = (idx as { config: IndexConfig }).config;
    return {
      name: config.name,
      unique: config.unique,
      columns: config.columns.map((c: { name: string }) => ({ name: c.name }))
    };
  });
}

function findIndex(table: unknown, name: string): IndexConfig {
  const found = indexConfigs(table).find((idx) => idx.name === name);
  if (!found) {
    throw new Error(
      `索引 ${name} 未在模型中声明；已声明：${JSON.stringify(indexConfigs(table).map((i) => i.name))}`
    );
  }
  return found;
}

describe('模型索引声明与既有数据库结构一致', () => {
  test('clients: 复合唯一索引 (user_id, device_uid)', () => {
    const idx = findIndex(clients, 'clients_user_id_device_uid_unique');
    expect(idx.unique).toBe(true);
    expect(idx.columns.map((c) => c.name)).toEqual(['user_id', 'device_uid']);
  });

  test('clients: expires_at 普通索引（定时清理扫描）', () => {
    const idx = findIndex(clients, 'clients_expires_at_idx');
    expect(idx.unique).toBe(false);
    expect(idx.columns.map((c) => c.name)).toEqual(['expires_at']);
  });

  test('push_outbox: (status, next_retry_at)', () => {
    const idx = findIndex(pushOutbox, 'push_outbox_status_next_retry_idx');
    expect(idx.unique).toBe(false);
    expect(idx.columns.map((c) => c.name)).toEqual(['status', 'next_retry_at']);
  });

  test('push_outbox: (user_id, platform, status)', () => {
    const idx = findIndex(pushOutbox, 'push_outbox_user_platform_status_idx');
    expect(idx.unique).toBe(false);
    expect(idx.columns.map((c) => c.name)).toEqual(['user_id', 'platform', 'status']);
  });

  test('push_outbox: (client_id, message_id) 部分唯一索引（0010 幂等键）', () => {
    const idx = findIndex(pushOutbox, 'push_outbox_client_message_unique');
    expect(idx.unique).toBe(true);
    expect(idx.columns.map((c) => c.name)).toEqual(['client_id', 'message_id']);
  });

  test('applications: (user_id, sort_key, id)', () => {
    const idx = findIndex(applications, 'idx_applications_user_sort_key');
    expect(idx.unique).toBe(false);
    expect(idx.columns.map((c) => c.name)).toEqual(['user_id', 'sort_key', 'id']);
  });

  test('clients.deviceUid 保持普通列（不退化为单列唯一）', () => {
    const { columns } = getTableConfig(clients as never);
    const deviceUid = columns.find((c) => c.name === 'device_uid');
    expect(deviceUid).toBeDefined();
    expect(deviceUid && (deviceUid as { isUnique?: boolean }).isUnique).toBeFalsy();
  });
});
