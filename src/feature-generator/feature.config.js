import { deriveFeatureNames } from './utils/feature-naming.js';
import { validateFeatureName } from './utils/safe-generation.js';
import { normalizeField } from './fields/field-types.js';
import { readPackageMeta } from '../cli/arguments.js';
import { resolveProjectPaths } from '../utils/project-paths.js';
import {
  resolveBackendArchitecture,
  resolveBackendDatabase,
  resolveBackendOrm,
  resolveBackendPresentation,
} from './backend/architecture.js';
import {
  resolveBackendAuthentication,
  resolveBackendEnabled,
  resolveBackendMapping,
  resolveFrontendProfile,
  resolvePermissionsEnabled,
} from './feature-profile.js';

/**
 * @param {object} input
 */
export function buildFeatureConfig(input) {
  const nameResult = validateFeatureName(input.singularName);
  if (!nameResult.ok) {
    throw new Error(nameResult.error);
  }

  const names = deriveFeatureNames(nameResult.name, input.pluralName);
  if (input.pluralName) {
    const pluralResult = validateFeatureName(input.pluralName);
    if (!pluralResult.ok) {
      throw new Error(pluralResult.error);
    }
  }

  const mode = input.mode ?? 'fullstack';
  const generation = {
    backend: mode === 'fullstack' || mode === 'backend',
    frontend: mode === 'fullstack' || mode === 'frontend',
  };

  const surfaceInput = input.surface ?? 'dashboard';
  const surface = {
    dashboard: surfaceInput === 'dashboard' || surfaceInput === 'both',
    public: surfaceInput === 'public' || surfaceInput === 'both',
  };

  const featureType = input.featureType ?? 'crud';
  const ops = input.operations ?? {};

  const operations = {
    list: true,
    getById: true,
    create: featureType === 'crud' && ops.create !== false,
    update: featureType === 'crud' && ops.update !== false,
    delete: featureType === 'crud' && ops.delete !== false,
    restore: featureType === 'crud' && ops.restore !== false,
    search: ops.search !== false,
    pagination: ops.pagination !== false,
  };

  if (featureType === 'readonly') {
    operations.create = false;
    operations.update = false;
    operations.delete = false;
    operations.restore = false;
  }

  const fields = (input.fields ?? []).map((field) => normalizeField(field));
  if (fields.length === 0) {
    throw new Error('At least one field is required.');
  }

  const labels = {
    enSingular: input.labels?.enSingular ?? names.singularName,
    enPlural: input.labels?.enPlural ?? names.pluralName,
    arSingular: input.labels?.arSingular ?? null,
    arPlural: input.labels?.arPlural ?? null,
  };

  const pkg = readPackageMeta();
  const paths = input.paths ?? resolveProjectPaths(input.manifest ?? {});
  const manifest = input.manifest ?? {};
  const architecture = resolveBackendArchitecture({
    architecture: input.architecture,
    manifest,
  });
  const presentation = resolveBackendPresentation({
    presentation: input.presentation,
    manifest,
  });
  const orm = resolveBackendOrm({
    orm: input.orm,
    manifest,
  });
  const database = resolveBackendDatabase({
    database: input.database,
    manifest,
  });
  const authentication = resolveBackendAuthentication({
    authentication: input.authentication,
    manifest,
  });
  const mapping = resolveBackendMapping({
    mapping: input.mapping,
    manifest,
  });
  const permissions = resolvePermissionsEnabled({
    permissions: input.permissions,
    manifest,
  });
  const backendEnabled = resolveBackendEnabled({
    backend: input.backend,
    manifest,
  });
  const frontend = resolveFrontendProfile({
    frontend: input.frontend,
    frontendStrategy: input.frontendStrategy,
    manifest,
  });
  const projectName =
    input.projectName
    ?? manifest.projectName
    ?? null;

  return {
    feature: names,
    generation,
    surface,
    operations,
    fields,
    labels,
    featureType,
    paths,
    presentation,
    architecture,
    orm,
    database,
    authentication,
    mapping,
    permissions,
    backend: {
      enabled: backendEnabled,
      presentation,
      architecture,
      orm,
      database,
      authentication,
      mapping,
      permissions,
    },
    frontend,
    dryRun: Boolean(input.dryRun),
    migration: Boolean(input.migration),
    force: Boolean(input.force),
    generatePermissions: Boolean(input.generatePermissions),
    localizeContent: Boolean(input.localizeContent),
    projectRoot: input.projectRoot,
    projectName,
    packageManager: input.packageManager ?? manifest.packageManager ?? 'npm',
    frontendStrategy: input.frontendStrategy ?? {
      library: frontend.library,
      framework: frontend.framework,
    },
    generatorVersion: pkg.version,
  };
}
