import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BuildValidator } from '../dist/modules/build/BuildValidator.js';

async function createFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fonts-build-validator-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const cssDir = path.join(dir, 'css');
  const fontDir = path.join(dir, 'fonts', 'test');
  await fs.mkdir(cssDir, { recursive: true });
  await fs.mkdir(fontDir, { recursive: true });

  const fontFile = path.join(fontDir, '0-abcdef0123.woff2');
  await fs.writeFile(fontFile, Buffer.from('woff2'));

  const css = `@font-face {
  font-family: Test;
  src: url('../fonts/test/0-abcdef0123.woff2') format('woff2');
}`;
  await fs.writeFile(path.join(cssDir, 'test.css'), css);
  await fs.writeFile(path.join(cssDir, 'test.min.css'), css);
  await fs.writeFile(path.join(cssDir, 'fonts.css'), "@import './test.css';");
  await fs.writeFile(
    path.join(cssDir, 'fonts.min.css'),
    "@import './test.min.css';"
  );

  await fs.writeFile(path.join(dir, 'LICENSE.md'), '# License');
  await fs.writeFile(path.join(dir, 'LICENSE.json'), '{}');
  await fs.writeFile(path.join(dir, 'README.md'), '# Readme');

  return { dir, fontFile };
}

test('passes for a complete build output', async (t) => {
  const { dir } = await createFixture(t);
  const validator = new BuildValidator();

  await validator.validate({
    outputDir: dir,
    fontIds: ['test'],
    validateCSS: true,
    validateDocs: true,
  });
});

test('fails when a CSS-referenced font file is missing', async (t) => {
  const { dir, fontFile } = await createFixture(t);
  await fs.rm(fontFile);

  const validator = new BuildValidator();

  await assert.rejects(
    validator.validate({
      outputDir: dir,
      fontIds: ['test'],
      validateCSS: true,
      validateDocs: true,
    }),
    /Missing font file/
  );
});

test('fails when required documentation is missing', async (t) => {
  const { dir } = await createFixture(t);
  await fs.rm(path.join(dir, 'README.md'));

  const validator = new BuildValidator();

  await assert.rejects(
    validator.validate({
      outputDir: dir,
      fontIds: ['test'],
      validateCSS: false,
      validateDocs: true,
    }),
    /Missing documentation file/
  );
});
