import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const scriptPath = path.join(
  projectRoot,
  'scripts',
  'prune-orphan-chunks.mjs'
);

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('removes only eligible unreferenced chunks', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fonts-prune-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const cssDir = path.join(root, 'css');
  const fontDir = path.join(root, 'fonts', 'test');
  const unknownFontDir = path.join(root, 'fonts', 'test2');
  await fs.mkdir(cssDir, { recursive: true });
  await fs.mkdir(fontDir, { recursive: true });
  await fs.mkdir(unknownFontDir, { recursive: true });

  await fs.writeFile(
    path.join(cssDir, 'test.css'),
    "@font-face{font-family:Test;src:url('../fonts/test/0-aaaaaaaaaa.woff2') format('woff2');}"
  );
  const referenced = path.join(fontDir, '0-aaaaaaaaaa.woff2');
  const orphan = path.join(fontDir, '1-bbbbbbbbbb.woff2');
  const unknownAgeOrphan = path.join(
    unknownFontDir,
    '0-cccccccccc.woff2'
  );
  await fs.writeFile(referenced, 'referenced');
  await fs.writeFile(orphan, 'orphan');
  await fs.writeFile(unknownAgeOrphan, 'unknown');
  await fs.writeFile(path.join(fontDir, 'chunks.json'), '{"chunks":[]}');

  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'test'], { cwd: root });

  const dryRun = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--build-dir',
      root,
      '--retention-days',
      '1',
    ],
    { cwd: projectRoot, encoding: 'utf-8' }
  );
  assert.match(dryRun, /Orphans eligible: 0/);
  assert.equal(await pathExists(orphan), true);

  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--build-dir',
      root,
      '--retention-days',
      '0',
      '--apply',
    ],
    { cwd: projectRoot, encoding: 'utf-8' }
  );

  assert.match(output, /Removed 1 file/);
  assert.equal(await pathExists(orphan), false);
  assert.equal(await pathExists(referenced), true);
  assert.equal(await pathExists(unknownAgeOrphan), true);
  assert.equal(await pathExists(path.join(fontDir, 'chunks.json')), true);
});
