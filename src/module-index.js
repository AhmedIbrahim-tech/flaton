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
import { GenerationError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { handleCliCancellation } from './utils/cli-cancellation.js';

async function main() {
  try {
    const parsed = parseModuleArguments(process.argv);

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

    if (!parsed.moduleName) {
      printModuleHelp();
      process.exitCode = 1;
      return;
    }

    await generateModule({
      moduleName: parsed.moduleName,
      dryRun: parsed.dryRun,
      migration: parsed.migration,
      force: parsed.force,
      yes: parsed.yes,
      defaultRole: parsed.defaultRole,
      roles: parsed.roles,
    });
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

await main();
