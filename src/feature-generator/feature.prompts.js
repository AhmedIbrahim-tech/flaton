import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { FIELD_TYPES, normalizeField } from './fields/field-types.js';
import { suggestPlural } from './feature.arguments.js';
import { validateFeatureName, validateFieldName } from './utils/safe-generation.js';

/**
 * @param {Record<string, unknown>} parsed
 * @param {{ hasBackend: boolean, hasFrontend: boolean }} project
 * @param {Array<string | { singularName?: string, name?: string }>} [existingFeatures]
 */
export async function resolveFeatureOptions(parsed, project, existingFeatures = []) {
  if (parsed.yes && parsed.featureName && parsed.fields?.length) {
    return buildFromFlags(parsed, project);
  }

  const singularRaw = parsed.featureName
    ?? await input({
      message: 'Feature name:',
      validate: (value) => {
        const result = validateFeatureName(value);
        return result.ok ? true : result.error;
      },
    });

  const singularResult = validateFeatureName(String(singularRaw));
  if (!singularResult.ok) {
    throw new Error(singularResult.error);
  }

  const suggestedPlural = suggestPlural(singularResult.name, parsed.plural);
  const pluralRaw = parsed.plural
    ?? await input({
      message: 'Plural name:',
      default: suggestedPlural,
      validate: (value) => {
        const result = validateFeatureName(value);
        return result.ok ? true : result.error;
      },
    });

  const mode = parsed.mode
    ?? await select({
      message: 'Generate:',
      choices: [
        { name: 'Full Stack', value: 'fullstack', disabled: !project.hasBackend || !project.hasFrontend },
        { name: 'Backend Only', value: 'backend', disabled: !project.hasBackend },
        { name: 'Frontend Only', value: 'frontend', disabled: !project.hasFrontend },
      ].filter((choice) => !choice.disabled),
    });

  const featureType = parsed.featureType
    ?? await select({
      message: 'Feature type:',
      choices: [
        { name: 'CRUD Entity', value: 'crud' },
        { name: 'Read Only', value: 'readonly' },
      ],
    });

  let surface = parsed.surface ?? 'dashboard';
  if (mode !== 'backend' && !parsed.surface) {
    surface = await select({
      message: 'Frontend surface:',
      choices: [
        { name: 'Dashboard', value: 'dashboard' },
        { name: 'Public', value: 'public' },
        { name: 'Both', value: 'both' },
      ],
    });
  }

  const fields = parsed.fields?.length
    ? parsed.fields
    : await promptFields(normalizeExistingFeatures(existingFeatures));

  const operations = { ...parsed.operations };
  if (!parsed.yes) {
    const enabled = await checkbox({
      message: 'Enable:',
      choices: [
        { name: 'Search', value: 'search', checked: operations.search !== false },
        { name: 'Pagination', value: 'pagination', checked: operations.pagination !== false },
        { name: 'Create', value: 'create', checked: featureType === 'crud' && operations.create !== false },
        { name: 'Update', value: 'update', checked: featureType === 'crud' && operations.update !== false },
        { name: 'Delete', value: 'delete', checked: featureType === 'crud' && operations.delete !== false },
        { name: 'Restore', value: 'restore', checked: featureType === 'crud' && operations.restore !== false },
      ],
    });

    for (const key of ['search', 'pagination', 'create', 'update', 'delete', 'restore']) {
      operations[key] = enabled.includes(key);
    }
  }

  const labels = {
    enSingular: parsed.labels?.enSingular
      ?? await input({ message: 'English singular label:', default: singularResult.name }),
    enPlural: parsed.labels?.enPlural
      ?? await input({ message: 'English plural label:', default: String(pluralRaw) }),
    arSingular: parsed.labels?.arSingular
      ?? ((await input({ message: 'Arabic singular label (optional):', default: '' })) || null),
    arPlural: parsed.labels?.arPlural
      ?? ((await input({ message: 'Arabic plural label (optional):', default: '' })) || null),
  };

  let generatePermissions = Boolean(parsed.generatePermissions);
  let localizeContent = Boolean(parsed.localizeContent);

  if (!parsed.yes && project.modules) {
    if (project.modules.permissions && parsed.generatePermissions === undefined) {
      generatePermissions = await confirm({
        message: 'Generate permissions for this feature?',
        default: true,
      });
    }
    if (project.modules.localization && parsed.localizeContent === undefined) {
      localizeContent = await confirm({
        message: 'Localize entity content?',
        default: false,
      });
    }
  }

  if (!parsed.yes) {
    const proceed = await confirm({
      message: 'Generate feature?',
      default: true,
    });
    if (!proceed) {
      return null;
    }
  }

  return {
    singularName: singularResult.name,
    pluralName: String(pluralRaw),
    mode,
    surface,
    featureType,
    fields,
    operations,
    labels,
    dryRun: Boolean(parsed.dryRun),
    migration: Boolean(parsed.migration),
    force: Boolean(parsed.force),
    generatePermissions,
    localizeContent,
  };
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {{ hasBackend: boolean, hasFrontend: boolean }} project
 */
function buildFromFlags(parsed, project) {
  let mode = parsed.mode ?? 'fullstack';
  if (mode === 'fullstack' && (!project.hasBackend || !project.hasFrontend)) {
    if (project.hasBackend && !project.hasFrontend) {
      mode = 'backend';
    } else if (!project.hasBackend && project.hasFrontend) {
      mode = 'frontend';
    }
  }

  return {
    singularName: parsed.featureName,
    pluralName: parsed.plural,
    mode,
    surface: parsed.surface ?? 'dashboard',
    featureType: parsed.featureType ?? 'crud',
    fields: parsed.fields,
    operations: parsed.operations,
    labels: parsed.labels ?? {},
    dryRun: Boolean(parsed.dryRun),
    migration: Boolean(parsed.migration),
    force: Boolean(parsed.force),
    generatePermissions: parsed.generatePermissions !== false,
    localizeContent: Boolean(parsed.localizeContent),
  };
}

/**
 * Normalize the caller-supplied list of existing features into plain names,
 * usable as relationship targets.
 * @param {Array<string | { singularName?: string, name?: string }>} existingFeatures
 * @returns {string[]}
 */
function normalizeExistingFeatures(existingFeatures) {
  if (!Array.isArray(existingFeatures)) {
    return [];
  }

  /** @type {string[]} */
  const names = [];
  for (const entry of existingFeatures) {
    if (typeof entry === 'string' && entry.trim()) {
      names.push(entry.trim());
    } else if (entry && typeof entry === 'object') {
      const candidate = entry.singularName ?? entry.name;
      if (candidate) {
        names.push(String(candidate));
      }
    }
  }
  return names;
}

/**
 * @param {string[]} existingFeatures
 */
async function promptFields(existingFeatures = []) {
  /** @type {object[]} */
  const fields = [];

  while (true) {
    const nameRaw = await input({
      message: 'Field name:',
      validate: (value) => {
        const result = validateFieldName(value);
        if (!result.ok) {
          return result.error;
        }
        if (fields.some((field) => field.name === result.name)) {
          return `Field "${result.name}" already added.`;
        }
        return true;
      },
    });

    const nameResult = validateFieldName(nameRaw);

    const kind = await select({
      message: 'Field type:',
      choices: [
        { name: 'Scalar (string, number, date, ...)', value: 'scalar' },
        { name: 'Enum', value: 'enum' },
        { name: 'Relationship', value: 'relationship' },
        { name: 'File', value: 'file' },
        { name: 'Image', value: 'image' },
      ],
    });

    /** @type {Record<string, unknown>} */
    let fieldInput;
    if (kind === 'scalar') {
      fieldInput = await promptScalarField(nameResult.name);
    } else if (kind === 'enum') {
      fieldInput = await promptEnumField(nameResult.name);
    } else if (kind === 'relationship') {
      fieldInput = await promptRelationshipField(nameResult.name, existingFeatures);
    } else {
      fieldInput = await promptMediaField(nameResult.name, kind);
    }

    fields.push(normalizeField(fieldInput));

    const another = await confirm({ message: 'Add another field?', default: true });
    if (!another) {
      break;
    }
  }

  return fields;
}

/**
 * @param {string} name
 */
async function promptScalarField(name) {
  const type = await select({
    message: 'Scalar type:',
    choices: FIELD_TYPES.map((value) => ({ name: value, value })),
  });

  const required = await confirm({ message: 'Required?', default: true });

  /** @type {Record<string, unknown>} */
  const fieldInput = {
    name,
    kind: 'scalar',
    type,
    required,
    nullable: !required,
  };

  if (type === 'string') {
    const maxLengthRaw = await input({ message: 'Max length:', default: '200' });
    fieldInput.maxLength = Number.parseInt(maxLengthRaw, 10) || 200;
    const minLengthRaw = await input({ message: 'Min length (optional):', default: '' });
    if (minLengthRaw.trim()) {
      fieldInput.minLength = Number.parseInt(minLengthRaw, 10);
    }
  }

  if (type === 'decimal') {
    const precisionRaw = await input({ message: 'Precision:', default: '18' });
    const scaleRaw = await input({ message: 'Scale:', default: '2' });
    fieldInput.precision = Number.parseInt(precisionRaw, 10) || 18;
    fieldInput.scale = Number.parseInt(scaleRaw, 10) || 2;
    const minRaw = await input({ message: 'Minimum (optional):', default: '0' });
    if (minRaw.trim()) {
      fieldInput.minimum = Number(minRaw);
    }
  }

  if (type === 'int' || type === 'long' || type === 'double') {
    const minRaw = await input({ message: 'Minimum (optional):', default: '' });
    const maxRaw = await input({ message: 'Maximum (optional):', default: '' });
    if (minRaw.trim()) {
      fieldInput.minimum = Number(minRaw);
    }
    if (maxRaw.trim()) {
      fieldInput.maximum = Number(maxRaw);
    }
  }

  return fieldInput;
}

/**
 * @param {string} name
 */
async function promptEnumField(name) {
  const enumName = await input({
    message: 'Enum type name:',
    default: name,
    validate: (value) => {
      const result = validateFieldName(value);
      return result.ok ? true : result.error;
    },
  });

  const valuesRaw = await input({
    message: 'Enum values (pipe or comma separated):',
    validate: (value) => {
      const parsed = splitEnumValues(value);
      return parsed.length > 0 ? true : 'Provide at least one enum value.';
    },
  });

  const required = await confirm({ message: 'Required?', default: true });

  return {
    name,
    kind: 'enum',
    enumName: enumName.trim(),
    enumValues: splitEnumValues(valuesRaw),
    required,
    nullable: !required,
  };
}

/**
 * @param {string} value
 */
function splitEnumValues(value) {
  return String(value ?? '')
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * @param {string} name
 * @param {string[]} existingFeatures
 */
async function promptRelationshipField(name, existingFeatures) {
  const target =
    existingFeatures.length > 0
      ? await select({
          message: 'Target entity:',
          choices: [
            ...existingFeatures.map((value) => ({ name: value, value })),
            { name: 'Other (type manually)', value: '__manual__' },
          ],
        })
      : '__manual__';

  const resolvedTarget =
    target === '__manual__'
      ? await input({
          message: 'Target entity name:',
          validate: (value) => {
            const result = validateFeatureName(value);
            return result.ok ? true : result.error;
          },
        })
      : target;

  const relationshipType = await select({
    message: 'Relationship type:',
    choices: [
      { name: 'Many-to-one', value: 'many-to-one' },
      { name: 'One-to-many', value: 'one-to-many' },
      { name: 'Many-to-many', value: 'many-to-many' },
      { name: 'One-to-one', value: 'one-to-one' },
    ],
  });

  const display = await input({
    message: 'Display member (for lookups):',
    default: 'Name',
    validate: (value) => {
      const result = validateFieldName(value);
      return result.ok ? true : result.error;
    },
  });

  /** @type {Record<string, unknown>} */
  const fieldInput = {
    name,
    kind: 'relationship',
    target: String(resolvedTarget).trim(),
    relationshipType,
    display: display.trim(),
  };

  const isToOne =
    relationshipType === 'many-to-one' || relationshipType === 'one-to-one';

  if (isToOne) {
    const required = await confirm({ message: 'Required?', default: true });
    fieldInput.required = required;
    fieldInput.nullable = !required;

    fieldInput.deleteBehavior = await select({
      message: 'On delete:',
      choices: [
        { name: 'Restrict', value: 'restrict' },
        { name: 'Cascade', value: 'cascade' },
        { name: 'Set null', value: 'set-null' },
        { name: 'No action', value: 'no-action' },
      ],
      default: 'restrict',
    });
  } else {
    fieldInput.deleteBehavior = await select({
      message: 'On delete:',
      choices: [
        { name: 'Restrict', value: 'restrict' },
        { name: 'Cascade', value: 'cascade' },
        { name: 'No action', value: 'no-action' },
      ],
      default: relationshipType === 'one-to-many' ? 'cascade' : 'restrict',
    });
  }

  return fieldInput;
}

/**
 * @param {string} name
 * @param {'file' | 'image'} kind
 */
async function promptMediaField(name, kind) {
  const cardinality = await select({
    message: 'Cardinality:',
    choices: [
      { name: 'Single', value: 'single' },
      { name: 'Multiple', value: 'multiple' },
    ],
  });

  /** @type {Record<string, unknown>} */
  const fieldInput = {
    name,
    kind,
    cardinality,
  };

  if (cardinality === 'single') {
    const required = await confirm({ message: 'Required?', default: false });
    fieldInput.required = required;
    fieldInput.nullable = !required;

    const maxSizeRaw = await input({
      message: 'Max size in bytes (optional):',
      default: '',
    });
    if (maxSizeRaw.trim()) {
      fieldInput.maxSize = Number.parseInt(maxSizeRaw, 10);
    }
  } else {
    const maxFilesRaw = await input({
      message: 'Max number of files (optional):',
      default: '',
    });
    if (maxFilesRaw.trim()) {
      fieldInput.maxFiles = Number.parseInt(maxFilesRaw, 10);
    }

    const maxSizeRaw = await input({
      message: 'Max size per file in bytes (optional):',
      default: '',
    });
    if (maxSizeRaw.trim()) {
      fieldInput.maxSize = Number.parseInt(maxSizeRaw, 10);
    }
  }

  return fieldInput;
}
