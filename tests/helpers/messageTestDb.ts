











import type { TestDb } from './testDb';
import { createTestDb } from './testDb';


const MESSAGE_SCHEMA_SQL = `
CREATE TABLE \`applications\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`user_id\` integer NOT NULL,
	\`token\` text NOT NULL UNIQUE,
	\`name\` text NOT NULL,
	\`sort_key\` text DEFAULT '' NOT NULL,
	\`description\` text,
	\`default_priority\` integer DEFAULT 0,
	\`image\` text,
	\`internal\` integer DEFAULT 0,
	\`last_used\` text,
	\`created_at\` text DEFAULT CURRENT_TIMESTAMP,
	\`updated_at\` text DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX \`idx_applications_user_sort_key\` ON \`applications\` (\`user_id\`,\`sort_key\`,\`id\`);
CREATE TABLE \`messages\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`userid\` integer NOT NULL,
	\`appid\` integer NOT NULL,
	\`message\` text NOT NULL,
	\`title\` text,
	\`priority\` integer DEFAULT 0,
	\`extras\` text,
	\`date\` text DEFAULT CURRENT_TIMESTAMP,
	\`expires\` text
);
`;





export function createMessageTestDb(): TestDb {
  const testDb = createTestDb();
  testDb.sqlite.exec(MESSAGE_SCHEMA_SQL);
  return testDb;
}
