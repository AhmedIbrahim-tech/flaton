import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathExists } from '../../utils/filesystem.js';
import { planReactModuleFiles } from './react/react-feature.generator.js';
import { planNextFeatureFiles } from './react/next-feature.generator.js';
import { planViteFeatureFiles, buildViteRouteRegistryUpdate } from './react/vite-feature.generator.js';
import {
  buildGeneratedReducers,
  buildGeneratedDashboardNav,
} from './react/react-registries.js';
import { planSharedReactControls } from './react/shared-controls.generator.js';
import { planAngularFeatureFiles } from './angular/angular-feature.generator.js';
import {
  buildAngularGeneratedRoutes,
  buildAngularDashboardNav,
} from './angular/angular-registries.js';
import { planSharedAngularControls } from './angular/shared-controls.generator.js';
import { getFrontendFilePath } from '../../utils/project-paths.js';
import { emitFrontendLanguage, emitSource, frontendSourceName } from './emit-language.js';
import { isReduxState } from '../feature-profile.js';

/**
 * @param {object} config
 */
export async function planFrontendFeature(config) {
  if (!config.generation.frontend) {
    return { files: [], registryUpdates: [] };
  }

  const strategy = config.frontendStrategy ?? {};
  /** @type {{ relativePath: string, contents: string, writeMode?: string }[]} */
  const files = [];
  /** @type {{ relativePath: string, update: (existing: string) => string }[]} */
  const registryUpdates = [];

  if (strategy.library === 'react') {
    files.push(...planSharedReactControls(config));
    files.push(...planReactModuleFiles(config));

    if (strategy.framework === 'next') {
      files.push(...planNextFeatureFiles(config));
    }

    if (strategy.framework === 'vite') {
      files.push(...planViteFeatureFiles(config));
      registryUpdates.push({
        relativePath: getFrontendFilePath(
          config,
          'src',
          'app',
          'router',
          frontendSourceName(config, 'generated-routes.tsx'),
        ),
        update: (existing) => emitSource(buildViteRouteRegistryUpdate(config, existing), config),
      });
    }

    if (isReduxState(config)) {
      registryUpdates.push({
        relativePath: getFrontendFilePath(
          config,
          'src',
          'store',
          frontendSourceName(config, 'generated-reducers.ts'),
        ),
        update: (existing) => emitSource(buildGeneratedReducers(config, existing), config),
      });
    }

    if (config.surface.dashboard) {
      registryUpdates.push({
        relativePath: getFrontendFilePath(
          config,
          'src',
          'navigation',
          frontendSourceName(config, 'generated-dashboard-nav.ts'),
        ),
        update: (existing) => emitSource(buildGeneratedDashboardNav(config, existing), config),
      });
    }
  }

  if (strategy.library === 'angular') {
    files.push(...planSharedAngularControls(config));
    files.push(...planAngularFeatureFiles(config));

    registryUpdates.push({
      relativePath: getFrontendFilePath(config, 'src', 'app', 'router', 'generated-routes.ts'),
      update: (existing) => buildAngularGeneratedRoutes(config, existing).contents,
    });

    if (config.surface.dashboard) {
      registryUpdates.push({
        relativePath: getFrontendFilePath(
          config,
          'src',
          'app',
          'navigation',
          'generated-dashboard-nav.ts',
        ),
        update: (existing) => buildAngularDashboardNav(config, existing).contents,
      });
    }
  }

  return { files: emitFrontendLanguage(files, config), registryUpdates };
}

/**
 * @param {object} config
 */
export function frontendConflictPaths(config) {
  const strategy = config.frontendStrategy ?? {};
  const kebabPlural = config.feature?.kebabPlural ?? config.feature?.kebabPluralName;

  if (strategy.library === 'react') {
    return [getFrontendFilePath(config, 'src', 'modules', kebabPlural)];
  }

  if (strategy.library === 'angular') {
    return [getFrontendFilePath(config, 'src', 'app', 'features', kebabPlural)];
  }

  return [];
}

/**
 * @param {string} projectRoot
 * @param {{ relativePath: string, update: (existing: string) => string }} entry
 */
export async function applyRegistryUpdate(projectRoot, entry) {
  const fullPath = path.join(projectRoot, entry.relativePath);
  const existing = (await pathExists(fullPath))
    ? await fs.readFile(fullPath, 'utf8')
    : '';
  return {
    relativePath: entry.relativePath,
    contents: entry.update(existing),
    writeMode: 'replace',
  };
}
