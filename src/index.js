import { parseArguments, printHelp, printVersion } from "./cli/arguments.js";
import { resolveOptions } from "./cli/prompts.js";
import { generateProject } from "./generators/project.generator.js";
import { GenerationError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
import { handleCliCancellation } from "./utils/cli-cancellation.js";
import { setVerbose } from "./utils/command.js";
import { runModuleCli } from "./module-index.js";
import { runFeatureCli } from "./feature-index.js";

async function main() {
  try {
    const rawArgs = process.argv.slice(2);
    const firstArg = rawArgs[0];

    if (firstArg === "create") {
      const sub = rawArgs[1];
      if (sub === "module") {
        const syntheticArgv = [
          process.argv[0],
          `${process.argv[1]} create module`,
          ...rawArgs.slice(2),
        ];
        await runModuleCli(syntheticArgv);
        return;
      }
      if (sub === "feature") {
        const syntheticArgv = [
          process.argv[0],
          `${process.argv[1]} create feature`,
          ...rawArgs.slice(2),
        ];
        await runFeatureCli(syntheticArgv);
        return;
      }
      if (!sub || sub === "--help" || sub === "-h") {
        process.stdout.write(`
Usage:
  flatron create module [name] [options]   Install an application module
  flatron create feature <name> [options]  Generate a business entity feature

Examples:
  flatron create module
  flatron create module auth
  flatron create feature Product
\n`);
        return;
      }

      logger.error(
        `Unknown create target: ${sub}\n\nAvailable targets:\n  feature\n  module`,
      );
      process.exitCode = 1;
      return;
    }

    if (firstArg === "module") {
      const syntheticArgv = [
        process.argv[0],
        `${process.argv[1]} module`,
        ...rawArgs.slice(1),
      ];
      await runModuleCli(syntheticArgv);
      return;
    }

    if (firstArg === "feature") {
      const syntheticArgv = [
        process.argv[0],
        `${process.argv[1]} feature`,
        ...rawArgs.slice(1),
      ];
      await runFeatureCli(syntheticArgv);
      return;
    }

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
      logger.info("Project generation cancelled.");
      return;
    }

    await generateProject(options);
  } catch (error) {
    if (handleCliCancellation(error, "Project generation cancelled.")) {
      return;
    }
    if (error instanceof GenerationError) {
      logger.error("Generation failed.");
      logger.error(`Step: ${error.step}`);
      logger.error(`Command: ${error.command}`);
      logger.error(`Target directory: ${error.targetDirectory}`);
      if (error.message) {
        logger.error(error.message);
      }
      process.exitCode = 1;
      return;
    }

    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}

await main();
