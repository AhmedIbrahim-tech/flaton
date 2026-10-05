import { FEATURE_GENERATOR_VERSION } from './feature.arguments.js';
import { registerFeaturePermissions } from '../module-generator/permissions/permissions.generator.js';
import { pathExists, ensureDir, writeFile } from '../utils/filesystem.js';
import { logger } from '../utils/logger.js';
import { runCommand } from '../utils/command.js';
import { buildFeatureConfig } from './feature.config.js';
import { planBackendFeature, backendConflictPaths, planBackendRegistryUpdates } from './backend/backend-feature.generator.js';
import {
  planFrontendFeature,
  frontendConflictPaths,
  applyRegistryUpdate,
} from './frontend/frontend-feature.generator.js';
import {
  findProjectRoot,
  readManifest,
  writeManifest,
  resolveFrontendStrategy,
} from './utils/manifest.js';
import { getBackendDirectory, getFrontendDirectory } from '../utils/project-paths.js';
import { setModuleManifestContext } from '../module-generator/modules-orchestrator-helpers.js';
import { isDapperOnly } from './backend/architecture.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * @param {object} resolvedOptions
 */
export async function generateFeature(resolvedOptions) {
  const projectRoot =
    resolvedOptions.projectRoot ?? (await findProjectRoot(process.cwd()));

  if (!projectRoot) {
    throw new Error('This directory is not a Flatron project.');
  }

  const manifest = await readManifest(projectRoot);
  setModuleManifestContext(manifest);
  const projectName = manifest.projectName;
  if (!projectName) {
    throw new Error('Project manifest is missing projectName. Re-run flatron or set projectName in .fullstack-app.json.');
  }
  const frontendStrategy = resolveFrontendStrategy(manifest);
  const hasBackend = manifest.backend?.enabled === true;
  const hasFrontend = manifest.frontend?.enabled === true && Boolean(frontendStrategy.library);
  const backendDir = getBackendDirectory(projectRoot, manifest) ?? projectRoot;
  const hasFileStorage = await pathExists(
    path.join(backendDir, 'Domain', 'Entities', 'StoredFile.cs'),
  );

  const config = buildFeatureConfig({
    ...resolvedOptions,
    projectRoot,
    projectName,
    manifest,
    packageManager: manifest.packageManager ?? 'npm',
    frontendStrategy,
    existingFeatures: Object.values(manifest.features ?? {}),
  });

  if (config.generation.backend && !hasBackend) {
    throw new Error('This project has no backend. Cannot generate backend feature code.');
  }

  if (config.generation.frontend && !hasFrontend) {
    throw new Error('This project has no frontend. Cannot generate frontend feature code.');
  }

  validateRelationshipTargets(config, manifest);

  const backendFiles = planBackendFeature(config, { hasFileStorage });
  const { files: frontendFiles, registryUpdates } = await planFrontendFeature(config);
  registryUpdates.push(...planBackendRegistryUpdates(config, { hasFileStorage }));

  if (config.dryRun) {
    const plannedRegistries = [];
    for (const entry of registryUpdates) {
      plannedRegistries.push(await applyRegistryUpdate(projectRoot, entry));
    }
    const allFiles = [...backendFiles, ...frontendFiles, ...plannedRegistries];
    const conflicts = await findConflicts(projectRoot, config, allFiles);
    if (conflicts.length > 0 && !config.force) {
      throw new Error(
        `Feature already exists or conflicts with:\n${conflicts.map((c) => `  - ${c}`).join('\n')}\nGeneration stopped. Use --force only if you intentionally want to overwrite generator-owned files.`,
      );
    }
    printDryRun(allFiles, config);
    return { dryRun: true, files: allFiles, config };
  }

  const conflicts = await findConflicts(projectRoot, config, [...backendFiles, ...frontendFiles]);
  if (conflicts.length > 0 && !config.force) {
    throw new Error(
      `Feature already exists or conflicts with:\n${conflicts.map((c) => `  - ${c}`).join('\n')}\nGeneration stopped. Use --force only if you intentionally want to overwrite generator-owned files.`,
    );
  }

  const written = new Set();
  for (const file of [...backendFiles, ...frontendFiles]) {
    const key = file.relativePath.replaceAll('\\', '/');
    if (written.has(key) && file.writeMode !== 'replace') {
      continue;
    }
    await writePlannedFile(projectRoot, file, config.force);
    written.add(key);
  }

  const plannedRegistries = [];
  for (const entry of registryUpdates) {
    const updated = await applyRegistryUpdate(projectRoot, entry);
    plannedRegistries.push(updated);
    await writePlannedFile(projectRoot, updated, config.force);
  }

  const allFiles = [...backendFiles, ...frontendFiles, ...plannedRegistries];

  await updateFeatureMetadata(projectRoot, manifest, config);
  await maybeWriteLocalization(projectRoot, config);
  await maybeRegisterFeaturePermissions(projectRoot, manifest, config);

  logger.success(`Feature ${config.feature.singularName} generated.`);
  logger.info('Feature generated. Run migration when ready.');

  if (config.migration && config.generation.backend && !isDapperOnly(config.orm)) {
    await generateMigration(projectRoot, config);
  }

  return { dryRun: false, files: allFiles, config };
}

/**
 * @param {string} projectRoot
 * @param {object} manifest
 * @param {object} config
 */
async function maybeRegisterFeaturePermissions(projectRoot, manifest, config) {
  if (!config.permissions) {
    return;
  }

  const actions = [];
  if (config.operations.list || config.operations.getById || config.operations.search) {
    actions.push('View');
  }
  if (config.operations.create) actions.push('Create');
  if (config.operations.update) actions.push('Update');
  if (config.operations.delete) actions.push('Delete');
  if (config.operations.restore) actions.push('Restore');

  if (actions.length === 0) {
    return;
  }

  const update = registerFeaturePermissions(
    { projectName: config.projectName },
    config.feature.pluralName,
    actions,
  );
  const absolute = path.join(projectRoot, update.relativePath);
  let existing = '';
  if (await pathExists(absolute)) {
    existing = await fs.readFile(absolute, 'utf8');
  }
  await writeFile(absolute, update.update(existing));
  logger.success(`Registered permissions for ${config.feature.pluralName}`);
}

/**
 * @param {object} config
 * @param {object} manifest
 */
function validateRelationshipTargets(config, manifest) {
  const features = manifest.features ?? {};
  for (const field of config.fields) {
    if (field.kind !== 'relationship') {
      continue;
    }

    const target =
      field.target ??
      field.relationship?.targetEntity ??
      field.relationship?.targetFeature;

    if (!target) {
      throw new Error(`Relationship field "${field.name}" is missing a target.`);
    }

    const known = Object.values(features).some(
      (feature) =>
        feature.entity === target ||
        feature.plural === target ||
        feature.entity?.toLowerCase() === String(target).toLowerCase(),
    );

    if (!known) {
      const names = Object.values(features).map((f) => f.entity).join(', ');
      throw new Error(
        `Relationship target "${target}" was not found in project features. Known: ${names || '(none)'}. Generate the target feature first.`,
      );
    }
  }
}

/**
 * @param {string} projectRoot
 * @param {object} config
 * @param {{ relativePath: string, writeMode?: string }[]} files
 */
async function findConflicts(projectRoot, config, files) {
  /** @type {string[]} */
  const conflicts = [];

  const markers = [
    ...(config.generation.backend ? backendConflictPaths(config) : []),
    ...(config.generation.frontend ? frontendConflictPaths(config) : []),
  ];

  for (const marker of markers) {
    const full = path.join(projectRoot, marker);
    if (await pathExists(full)) {
      conflicts.push(marker);
    }
  }

  for (const file of files) {
    if (file.writeMode === 'ifMissing' || file.writeMode === 'replace') {
      continue;
    }

    const full = path.join(projectRoot, file.relativePath);
    if (await pathExists(full)) {
      conflicts.push(file.relativePath);
    }
  }

  return [...new Set(conflicts)];
}

/**
 * @param {string} projectRoot
 * @param {{ relativePath: string, contents: string, writeMode?: string }} file
 * @param {boolean} force
 */
async function writePlannedFile(projectRoot, file, force) {
  const fullPath = path.join(projectRoot, file.relativePath);
  const mode = file.writeMode ?? 'create';

  if (mode === 'ifMissing') {
    if (await pathExists(fullPath)) {
      return;
    }
    await writeFile(fullPath, file.contents);
    return;
  }

  if (mode === 'replace' || force) {
    await writeFile(fullPath, file.contents);
    return;
  }

  if (await pathExists(fullPath)) {
    throw new Error(`Refusing to overwrite existing file: ${file.relativePath}`);
  }

  await writeFile(fullPath, file.contents);
}

/**
 * @param {{ relativePath: string, writeMode?: string }[]} files
 * @param {object} config
 */
function printDryRun(files, config) {
  logger.info('Dry run — no files will be changed.\n');
  logger.info(`Feature: ${config.feature.singularName} / ${config.feature.pluralName}`);
  logger.info(
    `Generate: backend=${config.generation.backend} frontend=${config.generation.frontend}`,
  );
  logger.info(`Surface: dashboard=${config.surface.dashboard} public=${config.surface.public}`);
  logger.info('\nWould create/update:');

  for (const file of files) {
    const mode = file.writeMode ?? 'create';
    process.stdout.write(`  [${mode}] ${file.relativePath}\n`);
  }

  if (config.migration) {
    logger.info(`\nWould generate EF migration: Add${config.feature.pluralName}Feature`);
  }

  logger.info('\nNo files changed.');
}

/**
 * @param {string} projectRoot
 * @param {object} manifest
 * @param {object} config
 */
async function updateFeatureMetadata(projectRoot, manifest, config) {
  const key = config.feature.camelPluralName;
  const surfaces = [];
  if (config.surface.dashboard) surfaces.push('dashboard');
  if (config.surface.public) surfaces.push('public');

  manifest.features = manifest.features ?? {};
  manifest.features[key] = {
    entity: config.feature.singularName,
    plural: config.feature.pluralName,
    backend: config.generation.backend,
    frontend: config.generation.frontend,
    surface: surfaces,
    generatedWith: FEATURE_GENERATOR_VERSION,
    fields: config.fields.map(serializeFieldMetadata),
  };

  manifest.generatorVersion = manifest.generatorVersion ?? FEATURE_GENERATOR_VERSION;
  await writeManifest(projectRoot, manifest);
}

/**
 * @param {object} field
 */
function serializeFieldMetadata(field) {
  if (field.kind === 'relationship') {
    return {
      name: field.name,
      kind: 'relationship',
      targetFeature: field.target,
      relationshipType: field.relationshipType,
      required: field.required,
    };
  }

  if (field.kind === 'enum') {
    return {
      name: field.name,
      kind: 'enum',
      enumName: field.enumName,
      required: field.required,
    };
  }

  if (field.kind === 'file' || field.kind === 'image') {
    return {
      name: field.name,
      kind: field.kind,
      multiple: field.cardinality === 'multiple',
      required: field.required,
    };
  }

  return {
    name: field.name,
    kind: field.kind === 'scalar' ? field.type : field.kind ?? field.type,
    required: field.required,
  };
}

/**
 * @param {string} projectRoot
 * @param {object} config
 */
async function maybeWriteLocalization(projectRoot, config) {
  if (!config.generation.frontend) {
    return;
  }

  const strategy = config.frontendStrategy;
  const keyBase = `features.${config.feature.camelPluralName}`;
  const en = {
    title: config.labels.enPlural,
    create: `Create ${config.labels.enSingular}`,
    edit: `Edit ${config.labels.enSingular}`,
  };

  const frontendDir = getFrontendDirectory(projectRoot, config) ?? projectRoot;

  if (strategy?.library === 'react' && strategy.framework === 'next') {
    await mergeJsonMessages(
      path.join(frontendDir, 'src', 'i18n', 'messages', 'en.json'),
      keyBase,
      en,
    );
    if (config.labels.arPlural) {
      await mergeJsonMessages(
        path.join(frontendDir, 'src', 'i18n', 'messages', 'ar.json'),
        keyBase,
        {
          title: config.labels.arPlural,
          create: config.labels.arSingular
            ? `إنشاء ${config.labels.arSingular}`
            : en.create,
          edit: config.labels.arSingular
            ? `تعديل ${config.labels.arSingular}`
            : en.edit,
        },
      );
    }
  }

  if (strategy?.library === 'react' && strategy.framework === 'vite') {
    await mergeJsonMessages(
      path.join(frontendDir, 'src', 'i18n', 'messages', 'en.json'),
      keyBase,
      en,
    );
  }
}

/**
 * @param {string} filePath
 * @param {string} keyBase
 * @param {object} value
 */
async function mergeJsonMessages(filePath, keyBase, value) {
  if (!(await pathExists(filePath))) {
    return;
  }

  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const parts = keyBase.split('.');
  let cursor = data;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor[parts[i]] = cursor[parts[i]] ?? {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = {
    ...(cursor[parts[parts.length - 1]] ?? {}),
    ...value,
  };
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * @param {string} projectRoot
 * @param {object} config
 */
async function generateMigration(projectRoot, config) {
  if (isDapperOnly(config.orm)) {
    logger.info('Skipping EF migration because this project uses Dapper-only data access.');
    return;
  }
  const backendDir = getBackendDirectory(projectRoot, config) ?? projectRoot;
  const name = `Add${config.feature.pluralName}Feature`;
  logger.step(`Generating EF migration ${name}...`);
  try {
    runCommand(
      'dotnet',
      [
        'ef',
        'migrations',
        'add',
        name,
        '--project',
        'Infrastructure',
        '--startup-project',
        'API',
        '--output-dir',
        'Persistence/Migrations',
      ],
      {
        cwd: backendDir,
        step: `EF migration ${name}`,
      },
    );
    logger.success(`Migration ${name} created (database was not updated).`);
  } catch (error) {
    logger.error(
      `Could not generate migration. Install EF tools (dotnet tool install -g dotnet-ef) and ensure SQL provider is configured. ${error instanceof Error ? error.message : error}`,
    );
  }
}

/**
 * @param {string} [cwd]
 */
export async function listFeatures(cwd = process.cwd()) {
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error('This directory is not a Flatron project.');
  }

  const manifest = await readManifest(projectRoot);
  const features = manifest.features ?? {};
  const strategy = resolveFrontendStrategy(manifest);

  if (Object.keys(features).length === 0) {
    process.stdout.write('No features registered in .fullstack-app.json.\n');
    return;
  }

  for (const feature of Object.values(features)) {
    process.stdout.write(`${feature.plural}\n`);
    process.stdout.write(
      `  Backend: ${feature.backend ? 'yes' : 'no'}  Frontend: ${feature.frontend ? 'yes' : 'no'}  Framework: ${describeFramework(strategy)}\n`,
    );
    process.stdout.write(`  Surface: ${(feature.surface ?? []).join(', ') || 'n/a'}\n`);

    const fields = feature.fields ?? [];
    const scalars = fields.filter((f) => !['relationship', 'enum', 'file', 'image'].includes(f.kind));
    const enums = fields.filter((f) => f.kind === 'enum');
    const rels = fields.filter((f) => f.kind === 'relationship');
    const media = fields.filter((f) => f.kind === 'file' || f.kind === 'image');

    if (scalars.length) {
      process.stdout.write(`  Scalars: ${scalars.map((f) => f.name).join(', ')}\n`);
    }
    for (const field of enums) {
      process.stdout.write(`  Enum: ${field.name} → ${field.enumName ?? '?'}\n`);
    }
    for (const field of rels) {
      const label =
        field.relationshipType === 'many-to-many'
          ? 'ManyToMany'
          : field.relationshipType === 'many-to-one'
            ? 'BelongsTo'
            : field.relationshipType;
      process.stdout.write(`  ${label}: ${field.targetFeature ?? '?'}\n`);
    }
    if (media.length) {
      process.stdout.write(`  Media: ${media.map((f) => f.name).join(', ')}\n`);
    }
    process.stdout.write('\n');
  }
}

/**
 * @param {{ library: string|null, framework: string|null }} strategy
 */
function describeFramework(strategy) {
  if (strategy.library === 'react') {
    return `React + ${strategy.framework}`;
  }
  if (strategy.library === 'angular') {
    return 'Angular';
  }
  return 'none';
}

export { findProjectRoot, ensureDir };
