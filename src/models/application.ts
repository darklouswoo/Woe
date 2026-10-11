




import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './user';


export const applications = sqliteTable('applications', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  userId: integer('user_id', { mode: 'number' }).notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  name: text('name').notNull(),
  sortKey: text('sort_key').notNull().default(''),
  description: text('description'),
  defaultPriority: integer('default_priority', { mode: 'number' }).default(0),
  image: text('image'),
  internal: integer('internal', { mode: 'boolean' }).default(false),
  lastUsed: text('last_used'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (t) => [

  index('idx_applications_user_sort_key').on(t.userId, t.sortKey, t.id)
]);

export type Application = typeof applications.$inferSelect;
export type InsertApplication = typeof applications.$inferInsert;
