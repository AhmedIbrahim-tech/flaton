import { FIELD_TYPES } from './fields/field-types.js';
import { parseFieldFlag } from './fields/field-parser.js';
import { deriveFeatureNames } from './utils/feature-naming.js';
import { readPackageMeta } from '../cli/arguments.js';

/**
 * Feature generator schema version. Bumped to 4.0.0 for V4 module integration
 * (permissions, domain localization, richText fields).
 */
export const FEATURE_GENERATOR_VERSION = '4.0.0';

/**
 * @param {string[]} argv
 */
export function parseFeatureArguments(argv) {
  const args = argv.slice(2);

  /** @type {Record<string, unknown>} */
  const options = {
    featureName: undefined,
    plural: undefined,
    mode: undefined,
    surface: undefined,
    featureType: undefined,
    fields: [],
    operations: {
      search: true,
      pagination: true,
      create: true,
      update: true,
      delete: true,
      restore: true,
    },
    labels: {},
    dryRun: false,
    migration: false,
    force: false,
    list: false,
    help: false,
    version: false,
    yes: false,
    generatePermissions: undefined,
    localizeContent: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--version' || arg === '-v') {
      options.version = true;
      continue;
    }

    if (arg === '--list') {
      options.list = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--migration') {
      options.migration = true;
      continue;
    }

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--yes' || arg === '-y') {
      options.yes = true;
      continue;
    }

    if (arg === '--permissions') {
      options.generatePermissions = true;
      continue;
    }

    if (arg === '--no-permissions') {
      options.generatePermissions = false;
      continue;
    }

    if (arg === '--localize') {
      options.localizeContent = true;
      continue;
    }

    if (arg === '--plural') {
      options.plural = requireValue(args, index, '--plural');
      index += 1;
      continue;
    }

    if (arg === '--fullstack') {
      options.mode = 'fullstack';
      continue;
    }

    if (arg === '--backend-only') {
      options.mode = 'backend';
      continue;
    }

    if (arg === '--frontend-only') {
      options.mode = 'frontend';
      continue;
    }

    if (arg === '--surface') {
      const value = requireValue(args, index, '--surface');
      if (!['dashboard', 'public', 'both'].includes(value)) {
        throw new Error('Invalid --surface. Use dashboard, public, or both.');
      }
      options.surface = value;
      index += 1;
      continue;
    }

    if (arg === '--type') {
      const value = requireValue(args, index, '--type');
      if (!['crud', 'readonly'].includes(value)) {
        throw new Error('Invalid --type. Use crud or readonly.');
      }
      options.featureType = value;
      index += 1;
      continue;
    }

    if (arg === '--field' || arg === '--add-field') {
      const value = requireValue(args, index, arg);
      options.fields.push(parseFieldFlag(value));
      index += 1;
      continue;
    }

    if (arg === '--add-relationship') {
      const value = requireValue(args, index, '--add-relationship');
      options.fields.push(parseFieldFlag(ensureRelationshipDefinition(value)));
      index += 1;
      continue;
    }

    if (arg === '--no-search') {
      options.operations.search = false;
      continue;
    }

    if (arg === '--no-pagination') {
      options.operations.pagination = false;
      continue;
    }

    if (arg === '--no-create') {
      options.operations.create = false;
      continue;
    }

    if (arg === '--no-update') {
      options.operations.update = false;
      continue;
    }

    if (arg === '--no-delete') {
      options.operations.delete = false;
      continue;
    }

    if (arg === '--no-restore') {
      options.operations.restore = false;
      continue;
    }

    if (arg === '--label-en-singular') {
      options.labels.enSingular = requireValue(args, index, '--label-en-singular');
      index += 1;
      continue;
    }

    if (arg === '--label-en-plural') {
      options.labels.enPlural = requireValue(args, index, '--label-en-plural');
      index += 1;
      continue;
    }

    if (arg === '--label-ar-singular') {
      options.labels.arSingular = requireValue(args, index, '--label-ar-singular');
      index += 1;
      continue;
    }

    if (arg === '--label-ar-plural') {
      options.labels.arPlural = requireValue(args, index, '--label-ar-plural');
      index += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}. Use --help to see supported flags.`);
    }

    if (options.featureName) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }

    options.featureName = arg;
  }

  return options;
}

/**
 * Ensure a --add-relationship value carries the `relationship` discriminator so
 * users can write either the full syntax or a shorthand without it.
 *   "Category:target=Category:type=many-to-one"  ->
 *   "Category:relationship:target=Category:type=many-to-one"
 * @param {string} value
 */
function ensureRelationshipDefinition(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Relationship definition cannot be empty.');
  }

  const parts = value.split(':');
  if (parts.length >= 2 && parts[1].trim().toLowerCase() === 'relationship') {
    return value;
  }

  const [name, ...rest] = parts;
  return [name, 'relationship', ...rest].join(':');
}

/**
 * @param {string[]} args
 * @param {number} index
 * @param {string} flag
 */
function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

export function printFeatureHelp() {
  const pkg = readPackageMeta();
  const text = `
${pkg.name} feature generator v${FEATURE_GENERATOR_VERSION}

Usage:
  flatron create feature <name> [options]
  create-fullstack-feature <name> [options]

Running without field definitions starts the interactive Feature Builder.

Options:
  -h, --help                 Show help
  -v, --version              Show version
  --list                     List features from .fullstack-app.json
  --dry-run                  Print the generation plan without writing files
  --migration                Generate an EF migration after feature creation
  --force                    Overwrite existing feature files (use with care)
  -y, --yes                  Skip confirmation prompts
  --plural <name>            Override plural name
  --fullstack                Generate backend + frontend (default)
  --backend-only             Generate backend only
  --frontend-only            Generate frontend only
  --surface <surface>        dashboard | public | both
  --type <type>              crud | readonly
  --field <definition>       Add a field (can be repeated)
  --add-relationship <def>   Add a relationship field (shorthand)
  --permissions              Register feature permissions when permissions module is enabled
  --localize                 Generate domain translation scaffolding when localization module is enabled

Field syntax:
  Scalar:
    "Name:string:required:max=200"
    "Price:decimal:required:min=0"
    "IsActive:boolean:required"
  Enum:
    "Status:enum:name=ProductStatus:values=Draft|Active|Archived:required"
  Relationship:
    "Category:relationship:target=Category:type=many-to-one:required:display=Name"
    "Tags:relationship:target=Tag:type=many-to-many:display=Name"
  File / Image:
    "CoverImage:image:single:max-size=5242880"
    "Gallery:image:multiple:max-files=8"
    "Attachment:file:single:max-size=10485760"
  Rich text:
    "Content:richText:required"

Relationship types: many-to-one, one-to-many, many-to-many, one-to-one
Delete behaviors:   restrict (default), cascade, set-null, no-action

Supported scalar types: ${FIELD_TYPES.join(', ')}

Examples:
  flatron create feature Product
  flatron create feature Product --yes --fullstack --surface dashboard \\
    --field "Name:string:required:max=200" \\
    --field "Price:decimal:required:min=0" \\
    --field "Status:enum:name=ProductStatus:values=Draft|Active|Archived:required" \\
    --add-relationship "Category:target=Category:type=many-to-one:required:display=Name"
  flatron create feature Category --dry-run
  create-fullstack-feature Product
`.trim();

  process.stdout.write(`${text}\n`);
}

export function printFeatureVersion() {
  process.stdout.write(`${FEATURE_GENERATOR_VERSION}\n`);
}

/**
 * @param {string} singular
 * @param {string} [plural]
 */
export function suggestPlural(singular, plural) {
  return deriveFeatureNames(singular, plural).pluralName;
}
