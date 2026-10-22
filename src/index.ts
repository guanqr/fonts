// Main entry point - Delegates to CLI for single source of truth
import chalk from 'chalk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI } from '@/cli/index.js';
import { runVersionCheck } from '@/cli/commands/check.js';

/**
 * Main entry point for the font processing workflow
 * Delegates to CLI for all functionality while maintaining backwards compatibility
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cli = new CLI();

  console.log(chalk.gray('🔧 Web Font Auto-Subsetting\n'));

  try {
    // Parse arguments to check for flags
    const hasForce = args.includes('--force');
    const fontsIndex = args.indexOf('--fonts');
    const hasFonts = fontsIndex !== -1;

    if (args.length === 0) {
      // Default: run check then build workflow
      await runFullWorkflow(cli);
    } else if (args[0] === '--build-only') {
      // Legacy support: build without version checking
      await cli.run(['build']);
    } else if (hasForce && hasFonts) {
      // Force build with specific fonts
      const fontIds = args.slice(fontsIndex + 1);
      await runForcedWorkflowWithFonts(cli, fontIds);
    } else if (hasForce) {
      // Force build: skip version check and build directly
      await runForcedWorkflow(cli);
    } else if (args[0] === '--fonts') {
      // Legacy support: process specific fonts
      await runSpecificFonts(cli, args.slice(1));
    } else {
      // Pass through to CLI for all other commands
      await cli.run(args);
    }
  } catch (error: unknown) {
    console.error(chalk.red('❌ Process failed:'), (error as Error).message);
    process.exitCode = 1;
  }
}

/**
 * Run the full workflow: check versions then conditionally build
 */
async function runFullWorkflow(cli: CLI): Promise<void> {
  console.log(chalk.bold.blue('🚀 Starting Full Font Processing Workflow\n'));

  console.log(chalk.bold.yellow('📋 Step 1: Checking font versions...'));

  // Use the reusable check function
  const updateResults = await runVersionCheck();

  // Only build the fonts that changed
  if (updateResults.hasUpdates) {
    const updatedFontIds = updateResults.updatedFonts.map((font) => font.id);

    if (updatedFontIds.length === 0) {
      console.log(chalk.yellow('\n💤 No updated font IDs to build'));
      return;
    }

    console.log(chalk.bold.yellow('\n📋 Step 2: Building updated fonts...'));
    console.log(chalk.gray(`Fonts: ${updatedFontIds.join(', ')}`));
    await cli.run(['build', '--fonts', updatedFontIds.join(' ')]);
    console.log(chalk.bold.green('\n🎉 Full workflow completed successfully!'));
  } else {
    console.log(chalk.bold.blue('\n💤 Skipping build - no updates needed'));
    console.log(chalk.gray('All fonts are already up to date.'));
  }
}

/**
 * Run forced workflow: build without version checking
 */
async function runForcedWorkflow(cli: CLI): Promise<void> {
  console.log(chalk.bold.blue('🚀 Starting Forced Font Processing Workflow\n'));
  console.log(chalk.yellow('⚠️  Skipping version check (forced build)'));

  console.log(chalk.bold.yellow('\n📋 Building fonts...'));
  await cli.run(['build']);
  console.log(chalk.bold.green('\n🎉 Forced workflow completed successfully!'));
}

/**
 * Run forced workflow with specific fonts: build without version checking
 */
async function runForcedWorkflowWithFonts(
  cli: CLI,
  fontIds: string[]
): Promise<void> {
  if (fontIds.length === 0) {
    console.error(chalk.red('❌ Please specify font IDs after --fonts'));
    console.log(
      chalk.yellow('Example: pnpm start --force --fonts "imingcp lxgwwenkaitc"')
    );
    process.exit(1);
  }

  console.log(chalk.bold.blue('🚀 Starting Forced Font Processing Workflow\n'));
  console.log(chalk.yellow('⚠️  Skipping version check (forced build)'));
  console.log(
    chalk.cyan(`🎯 Processing specific fonts: ${fontIds.join(', ')}`)
  );

  console.log(chalk.bold.yellow('\n📋 Building fonts...'));
  await cli.run(['build', '--fonts', fontIds.join(' ')]);
  console.log(chalk.bold.green('\n🎉 Forced workflow completed successfully!'));
}

/**
 * Process specific fonts (legacy support)
 */
async function runSpecificFonts(cli: CLI, fontIds: string[]): Promise<void> {
  if (fontIds.length === 0) {
    console.error(chalk.red('❌ Please specify font IDs after --fonts'));
    console.log(
      chalk.yellow('Example: pnpm start --fonts "imingcp lxgwwenkaitc"')
    );
    process.exit(1);
  }
  await cli.run(['build', '--fonts', fontIds.join(' ')]);
}

// Run only when executed directly (cross-platform, including Windows paths)
const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main();
}

export default main;
