








import { eq } from 'drizzle-orm';
import {
  ENQUEUE_WRITE_GATE_KEY,
  ENQUEUE_WRITE_GATE_PAUSED,
  isEnqueueWritePaused
} from '../../src/services/writeGateService';
import { systemState } from '../../src/models/systemState';
import type { DrizzleDB } from '../../src/drizzle/index.ts';
import { asDrizzle, createTestDb } from '../helpers/testDb';


function seedGate(testDb: ReturnType<typeof createTestDb>, value: string) {
  testDb.db
    .insert(systemState)
    .values({ key: ENQUEUE_WRITE_GATE_KEY, value })
    .onConflictDoUpdate({ target: systemState.key, set: { value } })
    .run();
}

describe('isEnqueueWritePaused（真库 fixture）', () => {
  test('无闸门行：放行（false）', async () => {
    const testDb = createTestDb();
    await expect(isEnqueueWritePaused(asDrizzle(testDb))).resolves.toBe(false);
  });

  test("value='paused'：暂停（true）", async () => {
    const testDb = createTestDb();
    seedGate(testDb, 'paused');
    await expect(isEnqueueWritePaused(asDrizzle(testDb))).resolves.toBe(true);
  });

  test("value='paused@d3'（部署维护归属标记）：暂停（true，前缀匹配）", async () => {
    const testDb = createTestDb();
    seedGate(testDb, 'paused@d3');
    await expect(isEnqueueWritePaused(asDrizzle(testDb))).resolves.toBe(true);
  });

  test("value='open'：放行（false）——仅 paused 前缀才暂停", async () => {
    const testDb = createTestDb();
    seedGate(testDb, 'open');
    await expect(isEnqueueWritePaused(asDrizzle(testDb))).resolves.toBe(false);
  });

  test('读库抛错：放行（false，闸门故障不得阻断正常消息）', async () => {
    const throwingDrizzle = {
      select: () => ({
        from: () => ({
          where: (clause: unknown) => {

            expect(clause).toBeDefined();
            return { get: () => Promise.reject(new Error('d1 read failed')) };
          }
        })
      })
    } as unknown as DrizzleDB;
    await expect(isEnqueueWritePaused(throwingDrizzle)).resolves.toBe(false);
  });
});

describe('闸门常量', () => {
  test('key/paused 值与部署脚本契约一致', () => {
    expect(ENQUEUE_WRITE_GATE_KEY).toBe('enqueue_write_gate');
    expect(ENQUEUE_WRITE_GATE_PAUSED).toBe('paused');
  });

  test('eq(systemState.key, key) 在真库可精确命中（自同步：模型列名漂移即红）', () => {
    const testDb = createTestDb();
    testDb.db.insert(systemState).values({ key: 'other_key', value: 'paused' }).run();

    const row = testDb.db
      .select({ value: systemState.value })
      .from(systemState)
      .where(eq(systemState.key, ENQUEUE_WRITE_GATE_KEY))
      .get();

    expect(row).toBeUndefined();
  });
});
