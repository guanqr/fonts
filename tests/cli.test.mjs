import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationUtils } from '../dist/utils/ValidationUtils.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const cliPath = path.join(projectRoot, 'dist', 'cli', 'bin.js');
const execFileAsync = promisify(execFile);

test('allows absolute output paths and rejects traversal', () => {
  assert.equal(ValidationUtils.isSafePath('/tmp/fonts-output'), true);
  assert.equal(ValidationUtils.isSafePath('C:\\temp\\fonts-output'), true);
  assert.equal(ValidationUtils.isSafePath('relative/fonts-output'), true);
  assert.equal(ValidationUtils.isSafePath('../fonts-output'), false);
  assert.equal(ValidationUtils.isSafePath('foo/../fonts-output'), false);
  assert.equal(ValidationUtils.isSafePath('foo/..'), false);
});

async function runCli(args, cwd = projectRoot) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliPath, ...args],
    { cwd, maxBuffer: 10 * 1024 * 1024 }
  );
  return `${stdout}${stderr}`;
}

test('reports the package version', async () => {
  const output = await runCli(['--version']);
  assert.match(output, /fonts v5\.1\.0/);
});

test('keeps help and command aliases consistent', async () => {
  const help = await runCli(['--help']);
  assert.match(help, /css \(cs\)/);
  assert.doesNotMatch(help, /--verbose/);
  assert.doesNotMatch(help, /--quiet/);

  const buildHelp = await runCli(['build', '--help']);
  assert.match(buildHelp, /--skip-edit/);
  assert.doesNotMatch(buildHelp, /--force/);

  const checkHelp = await runCli(['check', '--help']);
  assert.match(checkHelp, /--force/);

  const downloadHelp = await runCli(['download', '--help']);
  assert.doesNotMatch(downloadHelp, /--force/);

  const subsetHelp = await runCli(['subset', '--help']);
  assert.doesNotMatch(subsetHelp, /--force/);

  const checkAlias = await runCli(['c', '--help']);
  assert.match(checkAlias, /Check for font version updates/);

  const cssAlias = await runCli(['cs', '--help']);
  assert.match(cssAlias, /Generate CSS files/);
});

test('reads the version from the package, not the current directory', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fonts-cli-version-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'other', version: '9.9.9' })
  );

  const output = await runCli(['--version'], dir);
  assert.match(output, /fonts v5\.1\.0/);
  assert.doesNotMatch(output, /9\.9\.9/);
});

test('generates documentation with the individual-font recommendation', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fonts-cli-docs-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  await runCli(['docs', '--output', dir]);

  const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf-8');
  const individual = readme.indexOf('### Recommended: Individual Fonts');
  const allFonts = readme.indexOf('### All Fonts (Optional)');

  assert.ok(individual >= 0, 'individual-font heading is missing');
  assert.ok(allFonts >= 0, 'all-fonts heading is missing');
  assert.ok(individual < allFonts, 'individual fonts should be recommended first');
  assert.doesNotMatch(readme, /All Fonts \(Recommended\)/);

  const license = await fs.readFile(path.join(dir, 'LICENSE.md'), 'utf-8');
  assert.match(license, /Version: 5\.1\.0/);
});
