const fs = require('fs');
const path = require('path');

const APPS_DIR = path.join(__dirname, '..', 'server', 'apps');
const DOC_FILES = [
  'APP_SPEC.md',
  'API_CONTRACT.md',
  'DB_SCHEMA.md',
  'CREATE_NOTES.md',
  'CREATE_PROPOSAL.md',
  'EDIT_NOTES.md',
  'REWRITE_BRIEF.md',
  'RELEASE_NOTES.md',
  'RELEASE_REPORT.md',
  'RELEASE_MANIFEST.json',
];

function migrateApp(appDir) {
  const docsDir = path.join(appDir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const moved = [];
  for (const name of DOC_FILES) {
    const rootPath = path.join(appDir, name);
    const docsPath = path.join(docsDir, name);
    if (!fs.existsSync(rootPath)) continue;
    if (fs.existsSync(docsPath)) {
      const rootStat = fs.statSync(rootPath);
      const docsStat = fs.statSync(docsPath);
      if (rootStat.mtimeMs > docsStat.mtimeMs) {
        fs.copyFileSync(rootPath, docsPath);
      }
      fs.rmSync(rootPath, { force: true });
      moved.push(`${name} (deduped)`);
      continue;
    }
    fs.renameSync(rootPath, docsPath);
    moved.push(name);
  }
  return moved;
}

function main() {
  if (!fs.existsSync(APPS_DIR)) {
    console.log('No apps directory found.');
    return;
  }
  const apps = fs.readdirSync(APPS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => Number(a) - Number(b));

  const summary = [];
  for (const id of apps) {
    const appDir = path.join(APPS_DIR, id);
    const moved = migrateApp(appDir);
    if (moved.length) summary.push({ id, moved });
  }

  if (!summary.length) {
    console.log('No legacy root docs needed migration.');
    return;
  }

  for (const item of summary) {
    console.log(`App ${item.id}:`);
    for (const name of item.moved) console.log(`  - ${name}`);
  }
}

main();
