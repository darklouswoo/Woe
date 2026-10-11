

















import type { TestDb } from './testDb';
import { createTestDb } from './testDb';


const APPLICATION_DELETE_SCHEMA_SQL = `
CREATE TABLE \`applications\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`user_id\` integer NOT NULL REFERENCES \`users\`(\`id\`),
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
	\`appid\` integer NOT NULL REFERENCES \`applications\`(\`id\`),
	\`message\` text NOT NULL,
	\`title\` text,
	\`priority\` integer DEFAULT 0,
	\`extras\` text,
	\`date\` text DEFAULT CURRENT_TIMESTAMP,
	\`expires\` text
);
`;






export function createApplicationDeleteDb(): TestDb {
  const testDb = createTestDb();
  testDb.sqlite.exec(APPLICATION_DELETE_SCHEMA_SQL);
  const seedUser = testDb.sqlite.prepare(
    'INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, ?)'
  );
  seedUser.run(7, 'user7', 0, 0);
  seedUser.run(8, 'user8', 0, 0);

  testDb.sqlite.pragma('foreign_keys = ON');
  return testDb;
}
