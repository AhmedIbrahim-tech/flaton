import {
  parseModuleArguments,
  printModuleHelp,
  printModuleVersion,
} from './module-generator/module.arguments.js';
import {
  generateModule,
  listModulesCli,
  printModuleStatus,
} from './module-generator/module.generator.js';
import { promptModuleOptions } from './module-generator/module.prompts.js';
import { findProjectRoot, readManifest } from './feature-generator/utils/manifest.js';
import { GenerationError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { handleCliCancellation } from './utils/cli-cancellation.js';

export async function runModuleCli(argv = process.argv) {
  try {
    const parsed = parseModuleArguments(argv);

    if (parsed.help) {
      printModuleHelp();
      return;
    }

    if (parsed.version) {
      printModuleVersion();
      return;
    }

    if (parsed.list) {
      await listModulesCli(process.cwd());
      return;
    }

    if (parsed.status) {
      await printModuleStatus(process.cwd());
      return;
    }

    const projectRoot = await findProjectRoot(process.cwd());
    if (!projectRoot) {
      throw new Error(
        'This directory is not a Flatron project. Navigate to a Flatron project first.',
      );
    }
    const manifest = await readManifest(projectRoot);

    let optionsToGenerate = null;

    if (!parsed.yes) {
      optionsToGenerate = await promptModuleOptions(parsed, projectRoot, manifest);
      if (!optionsToGenerate) {
        return;
      }
    } else {
      if (!parsed.moduleName) {
        logger.error(
          'Please specify a module name when using --yes (e.g. flatron create module auth --yes).',
        );
        process.exitCode = 1;
        return;
      }
      optionsToGenerate = {
        moduleName: parsed.moduleName,
        projectRoot,
        dryRun: parsed.dryRun,
        migration: parsed.migration,
        force: parsed.force,
        yes: true,
        defaultRole: parsed.defaultRole,
        roles: parsed.roles,
      };
    }

    await generateModule(optionsToGenerate);
  } catch (error) {
    if (handleCliCancellation(error, 'Module generation cancelled.')) {
      return;
    }
    if (error instanceof GenerationError) {
      logger.error('Module generation failed.');
      logger.error(`Step: ${error.step}`);
      if (error.message) {
        logger.error(error.message);
      }
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

const isInvokedDirectly =
  process.argv[1] &&
  (process.argv[1].endsWith('create-fullstack-module.js') ||
    process.argv[1].endsWith('module-index.js'));

if (isInvokedDirectly) {
  await runModuleCli();
}

