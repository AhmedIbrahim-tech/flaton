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

export async function runFeatureCli(argv = process.argv) {
  try {
    const parsed = parseFeatureArguments(argv);

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

    if (parsed.yes && !parsed.featureName) {
      logger.error(
        'Please specify a feature name when using --yes (e.g. flatron create feature Product --yes).',
      );
      process.exitCode = 1;
      return;
    }

    const projectRoot = await findProjectRoot(process.cwd());
    if (!projectRoot) {
      throw new Error(
        'This directory is not a Flatron project. Navigate to a Flatron project first.',
      );
    }

    const manifest = await readManifest(projectRoot);
    const strategy = resolveFrontendStrategy(manifest);
    const modules = manifest.modules ?? {};
    const project = {
      projectRoot,
      hasBackend: manifest.backend?.enabled !== false && manifest.mode !== 'frontend-only',
      hasFrontend: manifest.frontend?.enabled !== false && manifest.mode !== 'backend-only' && Boolean(strategy.library),
      architecture: manifest.backend?.architecture === 'services' ? 'Services' : 'CQRS + MediatR',
      orm: manifest.backend?.orm === 'dapper' ? 'Dapper' : manifest.backend?.orm === 'hybrid' ? 'Hybrid (EF Core + Dapper)' : 'EF Core',
      database: manifest.backend?.database ?? 'sqlserver',
      presentation: manifest.backend?.presentation ?? 'controllers',
      frontendStrategy: strategy,
      modules: {
        permissions: Boolean(modules.permissions?.enabled),
        localization: Boolean(modules.localization?.enabled),
        richText: Boolean(modules.richText?.enabled || modules['rich-text']?.enabled),
        audit: Boolean(modules.audit?.enabled),
      },
      existingFeatures: Object.entries(manifest.features ?? {}).map(
        ([key, value]) => ({
          key,
          entity: value.entity,
          singularName: value.entity,
          name: value.entity,
          plural: value.plural,
          fields: value.fields ?? [],
        }),
      ),
    };

    const resolved = await resolveFeatureOptions(
      parsed,
      project,
      project.existingFeatures,
      projectRoot,
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

const isInvokedDirectly =
  process.argv[1] &&
  (process.argv[1].endsWith('create-fullstack-feature.js') ||
    process.argv[1].endsWith('feature-index.js'));

if (isInvokedDirectly) {
  await runFeatureCli();
}

