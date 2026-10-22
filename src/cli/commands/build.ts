// Build command implementation
import chalk from 'chalk';
import { FontDownloader } from '@/modules/download/FontDownloader.js';
import { FontEditor } from '@/modules/edit/FontEditor.js';
import { FontSubsetter } from '@/modules/subset/FontSubsetter.js';
import { CSSGenerator } from '@/modules/css/CSSGenerator.js';
import { DocsGenerator } from '@/modules/docs/DocsGenerator.js';
import { BuildValidator } from '@/modules/build/BuildValidator.js';
import { ConfigManager } from '@/config/index.js';
import { PathUtils } from '@/utils/PathUtils.js';
import { CLIValidator } from '@/cli/utils/validation.js';
import { ArgsParser } from '@/cli/utils/args.js';
import type { CLICommand, CLIArgs, StandardOptions } from '@/cli/types.js';

export const buildCommand: CLICommand = {
  name: 'build',
  description: 'Complete build workflow: download, edit, subset, css, docs',
  aliases: ['b'],

  async execute(args: CLIArgs): Promise<void> {
    console.log(chalk.bold.blue('🔨 Starting Build Process\n'));

    try {
      // Parse standard options
      const options = ArgsParser.parseStandardOptions(args);
      await validateBuildOptions(options);

      const targetFontIds =
        options.fontIds.length > 0
          ? options.fontIds
          : ConfigManager.getFontIds();

      const resolvedOutputDir = PathUtils.resolve(
        process.cwd(),
        options.outputDir
      );
      const downloadsDir = PathUtils.resolve(process.cwd(), 'downloads');
      const buildSettings = ConfigManager.getBuildConfig();

      // Initialize services
      const fontDownloader = new FontDownloader(downloadsDir);
      const fontEditor = new FontEditor();
      const fontSubsetter = new FontSubsetter(
        downloadsDir,
        resolvedOutputDir,
        ConfigManager.load().fonts
      );
      const cssGenerator = new CSSGenerator({
        outputDir: resolvedOutputDir,
        cssDir: PathUtils.resolve(resolvedOutputDir, 'css'),
      });
      const docsGenerator = new DocsGenerator(ConfigManager.getBuildConfig());

      // Initialize services
      await fontSubsetter.init();
      await cssGenerator.init();

      // Execute build steps with granular control
      if (!options.skipDownload) {
        console.log(chalk.yellow('📋 Step 1: Downloading fonts...'));
        if (options.fontIds.length > 0) {
          await fontDownloader.downloadSpecific(options.fontIds);
        } else {
          await fontDownloader.downloadAll();
        }

        if (buildSettings.validation.validateDownloads) {
          console.log(chalk.yellow('📋 Validating downloaded fonts...'));
          const downloadsValid =
            await fontDownloader.validateDownloads(targetFontIds);

          if (!downloadsValid) {
            const message = `Downloaded font validation failed for: ${targetFontIds.join(
              ', '
            )}`;
            if (buildSettings.validation.strictMode) {
              throw new Error(message);
            }
            console.warn(chalk.yellow(`⚠️ ${message}`));
          }
        }
      }

      if (!options.skipEdit) {
        console.log(chalk.yellow('📋 Step 2: Editing fonts...'));
        if (options.fontIds.length > 0) {
          await fontEditor.editSpecific(options.fontIds);
        } else {
          await fontEditor.editAll();
        }
      }

      if (!options.skipSubset) {
        console.log(chalk.yellow('📋 Step 3: Subsetting fonts...'));
        if (options.fontIds.length > 0) {
          await fontSubsetter.processSpecific(options.fontIds);
        } else {
          await fontSubsetter.processAll();
        }
      }

      if (!options.skipSubset && buildSettings.validation.validateChunks) {
        console.log(chalk.yellow('📋 Validating subset output...'));
        const subsetValid = await fontSubsetter.validateOutput(targetFontIds);

        if (!subsetValid) {
          const message = `Subset output validation failed for: ${targetFontIds.join(
            ', '
          )}`;
          if (buildSettings.validation.strictMode) {
            throw new Error(message);
          }
          console.warn(chalk.yellow(`⚠️ ${message}`));
        }
      }

      if (!options.skipCSS) {
        console.log(chalk.yellow('📋 Step 4: Generating CSS...'));
        if (options.fontIds.length > 0) {
          await cssGenerator.generateSpecific(options.fontIds);
          // Regenerate unified CSS when processing specific fonts
          await cssGenerator.generateUnified();
        } else {
          await cssGenerator.generateAll();
        }
      }

      if (!options.skipDocs) {
        console.log(chalk.yellow('📋 Step 5: Generating documentation...'));
        await docsGenerator.generateDocumentation({
          outputDir: resolvedOutputDir,
        });
      }

      if (!options.skipCSS || !options.skipDocs) {
        console.log(chalk.yellow('📋 Validating build output...'));
        const buildValidator = new BuildValidator();

        try {
          await buildValidator.validate({
            outputDir: resolvedOutputDir,
            fontIds: targetFontIds,
            validateCSS: !options.skipCSS,
            validateDocs: !options.skipDocs,
          });
        } catch (error) {
          if (buildSettings.validation.strictMode) {
            throw error;
          }
          console.warn(
            chalk.yellow(
              `⚠️ Build output validation failed: ${
                (error as Error).message
              }`
            )
          );
        }
      }

      console.log(chalk.bold.green('\n🎉 Build completed successfully!'));
      console.log(chalk.gray(`Output directory: ${options.outputDir}`));
    } catch (error: unknown) {
      console.error(chalk.red('❌ Build failed:'), (error as Error).message);
      process.exit(1);
    }
  },
};

async function validateBuildOptions(options: StandardOptions): Promise<void> {
  // Validate font IDs if provided
  if (options.fontIds.length > 0) {
    const fontValidation = CLIValidator.validateFontIds(options.fontIds);
    if (!fontValidation.isValid) {
      console.error(chalk.red('Invalid font IDs:'));
      console.error(CLIValidator.formatErrors(fontValidation));
      process.exit(1);
    }
  }

  // Validate output directory
  const outputValidation = CLIValidator.validateOutputDir(options.outputDir);
  if (!outputValidation.isValid) {
    console.error(chalk.red('Invalid output directory:'));
    console.error(CLIValidator.formatErrors(outputValidation));
    process.exit(1);
  }
}
