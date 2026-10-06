import { isScalarType, normalizeField, FIELD_KINDS } from './field-types.js';
import { normalizeRelationshipType, validateDeleteBehavior } from './relationship.js';
import { validateFieldName } from '../utils/safe-generation.js';

const BANNED = /\b(eval|Function|require|import|process|child_process|constructor|prototype|__proto__)\b/i;

/**
 * Parse a --field / --add-field / --add-relationship definition.
 *
 * V2 (scalar):
 *   "Name:string:required:max=200"
 * V3 (kinds):
 *   "Category:relationship:target=Category:type=many-to-one:required:display=Name:delete=restrict"
 *   "Status:enum:name=ProductStatus:values=Draft|Active|Archived:required"
 *   "CoverImage:image:single:max-size=5242880"
 *   "Gallery:image:multiple:max-files=8"
 *   "Tags:relationship:target=Tag:type=many-to-many:display=Name"
 *
 * @param {string} raw
 */
export function parseFieldFlag(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Field definition cannot be empty.');
  }

  if (BANNED.test(raw)) {
    throw new Error('Field definition contains disallowed tokens.');
  }

  const parts = raw
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    throw new Error(`Invalid field definition "${raw}". Expected Name:type[:options].`);
  }

  const nameResult = validateFieldName(parts[0]);
  if (!nameResult.ok) {
    throw new Error(nameResult.error);
  }

  const discriminator = parts[1];
  const tokens = parts.slice(2);

  if (discriminator === 'enum') {
    return parseEnumField(nameResult.name, tokens, raw);
  }

  if (discriminator === 'relationship') {
    return parseRelationshipField(nameResult.name, tokens, raw);
  }

  if (discriminator === 'file' || discriminator === 'image') {
    return parseMediaField(nameResult.name, discriminator, tokens, raw);
  }

  if (discriminator === 'richText' || discriminator === 'richtext') {
    return normalizeField({
      name: nameResult.name,
      kind: 'scalar',
      type: 'string',
      richText: true,
      required: !tokens.includes('optional'),
      max: 200000,
      searchable: false,
    });
  }

  if (isScalarType(discriminator)) {
    return parseScalarField(nameResult.name, discriminator, tokens, raw);
  }

  throw new Error(
    `Unsupported field type "${discriminator}" in "${raw}". Expected a scalar type, richText, or one of: ${FIELD_KINDS.filter((kind) => kind !== 'scalar').join(', ')}.`,
  );
}

/**
 * @param {string} name
 * @param {string} type
 * @param {string[]} tokens
 * @param {string} raw
 */
function parseScalarField(name, type, tokens, raw) {
  /** @type {Record<string, unknown>} */
  const options = {
    name,
    kind: 'scalar',
    type,
    required: true,
    nullable: false,
  };

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower === 'required') {
      options.required = true;
      options.nullable = false;
      continue;
    }

    if (lower === 'optional' || lower === 'nullable') {
      options.required = false;
      options.nullable = true;
      continue;
    }

    const { key, value } = splitOption(token, raw);

    if (key === 'max' || key === 'maxlength') {
      options.maxLength = parseIntStrict(value, 'max');
      continue;
    }

    if (key === 'min' || key === 'minlength') {
      if (type === 'string') {
        options.minLength = parseIntStrict(value, 'min');
      } else {
        options.minimum = parseNumberStrict(value, 'min');
      }
      continue;
    }

    if (key === 'minimum') {
      options.minimum = parseNumberStrict(value, 'minimum');
      continue;
    }

    if (key === 'maximum') {
      options.maximum = parseNumberStrict(value, 'maximum');
      continue;
    }

    if (key === 'precision') {
      options.precision = parseIntStrict(value, 'precision');
      continue;
    }

    if (key === 'scale') {
      options.scale = parseIntStrict(value, 'scale');
      continue;
    }

    throw new Error(`Unknown field option "${key}" in "${raw}".`);
  }

  return normalizeField(options);
}

/**
 * @param {string} name
 * @param {string[]} tokens
 * @param {string} raw
 */
function parseEnumField(name, tokens, raw) {
  /** @type {Record<string, unknown>} */
  const options = {
    name,
    kind: 'enum',
    enumName: name,
    enumValues: [],
    required: true,
    nullable: false,
  };

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower === 'required') {
      options.required = true;
      options.nullable = false;
      continue;
    }

    if (lower === 'optional' || lower === 'nullable') {
      options.required = false;
      options.nullable = true;
      continue;
    }

    const { key, value } = splitOption(token, raw);

    if (key === 'name') {
      options.enumName = value;
      continue;
    }

    if (key === 'values') {
      options.enumValues = value
        .split('|')
        .map((entry) => entry.trim())
        .filter(Boolean);
      continue;
    }

    throw new Error(`Unknown enum option "${key}" in "${raw}".`);
  }

  return normalizeField(options);
}

/**
 * @param {string} name
 * @param {string[]} tokens
 * @param {string} raw
 */
function parseRelationshipField(name, tokens, raw) {
  /** @type {Record<string, unknown>} */
  const options = {
    name,
    kind: 'relationship',
    required: true,
    nullable: false,
  };

  let explicitRequired = false;

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower === 'required') {
      options.required = true;
      options.nullable = false;
      explicitRequired = true;
      continue;
    }

    if (lower === 'optional' || lower === 'nullable') {
      options.required = false;
      options.nullable = true;
      explicitRequired = true;
      continue;
    }

    const { key, value } = splitOption(token, raw);

    if (key === 'target') {
      options.target = value;
      continue;
    }

    if (key === 'type') {
      options.relationshipType = normalizeRelationshipType(value);
      continue;
    }

    if (key === 'display') {
      options.display = value;
      continue;
    }

    if (key === 'delete' || key === 'ondelete' || key === 'delete-behavior') {
      options.deleteBehavior = validateDeleteBehavior(value);
      continue;
    }

    throw new Error(`Unknown relationship option "${key}" in "${raw}".`);
  }

  if (!options.target) {
    throw new Error(`Relationship "${name}" requires target=<Entity> in "${raw}".`);
  }

  if (!options.relationshipType) {
    throw new Error(`Relationship "${name}" requires type=<relationship-type> in "${raw}".`);
  }

  if (!explicitRequired) {
    delete options.required;
    delete options.nullable;
  }

  return normalizeField(options);
}

/**
 * @param {string} name
 * @param {'file' | 'image'} kind
 * @param {string[]} tokens
 * @param {string} raw
 */
function parseMediaField(name, kind, tokens, raw) {
  /** @type {Record<string, unknown>} */
  const options = {
    name,
    kind,
    cardinality: 'single',
    required: false,
    nullable: true,
  };

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower === 'single') {
      options.cardinality = 'single';
      continue;
    }

    if (lower === 'multiple') {
      options.cardinality = 'multiple';
      continue;
    }

    if (lower === 'required') {
      options.required = true;
      options.nullable = false;
      continue;
    }

    if (lower === 'optional' || lower === 'nullable') {
      options.required = false;
      options.nullable = true;
      continue;
    }

    const { key, value } = splitOption(token, raw);

    if (key === 'max-size' || key === 'maxsize') {
      options.maxSize = parseIntStrict(value, 'max-size');
      continue;
    }

    if (key === 'max-files' || key === 'maxfiles') {
      options.maxFiles = parseIntStrict(value, 'max-files');
      continue;
    }

    throw new Error(`Unknown ${kind} option "${key}" in "${raw}".`);
  }

  return normalizeField(options);
}

/**
 * @param {string} token
 * @param {string} raw
 */
function splitOption(token, raw) {
  const eq = token.indexOf('=');
  if (eq === -1) {
    throw new Error(`Unknown field option "${token}" in "${raw}".`);
  }
  return {
    key: token.slice(0, eq).toLowerCase(),
    value: token.slice(eq + 1),
  };
}

/**
 * @param {string} value
 * @param {string} label
 */
function parseIntStrict(value, label) {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Invalid integer for ${label}: ${value}`);
  }

  return Number.parseInt(value, 10);
}

/**
 * @param {string} value
 * @param {string} label
 */
function parseNumberStrict(value, label) {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid number for ${label}: ${value}`);
  }

  return Number(value);
}

/**
 * Format a normalized field back into its canonical --field string representation.
 * @param {object} field
 * @returns {string}
 */
export function formatFieldFlag(field) {
  if (!field || typeof field !== 'object') {
    return '';
  }

  const req = field.required ? 'required' : 'optional';

  if (field.kind === 'enum') {
    const values = Array.isArray(field.enumValues) ? field.enumValues.join('|') : '';
    return `${field.name}:enum:name=${field.enumName ?? field.name}:values=${values}:${req}`;
  }

  if (field.kind === 'relationship') {
    const parts = [
      field.name,
      'relationship',
      `target=${field.target}`,
      `type=${field.relationshipType}`,
    ];
    if (field.required && field.relationshipType !== 'many-to-many' && field.relationshipType !== 'one-to-many') {
      parts.push('required');
    }
    if (field.display && field.display !== 'Name') {
      parts.push(`display=${field.display}`);
    } else {
      parts.push('display=Name');
    }
    if (field.deleteBehavior) {
      parts.push(`delete=${field.deleteBehavior.toLowerCase()}`);
    }
    return parts.join(':');
  }

  if (field.kind === 'file' || field.kind === 'image') {
    const parts = [
      field.name,
      field.kind,
      field.cardinality ?? 'single',
      req,
    ];
    if (field.maxSize != null) parts.push(`max-size=${field.maxSize}`);
    if (field.maxFiles != null) parts.push(`max-files=${field.maxFiles}`);
    return parts.join(':');
  }

  if (field.richText || field.type === 'richText' || field.type === 'richtext') {
    return `${field.name}:richText:${req}`;
  }

  // Scalar fields
  if (field.type === 'string') {
    const parts = [field.name, 'string', req];
    if (field.maxLength != null) parts.push(`max=${field.maxLength}`);
    if (field.minLength != null) parts.push(`min=${field.minLength}`);
    return parts.join(':');
  }

  if (field.type === 'decimal') {
    const parts = [field.name, 'decimal', req];
    if (field.precision != null && field.precision !== 18) parts.push(`precision=${field.precision}`);
    if (field.scale != null && field.scale !== 2) parts.push(`scale=${field.scale}`);
    if (field.minimum != null) parts.push(`min=${field.minimum}`);
    if (field.maximum != null) parts.push(`max=${field.maximum}`);
    return parts.join(':');
  }

  if (field.type === 'int' || field.type === 'long' || field.type === 'double') {
    const parts = [field.name, field.type, req];
    if (field.minimum != null) parts.push(`min=${field.minimum}`);
    if (field.maximum != null) parts.push(`max=${field.maximum}`);
    return parts.join(':');
  }

  return `${field.name}:${field.type}:${req}`;
}

