#!/usr/bin/env node
/**
 * Prune unreferenced WOFF2 chunks from a build branch checkout.
 *
 * CSS is cached by browsers for up to 7 days, so a chunk that is no longer
 * referenced by the current CSS may still be needed by a cached stylesheet.
 * A chunk is only removed when:
 *   1. no current CSS file references it;
 *   2. the font's CSS has been unchanged for at least --retention-days;
 *   3. the chunk file was added at least --retention-days ago.
 *
 * Usage:
 *   node scripts/prune-orphan-chunks.mjs [--build-dir build] [--retention-days 30] [--apply]
 *
 * Without --apply the script only reports what it would remove.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_BUILD_DIR = 'build';
const DEFAULT_RETENTION_DAYS = 30;
const FONT_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

function printUsage() {
  console.log(`Usage: node scripts/prune-orphan-chunks.mjs [options]

Options:
  --build-dir <dir>        Build branch checkout (default: build)
  --retention-days <n>     Minimum age in days before removal (default: 30)
  --apply                  Actually delete files (default: dry run)
  --help, -h               Show this help
`);
}

function parseArgs(argv) {
  const options = {
    buildDir: DEFAULT_BUILD_DIR,
    retentionDays: DEFAULT_RETENTION_DAYS,
    apply: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--build-dir') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--build-dir requires a value');
      }
      options.buildDir = value;
      i += 1;
    } else if (arg === '--retention-days') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error('--retention-days requires a value');
      }

      const days = Number(value);
      if (!Number.isFinite(days) || days < 0) {
        throw new Error('--retention-days must be a non-negative number');
      }
      options.retentionDays = days;
      i += 1;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function walkWoff2(directory) {
  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkWoff2(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.woff2')) {
      files.push(entryPath);
    }
  }

  return files;
}

async function collectReferencedChunks(buildDir) {
  const cssDir = path.join(buildDir, 'css');
  const referenced = new Set();
  const entries = await fs.readdir(cssDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.css')) {
      continue;
    }

    const cssPath = path.join(cssDir, entry.name);
    const css = await fs.readFile(cssPath, 'utf-8');
    const pattern = new RegExp(FONT_URL_PATTERN.source, 'g');

    for (const match of css.matchAll(pattern)) {
      const url = match[2].trim();
      if (
        !url ||
        url.startsWith('data:') ||
        /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(url)
      ) {
        continue;
      }

      const resolved = path.resolve(cssDir, url);
      const relative = path.relative(buildDir, resolved);

      if (
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        !relative.endsWith('.woff2')
      ) {
        continue;
      }

      referenced.add(toPosixPath(relative));
    }
  }

  return referenced;
}

function gitTimestamp(buildDir, args) {
  try {
    const output = execFileSync('git', ['-C', buildDir, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (!output) {
      return null;
    }

    const timestamp = Number.parseInt(output.split('\n')[0], 10);
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

function lastAddedAt(buildDir, relativePath) {
  return gitTimestamp(buildDir, [
    'log',
    '-1',
    '--diff-filter=A',
    '--format=%ct',
    '--',
    relativePath,
  ]);
}

function fontCssLastChangedAt(buildDir, fontId, cache) {
  if (cache.has(fontId)) {
    return cache.get(fontId);
  }

  const cssPaths = [`css/${fontId}.css`, `css/${fontId}.min.css`];
  const timestamps = cssPaths
    .map((cssPath) =>
      gitTimestamp(buildDir, ['log', '-1', '--format=%ct', '--', cssPath])
    )
    .filter((timestamp) => timestamp !== null);

  const latest = timestamps.length > 0 ? Math.max(...timestamps) : null;
  cache.set(fontId, latest);
  return latest;
}

function fontIdFromPath(relativePath) {
  const segments = relativePath.split('/');
  return segments[0] === 'fonts' && segments.length >= 3 ? segments[1] : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  const buildDir = path.resolve(process.cwd(), options.buildDir);
  const fontsDir = path.join(buildDir, 'fonts');
  const cssDir = path.join(buildDir, 'css');

  await fs.access(fontsDir);
  await fs.access(cssDir);

  const retentionSeconds = options.retentionDays * 24 * 60 * 60;
  const nowSeconds = Date.now() / 1000;
  const referenced = await collectReferencedChunks(buildDir);
  const woffFiles = await walkWoff2(fontsDir);
  const cssTimeCache = new Map();
  const candidates = [];
  let referencedCount = 0;
  let youngOrphans = 0;
  let unknownAge = 0;

  for (const filePath of woffFiles) {
    const relative = toPosixPath(path.relative(buildDir, filePath));

    if (referenced.has(relative)) {
      referencedCount += 1;
      continue;
    }

    const fontId = fontIdFromPath(relative);
    if (!fontId) {
      unknownAge += 1;
      continue;
    }

    const addedAt = lastAddedAt(buildDir, relative);
    const cssChangedAt = fontCssLastChangedAt(
      buildDir,
      fontId,
      cssTimeCache
    );

    if (addedAt === null || cssChangedAt === null) {
      unknownAge += 1;
      continue;
    }

    const addedAge = nowSeconds - addedAt;
    const cssAge = nowSeconds - cssChangedAt;

    if (addedAge < retentionSeconds || cssAge < retentionSeconds) {
      youngOrphans += 1;
      continue;
    }

    const stats = await fs.stat(filePath);
    candidates.push({ path: filePath, relative, size: stats.size });
  }

  console.log(`🧹 Build cleanup: ${buildDir}`);
  console.log(
    `   Retention: ${options.retentionDays} day(s) (${options.apply ? 'apply' : 'dry run'})`
  );
  console.log(`   WOFF2 files: ${woffFiles.length}`);
  console.log(`   Referenced by CSS: ${referencedCount}`);
  console.log(`   Orphans kept (young/unknown age): ${youngOrphans + unknownAge}`);
  console.log(`   Orphans eligible: ${candidates.length}`);

  if (candidates.length === 0) {
    console.log('   Nothing to remove');
    return;
  }

  const totalSize = candidates.reduce((sum, candidate) => sum + candidate.size, 0);
  for (const candidate of candidates.slice(0, 20)) {
    console.log(
      `   ${options.apply ? 'remove' : 'would remove'} ${candidate.relative} (${formatBytes(
        candidate.size
      )})`
    );
  }
  if (candidates.length > 20) {
    console.log(`   ... and ${candidates.length - 20} more`);
  }

  if (!options.apply) {
    console.log(
      `   Dry run: would remove ${candidates.length} file(s), ${formatBytes(
        totalSize
      )}`
    );
    return;
  }

  for (const candidate of candidates) {
    await fs.unlink(candidate.path);
  }

  console.log(
    `   Removed ${candidates.length} file(s), ${formatBytes(totalSize)}`
  );
}

main().catch((error) => {
  console.error(`❌ Cleanup failed: ${error.message}`);
  process.exitCode = 1;
});
