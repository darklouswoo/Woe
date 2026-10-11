const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../src/migrations/sql');
const indexFile = path.join(__dirname, '../src/migrations/index.ts');

console.log('🔄 正在自动更新迁移索引...');

try {

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('⚠️  未发现 SQL 迁移文件。');
    process.exit(0);
  }


  const imports = files.map((file, index) => {
    const varName = `migration${index.toString().padStart(4, '0')}`;
    return `// @ts-ignore\nimport ${varName} from './sql/${file}';`;
  }).join('\n');


  const mapping = files.map((file, index) => {
    const varName = `migration${index.toString().padStart(4, '0')}`;
    const key = file.replace('.sql', '');
    return `  '${key}': ${varName},`;
  }).join('\n');


  const content = `


// @ts-ignore - Loaded as text modules via wrangler rules
${imports}

export const migrations: Record<string, string> = {
${mapping}
};

export default migrations;
`;

  fs.writeFileSync(indexFile, content);
  console.log(`✅ 已成功更新 ${files.length} 个迁移到 src/migrations/index.ts`);
} catch (error) {
  console.error('❌ 更新迁移索引失败:', error.message);
  process.exit(1);
}