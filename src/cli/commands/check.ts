// Check command implementation
import chalk from 'chalk';
import { VersionChecker } from '@/modules/version/VersionChecker.js';
import { CLIValidator } from '@/cli/utils/validation.js';
import { ArgsParser } from '@/cli/utils/args.js';
import type { CLICommand, CLIArgs, StandardOptions } from '@/cli/types.js';
import type { VersionCheckResult } from '@/types/workflow.js';

export const checkCommand: CLICommand = {
  name: 'check',
  description: 'Check for font version updates',
  aliases: ['c'],

  async execute(args: CLIArgs): Promise<void> {
    console.log(chalk.bold.blue('🔍 Checking for Updates\n'));

    try {
      // Parse standard options
      const options = ArgsParser.parseStandardOptions(args);
      await validateCheckOptions(options);

      // Run the check and display results
      await runVersionCheck(options.fontIds, options.force);
    } catch (error: unknown) {
      console.error(
        chalk.red('❌ Version check failed:'),
        (error as Error).message
      );
      process.exitCode = 1;
    }
  },
};

/**
 * Run version check and display results
 * Returns the VersionCheckResult for programmatic use
 */
export async function runVersionCheck(
  fontIds: string[] = [],
  force = false
): Promise<VersionCheckResult> {
  // Initialize version checker
  const versionChecker = new VersionChecker();

  // Check for updates
  console.log(chalk.yellow('📋 Checking font versions...'));

  let updateResults: VersionCheckResult;
  if (fontIds.length > 0) {
    updateResults = await versionChecker.checkSpecific(fontIds, force);
  } else {
    updateResults = await versionChecker.run(force);
  }

  // Display results
  displayUpdateResults(updateResults);

  return updateResults;
}

async function validateCheckOptions(options: StandardOptions): Promise<void> {
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

function displayUpdateResults(results: VersionCheckResult): void {
  if (!results) {
    console.log(chalk.yellow('⚠️  No update information available'));
    return;
  }

  const { updatedFonts, hasUpdates } = results;

  if (hasUpdates && updatedFonts.length > 0) {
    console.log(
      chalk.bold.green(`\n🎉 Found ${updatedFonts.length} update(s):`)
    );
    for (const update of updatedFonts) {
      console.log(
        chalk.green(
          `  ✅ ${update.name}: ${update.oldVersion} → ${update.newVersion}`
        )
      );
    }
  } else {
    console.log(chalk.bold.green('\n✅ All fonts are up to date!'));
  }

  console.log(chalk.gray('\n💡 Use --force to bypass cache'));
}
