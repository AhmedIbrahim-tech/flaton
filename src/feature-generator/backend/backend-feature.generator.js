import { planDomainFiles } from './domain.generator.js';
import { planPersistenceFiles, planPersistenceRegistryUpdates } from './persistence.generator.js';
import { planApplicationFiles } from './application.generator.js';
import { planServiceApplicationFiles, planApplicationServiceRegistry } from './application-services.generator.js';
import { planApiFiles, planApiRegistryUpdates } from './api.generator.js';
import { planMinimalApiFiles, planMinimalApiRegistryUpdates } from './minimal-api.generator.js';
import { planMvcFiles } from './mvc.generator.js';
import { planRazorPagesFiles } from './razor-pages.generator.js';
import { planFileStorageInfrastructure, planFileStorageRegistry } from './file-storage.generator.js';
import { hasMediaField } from '../fields/field-mappers.js';
import { getBackendFilePath } from '../../utils/project-paths.js';
import { isServicesArchitecture, usesDapper } from './architecture.js';
import { planDapperRepositoryRegistry } from './dapper-persistence.generator.js';
import {
  applicationDiPath,
  applicationFeatureName,
  upsertAutoMapperRegistration,
} from './clean-architecture.js';
import { isAutoMapper } from '../feature-profile.js';

/**
 * @param {object} config
 * @param {{ hasFileStorage?: boolean }} [context]
 */
export function planBackendFeature(config, context = {}) {
  if (!config.generation.backend) {
    return [];
  }

  /** @type {{ relativePath: string, contents: string, writeMode?: string }[]} */
  const files = [];

  if (hasMediaField(config.fields) && !context.hasFileStorage) {
    files.push(...planFileStorageInfrastructure(config.projectName, config));
  }

  files.push(...planDomainFiles(config));
  files.push(...planPersistenceFiles(config));
  files.push(
    ...(isServicesArchitecture(config.architecture)
      ? planServiceApplicationFiles(config)
      : planApplicationFiles(config)),
  );

  const presentation = config.presentation ?? 'controllers';
  if (presentation === 'minimal-api') {
    files.push(...planMinimalApiFiles(config));
  } else if (presentation === 'mvc') {
    files.push(...planMvcFiles(config));
  } else if (presentation === 'razor-pages') {
    files.push(...planRazorPagesFiles(config));
  } else {
    files.push(...planApiFiles(config));
  }

  return files;
}

/**
 * Registry updates for Application Services DI (no-op for CQRS).
 * @param {object} config
 * @param {{ hasFileStorage?: boolean }} [context]
 */
export function planBackendRegistryUpdates(config, context = {}) {
  if (!config.generation.backend) {
    return [];
  }

  /** @type {{ relativePath: string, update: (existing: string) => string }[]} */
  const updates = [];

  if (usesDapper(config.orm)) {
    updates.push(planDapperRepositoryRegistry(config));
  }

  updates.push(...planPersistenceRegistryUpdates(config));

  const presentation = config.presentation ?? 'controllers';
  if (presentation === 'minimal-api') {
    updates.push(...planMinimalApiRegistryUpdates(config));
  } else if (presentation === 'controllers') {
    updates.push(...planApiRegistryUpdates(config));
  }

  if (isServicesArchitecture(config.architecture)) {
    updates.push(planApplicationServiceRegistry(config));
  }

  if (isAutoMapper(config)) {
    updates.push({
      relativePath: applicationDiPath(config),
      update: (existing) => upsertAutoMapperRegistration(existing, config.projectName),
    });
  }

  if (hasMediaField(config.fields) && !context.hasFileStorage) {
    updates.push(...planFileStorageRegistry(config));
  }

  return updates;
}

/**
 * Conflict markers for an existing backend feature.
 * @param {object} config
 */
export function backendConflictPaths(config) {
  const { singularName, pluralName } = config.feature;
  const presentation = config.presentation ?? 'controllers';
  const presentationPaths = [];

  if (presentation === 'controllers') {
    presentationPaths.push(getBackendFilePath(config, 'API', 'Controllers', `${pluralName}Controller.cs`));
  } else if (presentation === 'minimal-api') {
    presentationPaths.push(getBackendFilePath(config, 'API', 'Endpoints', pluralName));
  } else if (presentation === 'mvc') {
    presentationPaths.push(getBackendFilePath(config, 'Web', 'Controllers', `${pluralName}Controller.cs`));
  } else if (presentation === 'razor-pages') {
    presentationPaths.push(getBackendFilePath(config, 'Web', 'Pages', pluralName));
  }

  return [
    getBackendFilePath(config, 'Domain', 'Entities', `${singularName}.cs`),
    isServicesArchitecture(config.architecture)
      ? getBackendFilePath(config, 'Application', 'Modules', pluralName)
      : getBackendFilePath(config, 'Application', 'Features', applicationFeatureName(config)),
    ...presentationPaths,
  ];
}

