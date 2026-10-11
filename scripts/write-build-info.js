const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');


const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'src', 'generated', 'buildInfo.ts');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const version = packageJson.version;

const RELEASE = process.env.WOE_PUBLIC_RELEASE === '1';
const RELEASE_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

let commit = 'unknown';
let buildDate;

if (RELEASE) {


  const raw = process.env.WOE_PUBLIC_BUILD_DATE;
  if (!raw || !RELEASE_DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) {
    console.error('WOE_PUBLIC_RELEASE=1 需要 WOE_PUBLIC_BUILD_DATE=<ISO UTC 固定时刻>');
    process.exit(1);
  }
  const expect = process.env.WOE_PUBLIC_EXPECT_VERSION;
  if (expect !== undefined && expect !== version) {
    console.error('版本不一致：package.json version=' + version + ' 期望=' + expect);
    process.exit(1);
  }
  buildDate = raw;
} else {



  try {
    const toplevel = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'],
      { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const gitDir = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--absolute-git-dir'],
      { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    if (path.resolve(toplevel) === projectRoot && gitDir === path.join(projectRoot, '.git')) {
      commit = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--short', 'HEAD'],
        { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      const dirty = execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'],
        { stdio: ['pipe', 'pipe', 'ignore'] }).toString()
        .split('\n')
        .filter((line) => line.trim() && !line.includes('src/generated/buildInfo.ts'));
      if (dirty.length > 0) commit += '*';
    }
  } catch {
    commit = 'unknown';
  }
  buildDate = new Date().toISOString();
}

const content = `export const buildInfo = {
  version: '${version}',
  commit: '${commit}',
  buildDate: '${buildDate}'
} as const;
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, content);

console.log(`buildInfo updated: version=${version} commit=${commit} buildDate=${buildDate}`);
