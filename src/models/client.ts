





import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './user';


export const clients = sqliteTable('clients', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  userId: integer('user_id', { mode: 'number' }).notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  name: text('name').notNull(),
  platform: text('platform').notNull().default('unknown'),
  deviceUid: text('device_uid'),
  deviceToken: text('device_token'),
  tokenUpdatedAt: text('token_updated_at'),
  tokenStatus: text('token_status').notNull().default('active'),
  appVersion: text('app_version'),
  deviceModel: text('device_model'),
  lastUsed: text('last_used'),

  elevatedUntil: text('elevated_until'),

  expiresAfterInactivitySeconds: integer('expires_after_inactivity_seconds', { mode: 'number' }).notNull().default(0),

  expiresAt: text('expires_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
}, (t) => [

  uniqueIndex('clients_user_id_device_uid_unique').on(t.userId, t.deviceUid),
  uniqueIndex('clients_active_device_token_unique').on(t.deviceToken)
    .where(sql`device_token IS NOT NULL AND device_token != '' AND token_status = 'active'`),

  index('clients_expires_at_idx').on(t.expiresAt)
]);

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;
