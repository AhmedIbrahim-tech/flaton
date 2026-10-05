import {
  parseFeatureArguments,
  printFeatureHelp,
  printFeatureVersion,
} from './feature-generator/feature.arguments.js';
import { resolveFeatureOptions } from './feature-generator/feature.prompts.js';
import {
  generateFeature,
  listFeatures,
  findProjectRoot,
} from './feature-generator/feature.generator.js';
import {
  readManifest,
  resolveFrontendStrategy,
} from './feature-generator/utils/manifest.js';
import { GenerationError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { handleCliCancellation } from './utils/cli-cancellation.js';

async function main() {
  try {
    const parsed = parseFeatureArguments(process.argv);

    if (parsed.help) {
      printFeatureHelp();
      return;
    }

    if (parsed.version) {
      printFeatureVersion();
      return;
    }

    if (parsed.list) {
      await listFeatures(process.cwd());
      return;
    }

    const projectRoot = await findProjectRoot(process.cwd());
    if (!projectRoot) {
      throw new Error('This directory is not a Flatron project.');
    }

    const manifest = await readManifest(projectRoot);
    const strategy = resolveFrontendStrategy(manifest);
    const modules = manifest.modules ?? {};
    const project = {
      hasBackend: manifest.backend?.enabled === true,
      hasFrontend: manifest.frontend?.enabled === true && Boolean(strategy.library),
      modules: {
        permissions: Boolean(modules.permissions?.enabled),
        localization: Boolean(modules.localization?.enabled),
        richText: Boolean(modules.richText?.enabled),
        audit: Boolean(modules.audit?.enabled),
      },
      existingFeatures: Object.entries(manifest.features ?? {}).map(
        ([key, value]) => ({
          key,
          entity: value.entity,
          plural: value.plural,
          fields: value.fields ?? [],
        }),
      ),
    };

    const resolved = await resolveFeatureOptions(
      parsed,
      project,
      project.existingFeatures,
    );
    if (!resolved) {
      logger.info('Feature generation cancelled.');
      return;
    }
    await generateFeature({
      ...resolved,
      projectRoot,
    });
  } catch (error) {
    if (handleCliCancellation(error, 'Feature generation cancelled.')) {
      return;
    }
    if (error instanceof GenerationError) {
      logger.error('Feature generation failed.');
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
