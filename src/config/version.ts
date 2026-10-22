// Shared package version, resolved relative to the installed CLI
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readPackageVersion(): string {
  try {
    const packagePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'package.json'
    );
    const packageData = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      version?: string;
    };

    return packageData.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const PACKAGE_VERSION = readPackageVersion();
