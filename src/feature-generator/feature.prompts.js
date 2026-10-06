import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { FIELD_TYPES, normalizeField } from './fields/field-types.js';
import { formatFieldFlag } from './fields/field-parser.js';
import { suggestPlural } from './feature.arguments.js';
import { validateFeatureName, validateFieldName } from './utils/safe-generation.js';
import { generateModule } from '../module-generator/module.generator.js';
import { logger } from '../utils/logger.js';

const RESERVED_FIELD_NAMES = new Set([
  'id',
  'createdatutc',
  'updatedatutc',
  'isdeleted',
  'rowversion',
]);

/**
 * Resolves feature generation options either from flags or via the interactive wizard.
 *
 * @param {Record<string, unknown>} parsed
 * @param {{ hasBackend: boolean, hasFrontend: boolean, architecture?: string, orm?: string, frontendStrategy?: object, modules?: object }} project
 * @param {Array<string | { singularName?: string, name?: string }>} [existingFeatures]
 */
export async function resolveFeatureOptions(parsed, project, existingFeatures = []) {
  if (parsed.yes && parsed.featureName && parsed.fields?.length) {
    return buildFromFlags(parsed, project);
  }

  // 1. Feature Name
  const singularRaw =
    parsed.featureName ??
    (await input({
      message: 'Feature name (e.g. Product, Order):',
      validate: (value) => {
        const result = validateFeatureName(value);
        return result.ok ? true : result.error;
      },
    }));

  const singularResult = validateFeatureName(String(singularRaw));
  if (!singularResult.ok) {
    throw new Error(singularResult.error);
  }

  // 2. Plural Name
  const suggestedPlural = suggestPlural(singularResult.name, parsed.plural);
  const pluralRaw =
    parsed.plural ??
    (await input({
      message: 'Plural name:',
      default: suggestedPlural,
      validate: (value) => {
        const result = validateFeatureName(value);
        return result.ok ? true : result.error;
      },
    }));

  // 3. Where should this feature be generated?
  const modeChoices = [
    {
      name: 'Both Backend + Frontend',
      value: 'fullstack',
      disabled: !project.hasBackend || !project.hasFrontend,
    },
    {
      name: 'Backend Only',
      value: 'backend',
      disabled: !project.hasBackend,
    },
    {
      name: 'Frontend Only',
      value: 'frontend',
      disabled: !project.hasFrontend,
    },
  ].filter((choice) => !choice.disabled);

  if (modeChoices.length === 0) {
    throw new Error('Project has neither backend nor frontend configured.');
  }

  const mode =
    parsed.mode ??
    (modeChoices.length === 1
      ? modeChoices[0].value
      : await select({
          message: 'Where should this feature be generated?',
          choices: modeChoices,
        }));

  // 4. Feature Type
  const featureType =
    parsed.featureType ??
    (await select({
      message: 'Feature type:',
      choices: [
        { name: 'CRUD Entity (Full Create, Read, Update, Delete)', value: 'crud' },
        { name: 'Read Only (Search, List, and Details only)', value: 'readonly' },
      ],
    }));

  // 5. Frontend Surface
  let surface = parsed.surface ?? 'dashboard';
  if (mode !== 'backend' && !parsed.surface) {
    surface = await select({
      message: 'Frontend surface:',
      choices: [
        { name: 'Dashboard (Management UI inside dashboard shell)', value: 'dashboard' },
        { name: 'Public (Public website catalog / landing)', value: 'public' },
        { name: 'Both (Dashboard management + Public catalog)', value: 'both' },
      ],
    });
  }

  // 6. Interactive Field Builder
  const normalizedEntities = normalizeExistingFeatures(existingFeatures);
  const fields = parsed.fields?.length
    ? parsed.fields
    : await promptFields(normalizedEntities, singularResult.name, project);

  // 7. Operations
  const operations = { ...parsed.operations };
  if (!parsed.yes) {
    const enabled = await checkbox({
      message: 'Enable API operations:',
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

  // 8. Labels
  const labels = {
    enSingular:
      parsed.labels?.enSingular ??
      (await input({ message: 'English singular label:', default: singularResult.name })),
    enPlural:
      parsed.labels?.enPlural ??
      (await input({ message: 'English plural label:', default: String(pluralRaw) })),
    arSingular:
      parsed.labels?.arSingular ??
      ((await input({ message: 'Arabic singular label (optional):', default: '' })) || null),
    arPlural:
      parsed.labels?.arPlural ??
      ((await input({ message: 'Arabic plural label (optional):', default: '' })) || null),
  };

  // 9. Module integrations (Permissions / Localization)
  let generatePermissions = Boolean(parsed.generatePermissions);
  let localizeContent = Boolean(parsed.localizeContent);

  if (!parsed.yes && project.modules) {
    if (project.modules.permissions && parsed.generatePermissions === undefined) {
      generatePermissions = await confirm({
        message: 'Generate authorization permissions for this feature?',
        default: true,
      });
    }
    if (project.modules.localization && parsed.localizeContent === undefined) {
      localizeContent = await confirm({
        message: 'Localize entity content fields?',
        default: false,
      });
    }
  }

  // 10. Feature Review & Confirmation
  if (!parsed.yes) {
    printFeatureReview({
      featureName: singularResult.name,
      pluralName: String(pluralRaw),
      mode,
      surface,
      featureType,
      fields,
      project,
    });

    const proceed = await confirm({
      message: `Generate ${singularResult.name} feature?`,
      default: true,
    });
    if (!proceed) {
      logger.info('Feature generation cancelled.');
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
 * Interactive field builder loop: adds, edits, summarizes, and removes fields.
 *
 * @param {string[]} existingFeatures
 * @param {string} singularName
 * @param {object} [project]
 * @returns {Promise<object[]>}
 */
async function promptFields(existingFeatures, singularName, project = null) {
  /** @type {object[]} */
  const fields = [];

  // First field prompt
  const addInitial = await confirm({
    message: `Add a field to ${singularName}?`,
    default: true,
  });

  if (addInitial) {
    const firstField = await promptSingleField(existingFeatures, fields, null, project);
    fields.push(normalizeField(firstField));
  }

  while (true) {
    printFieldsSummary(singularName, fields);

    const action = await select({
      message: 'Field action:',
      choices: [
        { name: 'Add another field', value: 'add' },
        ...(fields.length > 0 ? [{ name: 'Edit a field', value: 'edit' }] : []),
        ...(fields.length > 0 ? [{ name: 'Remove a field', value: 'remove' }] : []),
        { name: 'Finish fields', value: 'finish' },
      ],
    });

    if (action === 'finish') {
      if (fields.length === 0) {
        const confirmEmpty = await confirm({
          message: `No fields added to ${singularName}. Continue with Id and timestamps only?`,
          default: false,
        });
        if (confirmEmpty) {
          break;
        }
        continue;
      }
      break;
    }

    if (action === 'add') {
      const newField = await promptSingleField(existingFeatures, fields, null, project);
      fields.push(normalizeField(newField));
      continue;
    }

    if (action === 'edit') {
      const fieldNameToEdit = await select({
        message: 'Select field to edit:',
        choices: fields.map((f) => ({
          name: `${f.name.padEnd(16)} (${formatFieldDetails(f)})`,
          value: f.name,
        })),
      });

      const fieldIndex = fields.findIndex((f) => f.name === fieldNameToEdit);
      if (fieldIndex !== -1) {
        const currentField = fields[fieldIndex];
        const otherFields = fields.filter((_, idx) => idx !== fieldIndex);
        const updated = await promptSingleField(existingFeatures, otherFields, currentField, project);
        fields[fieldIndex] = normalizeField(updated);
      }
      continue;
    }

    if (action === 'remove') {
      const fieldNameToRemove = await select({
        message: 'Select field to remove:',
        choices: fields.map((f) => ({
          name: `${f.name.padEnd(16)} (${formatFieldDetails(f)})`,
          value: f.name,
        })),
      });

      const fieldIndex = fields.findIndex((f) => f.name === fieldNameToRemove);
      if (fieldIndex !== -1) {
        fields.splice(fieldIndex, 1);
        logger.info(`Removed field "${fieldNameToRemove}".`);
      }
      continue;
    }
  }

  return fields;
}

/**
 * Prompts user for a single field definition (new or edit).
 *
 * @param {string[]} existingFeatures
 * @param {object[]} currentFields
 * @param {object} [existingField]
 * @param {object} [project]
 */
async function promptSingleField(existingFeatures, currentFields, existingField = null, project = null) {
  const isEditing = Boolean(existingField);

  // Field Name
  const nameRaw = await input({
    message: 'Field name:',
    default: existingField ? existingField.name : undefined,
    validate: (value) => {
      const result = validateFieldName(value);
      if (!result.ok) {
        return result.error;
      }
      const lower = result.name.toLowerCase();
      if (RESERVED_FIELD_NAMES.has(lower)) {
        return `"${result.name}" is a reserved base entity property. Choose another name.`;
      }
      if (currentFields.some((f) => f.name.toLowerCase() === lower)) {
        return `Field "${result.name}" already exists on this feature.`;
      }
      return true;
    },
  });

  const nameResult = validateFieldName(nameRaw);
  const fieldName = nameResult.name;

  // Field Type
  const typeChoices = [
    { name: 'String           (text, names, codes, descriptions)', value: 'string' },
    { name: 'Integer          (32-bit whole number, count, rank)', value: 'int' },
    { name: 'Long             (64-bit integer, large numbers)', value: 'long' },
    { name: 'Decimal          (currency, price, exact financial values)', value: 'decimal' },
    { name: 'Double           (floating point, ratings, coordinates)', value: 'double' },
    { name: 'Boolean          (true / false flag)', value: 'boolean' },
    { name: 'Guid             (globally unique identifier)', value: 'Guid' },
    { name: 'DateTime         (date and timestamp)', value: 'DateTime' },
    { name: 'DateTimeOffset   (date and time with timezone offset)', value: 'DateTimeOffset' },
    { name: 'Enum             (named enumeration constants)', value: 'enum' },
    { name: 'Relationship     (association to another entity)', value: 'relationship' },
    { name: 'File             (file or document attachment)', value: 'file' },
    { name: 'Image            (photo or image upload)', value: 'image' },
    { name: 'Rich Text        (structured rich-text HTML/JSON)', value: 'richText' },
  ];

  const defaultType = existingField
    ? existingField.richText
      ? 'richText'
      : existingField.kind === 'scalar'
        ? existingField.type
        : existingField.kind
    : 'string';

  const selectedType = await select({
    message: 'Field type:',
    choices: typeChoices,
    default: defaultType,
  });

  if (selectedType === 'enum') {
    return promptEnumField(fieldName, existingField);
  }

  if (selectedType === 'relationship') {
    return promptRelationshipField(fieldName, existingFeatures, existingField);
  }

  if (selectedType === 'file' || selectedType === 'image') {
    return promptMediaField(fieldName, selectedType, existingField);
  }

  if (selectedType === 'richText') {
    if (project && project.hasFrontend && !project.modules?.richText) {
      logger.warn('Rich Text fields require the Flatron "rich-text" module for frontend rendering components.');
      const installNow = await confirm({
        message: 'The "rich-text" module is not installed. Would you like to install it now?',
        default: true,
      });
      if (installNow) {
        try {
          await generateModule({
            moduleName: 'rich-text',
            projectRoot: project.projectRoot,
            yes: true,
          });
          if (project.modules) {
            project.modules.richText = true;
          }
          logger.info('Installed "rich-text" module successfully.');
        } catch (err) {
          logger.warn(`Could not install rich-text module automatically: ${err.message}`);
          logger.warn('Please run: flatron create module rich-text');
        }
      } else {
        logger.warn('Proceeding without rich-text module. Remember to run "flatron create module rich-text" later.');
      }
    }

    const required = await confirm({
      message: 'Required?',
      default: existingField ? existingField.required : false,
    });
    return {
      name: fieldName,
      kind: 'scalar',
      type: 'string',
      richText: true,
      required,
      nullable: !required,
      maxLength: 200000,
    };
  }

  // Scalar field
  return promptScalarField(fieldName, selectedType, existingField);
}

/**
 * @param {string} name
 * @param {string} type
 * @param {object} [existing]
 */
async function promptScalarField(name, type, existing = null) {
  const required = await confirm({
    message: 'Required?',
    default: existing ? existing.required : true,
  });

  /** @type {Record<string, unknown>} */
  const fieldInput = {
    name,
    kind: 'scalar',
    type,
    required,
    nullable: type === 'boolean' ? false : !required,
  };

  if (type === 'string') {
    const maxLengthRaw = await input({
      message: 'Maximum length:',
      default: existing?.maxLength ? String(existing.maxLength) : '200',
      validate: (val) => (/^\d+$/.test(val.trim()) && Number(val) > 0 ? true : 'Enter a positive integer.'),
    });
    fieldInput.maxLength = Number.parseInt(maxLengthRaw.trim(), 10);

    const minLengthRaw = await input({
      message: 'Minimum length (optional):',
      default: existing?.minLength != null ? String(existing.minLength) : '',
      validate: (val) => {
        if (!val.trim()) return true;
        if (!/^\d+$/.test(val.trim())) return 'Enter a non-negative integer.';
        if (Number(val) > fieldInput.maxLength) return 'Min length cannot exceed max length.';
        return true;
      },
    });
    if (minLengthRaw.trim()) {
      fieldInput.minLength = Number.parseInt(minLengthRaw.trim(), 10);
    }
  }

  if (type === 'decimal') {
    const precisionRaw = await input({
      message: 'Precision (total digits):',
      default: existing?.precision ? String(existing.precision) : '18',
      validate: (val) => (/^\d+$/.test(val.trim()) && Number(val) > 0 ? true : 'Enter a positive integer.'),
    });
    const scaleRaw = await input({
      message: 'Scale (decimal places):',
      default: existing?.scale ? String(existing.scale) : '2',
      validate: (val) => (/^\d+$/.test(val.trim()) && Number(val) >= 0 ? true : 'Enter a non-negative integer.'),
    });
    fieldInput.precision = Number.parseInt(precisionRaw.trim(), 10);
    fieldInput.scale = Number.parseInt(scaleRaw.trim(), 10);

    const minRaw = await input({
      message: 'Minimum value (optional):',
      default: existing?.minimum != null ? String(existing.minimum) : '0',
      validate: (val) => (!val.trim() || !Number.isNaN(Number(val)) ? true : 'Enter a valid number or leave empty.'),
    });
    if (minRaw.trim()) {
      fieldInput.minimum = Number(minRaw.trim());
    }

    const maxRaw = await input({
      message: 'Maximum value (optional):',
      default: existing?.maximum != null ? String(existing.maximum) : '',
      validate: (val) => (!val.trim() || !Number.isNaN(Number(val)) ? true : 'Enter a valid number or leave empty.'),
    });
    if (maxRaw.trim()) {
      fieldInput.maximum = Number(maxRaw.trim());
    }
  }

  if (type === 'int' || type === 'long' || type === 'double') {
    const minRaw = await input({
      message: 'Minimum value (optional):',
      default: existing?.minimum != null ? String(existing.minimum) : '',
      validate: (val) => (!val.trim() || !Number.isNaN(Number(val)) ? true : 'Enter a valid number or leave empty.'),
    });
    if (minRaw.trim()) {
      fieldInput.minimum = Number(minRaw.trim());
    }

    const maxRaw = await input({
      message: 'Maximum value (optional):',
      default: existing?.maximum != null ? String(existing.maximum) : '',
      validate: (val) => (!val.trim() || !Number.isNaN(Number(val)) ? true : 'Enter a valid number or leave empty.'),
    });
    if (maxRaw.trim()) {
      fieldInput.maximum = Number(maxRaw.trim());
    }
  }

  return fieldInput;
}

/**
 * @param {string} name
 * @param {object} [existing]
 */
async function promptEnumField(name, existing = null) {
  const enumName = await input({
    message: 'Enum type name:',
    default: existing?.enumName ?? `${name}Status`,
    validate: (value) => {
      const result = validateFieldName(value);
      return result.ok ? true : result.error;
    },
  });

  const existingValues = existing?.enumValues ? existing.enumValues.join(', ') : 'Draft, Active, Archived';

  const valuesRaw = await input({
    message: 'Enum values (comma or pipe-separated, e.g. Draft, Active, Archived):',
    default: existingValues,
    validate: (value) => {
      const parsed = splitEnumValues(value);
      if (parsed.length === 0) return 'Provide at least one enum value.';
      for (const val of parsed) {
        if (!/^[A-Za-z_][A-Za-z0-9]*$/.test(val)) {
          return `Invalid enum value "${val}". Must be a valid identifier.`;
        }
      }
      const unique = new Set(parsed);
      if (unique.size !== parsed.length) return 'Enum values must be unique.';
      return true;
    },
  });

  const required = await confirm({
    message: 'Required?',
    default: existing ? existing.required : true,
  });

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
 * @param {object} [existing]
 */
async function promptRelationshipField(name, existingFeatures, existing = null) {
  const choices = [
    ...existingFeatures.map((value) => ({ name: value, value })),
    { name: 'Enter manually...', value: '__manual__' },
  ];

  const targetChoice =
    existing?.target && existingFeatures.includes(existing.target)
      ? existing.target
      : existingFeatures.length > 0
        ? await select({
            message: 'Related entity / feature:',
            choices,
            default: existing?.target ?? choices[0].value,
          })
        : '__manual__';

  const resolvedTarget =
    targetChoice === '__manual__'
      ? await input({
          message: 'Related entity name:',
          default: existing?.target ?? name,
          validate: (value) => {
            const result = validateFeatureName(value);
            return result.ok ? true : result.error;
          },
        })
      : targetChoice;

  const relationshipType = await select({
    message: 'Relationship type:',
    choices: [
      { name: 'Many to One   (e.g. Current entity belongs to Related entity)', value: 'many-to-one' },
      { name: 'Many to Many  (e.g. Current entity has many Related entities)', value: 'many-to-many' },
      { name: 'One to Many   (e.g. Current entity has many Related entities)', value: 'one-to-many' },
      { name: 'One to One    (e.g. Current entity has one Related entity)', value: 'one-to-one' },
    ],
    default: existing?.relationshipType ?? 'many-to-one',
  });

  const display = await input({
    message: 'Display member (property used in UI lookups/dropdowns):',
    default: existing?.display ?? 'Name',
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

  const isToOne = relationshipType === 'many-to-one' || relationshipType === 'one-to-one';

  if (isToOne) {
    const required = await confirm({
      message: 'Required relationship?',
      default: existing ? existing.required : true,
    });
    fieldInput.required = required;
    fieldInput.nullable = !required;

    fieldInput.deleteBehavior = await select({
      message: 'On delete behavior:',
      choices: [
        { name: 'Restrict  (Prevent deletion of related entity if referenced)', value: 'restrict' },
        { name: 'Cascade   (Delete this entity if related entity is deleted)', value: 'cascade' },
        { name: 'Set null  (Set reference to null if related entity is deleted)', value: 'set-null' },
        { name: 'No action (Do nothing, let database handle)', value: 'no-action' },
      ],
      default: existing?.deleteBehavior ? existing.deleteBehavior.toLowerCase() : 'restrict',
    });
  } else {
    fieldInput.deleteBehavior = await select({
      message: 'On delete behavior:',
      choices: [
        { name: 'Restrict  (Prevent deletion if references exist)', value: 'restrict' },
        { name: 'Cascade   (Delete join/child records automatically)', value: 'cascade' },
        { name: 'No action (Do nothing)', value: 'no-action' },
      ],
      default:
        existing?.deleteBehavior
          ? existing.deleteBehavior.toLowerCase()
          : relationshipType === 'one-to-many'
            ? 'cascade'
            : 'restrict',
    });
  }

  return fieldInput;
}

/**
 * @param {string} name
 * @param {'file' | 'image'} kind
 * @param {object} [existing]
 */
async function promptMediaField(name, kind, existing = null) {
  const cardinality = await select({
    message: 'Cardinality:',
    choices: [
      { name: 'Single    (one file/image upload)', value: 'single' },
      { name: 'Multiple  (gallery or collection of uploads)', value: 'multiple' },
    ],
    default: existing?.cardinality ?? 'single',
  });

  /** @type {Record<string, unknown>} */
  const fieldInput = {
    name,
    kind,
    cardinality,
  };

  if (cardinality === 'single') {
    const required = await confirm({
      message: 'Required?',
      default: existing ? existing.required : false,
    });
    fieldInput.required = required;
    fieldInput.nullable = !required;

    const maxSizeRaw = await input({
      message: 'Maximum size in bytes (optional, e.g. 5242880 for 5MB):',
      default: existing?.maxSize ? String(existing.maxSize) : '',
      validate: (val) => (!val.trim() || (/^\d+$/.test(val.trim()) && Number(val) > 0) ? true : 'Enter a positive integer or empty.'),
    });
    if (maxSizeRaw.trim()) {
      fieldInput.maxSize = Number.parseInt(maxSizeRaw.trim(), 10);
    }
  } else {
    const maxFilesRaw = await input({
      message: 'Maximum number of files (optional, e.g. 10):',
      default: existing?.maxFiles ? String(existing.maxFiles) : '',
      validate: (val) => (!val.trim() || (/^\d+$/.test(val.trim()) && Number(val) > 0) ? true : 'Enter a positive integer or empty.'),
    });
    if (maxFilesRaw.trim()) {
      fieldInput.maxFiles = Number.parseInt(maxFilesRaw.trim(), 10);
    }

    const maxSizeRaw = await input({
      message: 'Maximum size per file in bytes (optional):',
      default: existing?.maxSize ? String(existing.maxSize) : '',
      validate: (val) => (!val.trim() || (/^\d+$/.test(val.trim()) && Number(val) > 0) ? true : 'Enter a positive integer or empty.'),
    });
    if (maxSizeRaw.trim()) {
      fieldInput.maxSize = Number.parseInt(maxSizeRaw.trim(), 10);
    }
  }

  return fieldInput;
}

/**
 * Formats a single field's summary descriptor for review.
 * @param {object} field
 * @returns {string}
 */
function formatFieldDetails(field) {
  if (field.kind === 'enum') {
    return `enum ${field.enumName} [${field.enumValues?.join(', ')}] · ${field.required ? 'required' : 'optional'}`;
  }
  if (field.kind === 'relationship') {
    const isToMany = field.relationshipType === 'many-to-many' || field.relationshipType === 'one-to-many';
    const targetLabel = isToMany ? `${field.target}[]` : field.target;
    return `${targetLabel} · ${field.relationshipType} · display=${field.display ?? 'Name'}${field.required ? ' · required' : ''}`;
  }
  if (field.kind === 'file' || field.kind === 'image') {
    return `${field.kind} · ${field.cardinality} · ${field.required ? 'required' : 'optional'}`;
  }
  if (field.richText || field.type === 'richText') {
    return `rich-text · ${field.required ? 'required' : 'optional'}`;
  }
  if (field.type === 'string') {
    const details = ['string', field.required ? 'required' : 'optional'];
    if (field.maxLength) details.push(`max ${field.maxLength}`);
    if (field.minLength) details.push(`min ${field.minLength}`);
    return details.join(' · ');
  }
  if (field.type === 'decimal') {
    const details = ['decimal', field.required ? 'required' : 'optional'];
    if (field.minimum != null) details.push(`min ${field.minimum}`);
    if (field.maximum != null) details.push(`max ${field.maximum}`);
    return details.join(' · ');
  }
  if (field.type === 'int' || field.type === 'long' || field.type === 'double') {
    const details = [field.type, field.required ? 'required' : 'optional'];
    if (field.minimum != null) details.push(`min ${field.minimum}`);
    if (field.maximum != null) details.push(`max ${field.maximum}`);
    return details.join(' · ');
  }
  return `${field.type} · ${field.required ? 'required' : 'optional'}`;
}

/**
 * Prints a clean summary of current fields.
 * @param {string} singularName
 * @param {object[]} fields
 */
function printFieldsSummary(singularName, fields) {
  process.stdout.write(`\n==================================================\n`);
  process.stdout.write(`${singularName} Fields (${fields.length})\n`);
  process.stdout.write(`==================================================\n`);
  if (fields.length === 0) {
    process.stdout.write(`  (No custom fields added yet)\n`);
  } else {
    for (const field of fields) {
      process.stdout.write(`✓ ${field.name.padEnd(16)} ${formatFieldDetails(field)}\n`);
    }
  }
  process.stdout.write(`==================================================\n\n`);
}

/**
 * Prints final feature review and CLI command preview before confirmation.
 * @param {object} info
 */
function printFeatureReview(info) {
  const { featureName, pluralName, mode, surface, featureType, fields, project } = info;

  const modeLabel =
    mode === 'fullstack'
      ? 'Full Stack (Backend + Frontend)'
      : mode === 'backend'
        ? 'Backend Only'
        : 'Frontend Only';

  const arch = project.architecture ?? 'CQRS + MediatR';
  const orm = project.orm ?? 'EF Core';
  const fe = project.frontendStrategy?.library
    ? `${project.frontendStrategy.library === 'react' ? 'React' : 'Angular'} (${project.frontendStrategy.framework ?? 'Vite'})`
    : 'None';

  const cliFields = fields.map((f) => `  --field "${formatFieldFlag(f)}"`).join(' \\\n');
  const cliPreview = `flatron create feature ${featureName} --yes \\\n  --surface ${surface} \\\n${cliFields}`;

  process.stdout.write(`\n==================================================\n`);
  process.stdout.write(`Feature Review: ${featureName}\n`);
  process.stdout.write(`==================================================\n`);
  process.stdout.write(`Feature:       ${featureName} (Plural: ${pluralName})\n`);
  process.stdout.write(`Surface:       ${modeLabel} [${surface}]\n`);
  process.stdout.write(`Type:          ${featureType === 'crud' ? 'CRUD Entity' : 'Read Only'}\n`);
  process.stdout.write(`Architecture:  ${arch}\n`);
  process.stdout.write(`ORM:           ${orm}\n`);
  process.stdout.write(`Frontend:      ${fe}\n\n`);

  process.stdout.write(`Fields:\n`);
  if (fields.length === 0) {
    process.stdout.write(`  (No custom fields)\n`);
  } else {
    for (const f of fields) {
      process.stdout.write(`  • ${f.name.padEnd(14)} ${formatFieldDetails(f)}\n`);
    }
  }

  process.stdout.write(`\nEquivalent CLI Command:\n`);
  process.stdout.write(`${cliPreview}\n`);
  process.stdout.write(`==================================================\n\n`);
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
  return Array.from(new Set(names)).sort();
}
