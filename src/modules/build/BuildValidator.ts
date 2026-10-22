// Build output validation
import fs from 'fs-extra';
import path from 'node:path';
import { BaseService } from '@/core/base/BaseService.js';

export interface BuildValidationOptions {
  outputDir: string;
  fontIds: string[];
  validateCSS: boolean;
  validateDocs: boolean;
}

export class BuildValidator extends BaseService {
  constructor() {
    super('BuildValidator');
  }

  async validate(options: BuildValidationOptions): Promise<void> {
    const issues: string[] = [];

    if (options.validateCSS) {
      await this.validateCSS(options.outputDir, options.fontIds, issues);
    }

    if (options.validateDocs) {
      await this.validateDocs(options.outputDir, issues);
    }

    if (issues.length > 0) {
      throw new Error(
        `Build output validation failed:\n${issues
          .map((issue) => `  - ${issue}`)
          .join('\n')}`
      );
    }

    this.log('Build output validation passed');
  }

  private async validateCSS(
    outputDir: string,
    fontIds: string[],
    issues: string[]
  ): Promise<void> {
    const cssDir = path.join(outputDir, 'css');

    for (const fontId of fontIds) {
      const cssPath = path.join(cssDir, `${fontId}.css`);
      const minCssPath = path.join(cssDir, `${fontId}.min.css`);

      if (!(await fs.pathExists(cssPath))) {
        issues.push(`Missing CSS file: ${cssPath}`);
        continue;
      }

      if (!(await fs.pathExists(minCssPath))) {
        issues.push(`Missing minified CSS file: ${minCssPath}`);
      }

      const css = await fs.readFile(cssPath, 'utf-8');
      if (!css.includes('@font-face')) {
        issues.push(`No @font-face rules found: ${cssPath}`);
        continue;
      }

      const urls = this.extractLocalUrls(css);
      if (urls.length === 0) {
        issues.push(`No local font URLs found: ${cssPath}`);
      }

      for (const url of urls) {
        const resolved = path.resolve(cssDir, url);
        const relative = path.relative(outputDir, resolved);

        if (
          relative === '..' ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)
        ) {
          issues.push(`Font URL escapes output directory: ${url} (${cssPath})`);
          continue;
        }

        if (!(await fs.pathExists(resolved))) {
          issues.push(`Missing font file for ${fontId}: ${url}`);
        }
      }
    }

    for (const fileName of ['fonts.css', 'fonts.min.css']) {
      const unifiedPath = path.join(cssDir, fileName);
      if (!(await fs.pathExists(unifiedPath))) {
        issues.push(`Missing unified CSS file: ${unifiedPath}`);
      }
    }
  }

  private extractLocalUrls(css: string): string[] {
    const urls: string[] = [];
    const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = urlPattern.exec(css)) !== null) {
      const url = match[2].trim();
      if (
        !url ||
        url.startsWith('data:') ||
        /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(url)
      ) {
        continue;
      }
      urls.push(url);
    }

    return urls;
  }

  private async validateDocs(
    outputDir: string,
    issues: string[]
  ): Promise<void> {
    for (const fileName of ['LICENSE.md', 'LICENSE.json', 'README.md']) {
      const filePath = path.join(outputDir, fileName);

      if (!(await fs.pathExists(filePath))) {
        issues.push(`Missing documentation file: ${filePath}`);
        continue;
      }

      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        issues.push(`Empty documentation file: ${filePath}`);
      }
    }
  }
}
