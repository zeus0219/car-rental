/**
 * Runs `npx prisma generate` in apps/api, retrying on Windows EBUSY when Prisma
 * renames `query_engine-windows.dll.node.tmp*`. If the rename keeps failing, we
 * copy the newest .tmp to `query_engine-windows.dll.node` (often succeeds when rename does not),
 * then run generate again.
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, '..', 'apps', 'api');
const prismaDir = path.join(apiDir, 'node_modules', 'prisma');
const max = 8;

function sleepSec(s) {
  try {
    if (process.platform === 'win32') {
      execSync(`cmd /c "timeout /t ${s} /nobreak >nul"`, { stdio: 'ignore' });
    } else {
      execSync('sleep ' + s, { stdio: 'ignore' });
    }
  } catch {
    // ignore
  }
}

/**
 * @returns {boolean} true if a copy was attempted
 */
function windowsCopyNewestQueryEngineTmp() {
  if (process.platform !== 'win32' || !fs.existsSync(prismaDir)) {
    return false;
  }
  let best = { mtime: 0, full: null, name: '' };
  for (const name of fs.readdirSync(prismaDir)) {
    if (!name.startsWith('query_engine-windows.dll.node.tmp')) {
      continue;
    }
    const p = path.join(prismaDir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.mtimeMs >= best.mtime) {
      best = { mtime: st.mtimeMs, full: p, name };
    }
  }
  if (!best.full) {
    return false;
  }
  const dest = path.join(prismaDir, 'query_engine-windows.dll.node');
  try {
    fs.copyFileSync(best.full, dest);
    // eslint-disable-next-line no-console
    console.error(`[prisma-generate-retry] copied ${best.name} -> query_engine-windows.dll.node (Windows EBUSY workaround).`);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[prisma-generate-retry] copy workaround failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

for (let i = 0; i < max; i++) {
  const r = spawnSync('npx', ['prisma', 'generate'], {
    cwd: apiDir,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (r.status === 0) {
    process.exit(0);
  }
  if (i === max - 1) {
    break;
  }
  // eslint-disable-next-line no-console
  console.error(
    `[prisma-generate-retry] attempt ${i + 1}/${max} failed (exit ${r.status ?? r.error});`,
  );
  if (process.platform === 'win32' && windowsCopyNewestQueryEngineTmp()) {
    // eslint-disable-next-line no-console
    console.error('[prisma-generate-retry] retrying generate immediately...');
    continue;
  }
  // eslint-disable-next-line no-console
  console.error(`[prisma-generate-retry] waiting 4s before retry...`);
  sleepSec(4);
}

process.exit(1);
