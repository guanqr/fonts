// CSS generation command implementation
import chalk from 'chalk';
import { CSSGenerator } from '@/modules/css/CSSGenerator.js';
import { PathUtils } from '@/utils/PathUtils.js';
import { CLIValidator } from '@/cli/utils/validation.js';
import { ArgsParser } from '@/cli/utils/args.js';
import type { CLICommand, CLIArgs } from '@/cli/types.js';

export const cssCommand: CLICommand = {
  name: 'css',
  description: 'Generate CSS files from processed fonts',
  aliases: ['cs'],

  async execute(args: CLIArgs): Promise<void> {
    console.log(chalk.bold.blue('🎨 Generating CSS Files\n'));

    try {
      // Parse standard options
      const options = ArgsParser.parseStandardOptions(args);

      const outputValidation = CLIValidator.validateOutputDir(options.outputDir);
      if (!outputValidation.isValid) {
        console.error(chalk.red('Invalid output directory:'));
        console.error(CLIValidator.formatErrors(outputValidation));
        process.exitCode = 1;
        return;
      }

      const outputDir = PathUtils.resolve(process.cwd(), options.outputDir);

      // Initialize CSS generator
      const cssGenerator = new CSSGenerator({
        outputDir,
        cssDir: PathUtils.resolve(outputDir, 'css'),
      });
      await cssGenerator.init();

      if (options.fontIds.length > 0) {
        console.log(
          chalk.cyan(
            `Generating CSS for specific fonts: ${options.fontIds.join(', ')}`
          )
        );
        await cssGenerator.generateSpecific(options.fontIds);
        // Regenerate unified CSS when processing specific fonts
        await cssGenerator.generateUnified();
      } else {
        console.log(chalk.cyan('Generating CSS for all processed fonts'));
        await cssGenerator.generateAll();
      }

      console.log(chalk.bold.green('\n🎉 CSS generation completed!'));
    } catch (error: unknown) {
      console.error(
        chalk.red('❌ CSS generation failed:'),
        (error as Error).message
      );
      process.exit(1);
    }
  },
};
