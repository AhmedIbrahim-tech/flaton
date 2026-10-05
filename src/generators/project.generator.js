import path from 'node:path';
import { copyTemplate, ensureDir, isNonEmptyDirectory, templatesRoot } from '../utils/filesystem.js';
import { GenerationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { runCommand } from '../utils/command.js';
import { generateBackend } from './backend.generator.js';
import { generateSolution } from './solution.generator.js';
import { generateFrontend } from './frontend/frontend.generator.js';
import { writeGeneratedReadme } from './readme.generator.js';
import { writeGenerationManifest } from './manifest.generator.js';
import { describeFrontend } from '../models/frontend.js';
import { describeBackend } from '../models/backend.js';
import { installEnabledModules } from '../module-generator/module.generator.js';
import { saveUserPreferences } from '../utils/user-preferences.js';
import { resolveProjectPaths } from '../utils/project-paths.js';

/**
 * @param {object} options
 */
export async function generateProject(options) {
  const targetDirectory = path.join(options.output, options.folderName);

  if (await isNonEmptyDirectory(targetDirectory)) {
    throw new GenerationError(
      `Directory already exists and is not empty: ${targetDirectory}. Generation stopped to avoid overwriting files.`,
      {
        step: 'Validate target directory',
        command: '(none)',
        targetDirectory,
      },
    );
  }

  logger.info('Generating project...');
  await ensureDir(targetDirectory);
  logger.success('Root directory created');

  const hasBackend = Boolean(options.backend?.enabled || options.backend === true);
  const hasFrontend = Boolean(options.frontend?.enabled);

  const paths = options.paths ?? resolveProjectPaths({
    backend: options.backend,
    frontend: options.frontend,
  });

  const backendDirectory = hasBackend
    ? (paths.backend === '.' ? targetDirectory : path.join(targetDirectory, paths.backend))
    : null;

  const frontendDirectory = hasFrontend
    ? (paths.frontend === '.' ? targetDirectory : path.join(targetDirectory, paths.frontend))
    : null;

  const replacements = {
    __PASCAL_NAME__: options.pascalName,
    __DISPLAY_NAME__: options.displayName,
    __FOLDER_NAME__: options.folderName,
  };

  const generationOptions = {
    ...options,
    targetDirectory,
    backendDirectory,
    frontendDirectory,
    paths,
    replacements,
  };

  await copyTemplate(path.join(templatesRoot(), 'root'), targetDirectory, replacements);
  await writeGeneratedReadme(generationOptions);

  if (hasBackend && backendDirectory) {
    await generateBackend(generationOptions);
    await generateSolution(generationOptions);
    runCommand('dotnet', ['restore'], {
      cwd: backendDirectory,
      step: 'Restore backend packages',
    });
    logger.success('Dependencies configured');
  }

  if (hasFrontend && frontendDirectory) {
    await generateFrontend(generationOptions);
  }

  await writeGenerationManifest(generationOptions);

  const modulesToInstall = resolveModulesToInstall(options);
  if (modulesToInstall.length > 0 && hasBackend) {
    logger.info(`Installing V4 modules: ${modulesToInstall.join(', ')}`);
    await installEnabledModules({
      projectRoot: targetDirectory,
      moduleIds: modulesToInstall,
      yes: true,
      defaultRole: options.defaultRole ?? 'User',
      roles: options.roles ?? ['Admin', 'Editor', 'User'],
    });
  }

  if (hasBackend && backendDirectory) {
    runCommand('dotnet', ['build', '--no-restore'], {
      cwd: backendDirectory,
      step: 'Build backend solution',
    });
    logger.success('Backend build succeeded');
  }

  logger.success('Project generated successfully');
  logger.info(`Created ${options.displayName} at ${targetDirectory}`);
  if (hasBackend) {
    logger.info(`Backend: ${describeBackend(options.backend)}`);
  }
  if (hasFrontend) {
    logger.info(`Frontend: ${describeFrontend(options.frontend)}`);
  }
  logger.info('Generated files were left in place. Inspect them before running the apps.');

  // Post-generation preference saving prompt
  await maybeSaveUserPreferences(options);
}

/**
 * @param {object} options
 */
async function maybeSaveUserPreferences(options) {
  let shouldSave = options.saveDefaults;

  if (shouldSave === undefined && !options.yes) {
    try {
      shouldSave = await confirm({
        message: 'Save these choices as my default?',
        default: false,
      });
    } catch {
      shouldSave = false;
    }
  }

  if (shouldSave) {
    const prefData = {
      mode: options.mode,
      backend: options.backend?.enabled ? {
        presentation: options.backend.presentation,
        architecture: options.backend.architecture,
        mapping: options.backend.mapping,
        orm: options.backend.orm,
        database: options.backend.database,
        logging: options.backend.logging,
        backgroundJobs: options.backend.backgroundJobs,
        realtime: options.backend.realtime,
        authentication: options.backend.authentication,
      } : null,
      frontend: options.frontend?.enabled ? {
        library: options.frontend.library,
        framework: options.frontend.framework,
        language: options.frontend.language,
        styling: options.frontend.styling,
        state: options.frontend.state,
        httpClient: options.frontend.httpClient,
        forms: options.frontend.forms,
        componentSystem: options.frontend.componentSystem,
        localization: options.frontend.localization,
        realtime: options.frontend.realtime,
      } : null,
      packageManager: options.packageManager,
    };

    if (saveUserPreferences(prefData)) {
      logger.success('Saved developer preferences globally in ~/.flatron/config.json');
    }
  }
}

/**
 * @param {object} options
 * @returns {string[]}
 */
function resolveModulesToInstall(options) {
  const modules = options.modules ?? {};
  /** @type {string[]} */
  const ordered = [];
  const push = (id, enabled) => {
    if (enabled && !ordered.includes(id)) ordered.push(id);
  };

  push('auth', Boolean(modules.auth ?? options.auth ?? (options.backend?.authentication && options.backend.authentication !== 'none')));
  push('permissions', Boolean(modules.permissions));
  push('users', Boolean(modules.users));
  push('audit', Boolean(modules.audit));
  push('notifications', Boolean(modules.notifications));
  push('localization', Boolean(modules.localization));
  push('rich-text', Boolean(modules.richText));
  push('dashboard', Boolean(modules.dashboard ?? options.dashboard));
  return ordered;
}
