





import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';


export const pushOutbox = sqliteTable('push_outbox', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  userId: integer('user_id', { mode: 'number' }).notNull(),
  messageId: integer('message_id', { mode: 'number' }).notNull(),
  platform: text('platform').notNull(),
  clientId: integer('client_id', { mode: 'number' }),
  payloadJson: text('payload_json').notNull(),
  status: text('status').notNull().default('pending'),
  attemptCount: integer('attempt_count', { mode: 'number' }).notNull().default(0),
  nextRetryAt: text('next_retry_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (t) => [

  index('push_outbox_status_next_retry_idx').on(t.status, t.nextRetryAt),
  index('push_outbox_user_platform_status_idx').on(t.userId, t.platform, t.status),

  uniqueIndex('push_outbox_client_message_unique')
    .on(t.clientId, t.messageId)
    .where(sql`client_id IS NOT NULL`)
]);

export type PushOutbox = typeof pushOutbox.$inferSelect;
export type InsertPushOutbox = typeof pushOutbox.$inferInsert;
