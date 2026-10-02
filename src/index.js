import { parseArguments, printHelp, printVersion } from './cli/arguments.js';
import { resolveOptions } from './cli/prompts.js';
import { generateProject } from './generators/project.generator.js';
import { GenerationError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { handleCliCancellation } from './utils/cli-cancellation.js';
import { setVerbose } from './utils/command.js';

async function main() {
  try {
    const parsed = parseArguments(process.argv);

    if (parsed.verbose) {
      setVerbose(true);
    }

    if (parsed.help) {
      printHelp();
      return;
    }

    if (parsed.version) {
      printVersion();
      return;
    }

    const options = await resolveOptions(parsed);
    if (!options) {
      logger.info('Project generation cancelled.');
      return;
    }

    await generateProject(options);
  } catch (error) {
    if (handleCliCancellation(error, 'Project generation cancelled.')) {
      return;
    }
    if (error instanceof GenerationError) {
      logger.error('Generation failed.');
      logger.error(`Step: ${error.step}`);
      logger.error(`Command: ${error.command}`);
      logger.error(`Target directory: ${error.targetDirectory}`);
      if (error.message) {
        logger.error(error.message);
      }
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

await main();
