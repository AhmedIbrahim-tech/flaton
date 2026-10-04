import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackageManager } from '../utils/validation.js';
import { validateAndNormalizeOption, validateBooleanConflicts } from './validate-options.js';

const PACKAGE_JSON_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));

export function readPackageMeta() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}

export function getBinCommandName() {
  const pkg = readPackageMeta();
  const bin = pkg.bin ?? {};
  return Object.keys(bin)[0] ?? pkg.name;
}

const BOOLEAN_FLAGS = {
  '--backend': ['backend', true],
  '--no-backend': ['backend', false],
  '--fullstack': ['mode', 'fullstack'],
  '--backend-only': ['mode', 'backend-only'],
  '--frontend-only': ['mode', 'frontend-only'],
  '--recommended': ['setupMode', 'recommended'],
  '--customize': ['setupMode', 'customize'],
  '--custom': ['setupMode', 'customize'],
  '--use-saved-preferences': ['useSavedPreferences', true],
  '--save-defaults': ['saveDefaults', true],
  '--no-save-defaults': ['saveDefaults', false],
  '--no-frontend': ['frontendEnabled', false],
  '--signalr': ['signalr', true],
  '--no-signalr': ['signalr', false],
  '--hangfire': ['hangfire', true],
  '--no-hangfire': ['hangfire', false],
  '--sql-server': ['sqlServer', true],
  '--no-sql-server': ['sqlServer', false],
  '--auth': ['authFlag', true],
  '--no-auth': ['authFlag', false],
  '--localization': ['localization', true],
  '--no-localization': ['localization', false],
  '--swagger': ['swagger', true],
  '--no-swagger': ['swagger', false],
  '--fluent-validation': ['fluentValidation', true],
  '--no-fluent-validation': ['fluentValidation', false],
  '--global-usings': ['globalUsings', true],
  '--no-global-usings': ['globalUsings', false],
  '--health-checks': ['healthChecks', true],
  '--no-health-checks': ['healthChecks', false],
  '--dashboard': ['dashboard', true],
  '--no-dashboard': ['dashboard', false],
  '--users': ['users', true],
  '--no-users': ['users', false],
  '--permissions': ['permissions', true],
  '--no-permissions': ['permissions', false],
  '--audit': ['audit', true],
  '--no-audit': ['audit', false],
  '--notifications': ['notifications', true],
  '--no-notifications': ['notifications', false],
  '--domain-localization': ['domainLocalization', true],
  '--no-domain-localization': ['domainLocalization', false],
  '--rich-text': ['richText', true],
  '--no-rich-text': ['richText', false],
  '--verbose': ['verbose', true],
};

/**
 * @param {string[]} argv
 */
export function parseArguments(argv) {
  const args = argv.slice(2);
  /** @type {Record<string, boolean>} */
  const explicitBooleans = {};

  /** @type {Record<string, unknown>} */
  const options = {
    projectName: undefined,
    output: process.cwd(),
    yes: false,
    verbose: false,
    mode: undefined, // 'fullstack' | 'backend-only' | 'frontend-only'
    setupMode: undefined, // 'recommended' | 'customize'
    useSavedPreferences: undefined,
    saveDefaults: undefined,
    packageManager: undefined,
    backend: undefined,
    presentation: undefined,
    backendType: undefined,
    architecture: undefined,
    mapping: undefined,
    orm: undefined,
    database: undefined,
    db: undefined,
    logging: undefined,
    backgroundJobs: undefined,
    hangfire: undefined,
    realtime: undefined,
    signalr: undefined,
    auth: undefined,
    authMode: undefined,
    authFlag: undefined,
    frontend: undefined,
    frontendEnabled: undefined,
    frontendLibrary: undefined,
    frontendTooling: undefined,
    reactFramework: undefined,
    language: undefined,
    styling: undefined,
    state: undefined,
    http: undefined,
    httpClient: undefined,
    forms: undefined,
    ui: undefined,
    componentSystem: undefined,
    sqlServer: undefined,
    localization: undefined,
    swagger: undefined,
    fluentValidation: undefined,
    globalUsings: undefined,
    healthChecks: undefined,
    dashboard: undefined,
    users: undefined,
    permissions: undefined,
    audit: undefined,
    notifications: undefined,
    domainLocalization: undefined,
    richText: undefined,
    help: false,
    version: false,
    _explicitFlags: new Set(),
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

    if (arg === '--yes' || arg === '-y') {
      options.yes = true;
      options._explicitFlags.add('--yes');
      continue;
    }

    if (arg === '--verbose') {
      options.verbose = true;
      options._explicitFlags.add('--verbose');
      continue;
    }

    if (arg === '--output' || arg === '-o') {
      const value = requireValue(args, index, '--output');
      options.output = path.resolve(value);
      options._explicitFlags.add('--output');
      index += 1;
      continue;
    }

    if (arg === '--package-manager' || arg === '-p') {
      const value = requireValue(args, index, '--package-manager');
      if (!validatePackageManager(value)) {
        throw new Error(`Unsupported package manager "${value}". Use npm, yarn, or pnpm.`);
      }
      options.packageManager = value;
      options._explicitFlags.add('--package-manager');
      index += 1;
      continue;
    }

    if (arg === '--type' || arg === '--mode' || arg === '--target' || arg === '--project-type') {
      const value = requireValue(args, index, arg);
      const normalized = validateAndNormalizeOption('type', value, arg);
      options.mode = normalized === 'backend' ? 'backend-only' : normalized === 'frontend' ? 'frontend-only' : 'fullstack';
      options._explicitFlags.add('--type');
      index += 1;
      continue;
    }

    if (arg === '--setup-mode') {
      const value = requireValue(args, index, '--setup-mode').toLowerCase();
      if (!['recommended', 'customize'].includes(value)) {
        throw new Error(`Unsupported setup mode "${value}". Use recommended or customize.`);
      }
      options.setupMode = value;
      options._explicitFlags.add('--setup-mode');
      index += 1;
      continue;
    }

    if (arg === '--presentation' || arg === '--backend-type') {
      const value = requireValue(args, index, arg);
      const normalized = validateAndNormalizeOption('backendType', value, arg);
      options.presentation = normalized;
      options.backendType = normalized;
      options._explicitFlags.add('--backend-type');
      index += 1;
      continue;
    }

    if (arg === '--architecture') {
      const value = requireValue(args, index, '--architecture');
      const normalized = validateAndNormalizeOption('architecture', value, '--architecture');
      options.architecture = normalized === 'cqrs' ? 'cqrs-mediatr' : normalized;
      options._explicitFlags.add('--architecture');
      index += 1;
      continue;
    }

    if (arg === '--mapping') {
      const value = requireValue(args, index, '--mapping');
      const normalized = validateAndNormalizeOption('mapping', value, '--mapping');
      options.mapping = normalized;
      options._explicitFlags.add('--mapping');
      index += 1;
      continue;
    }

    if (arg === '--orm' || arg === '--data-access') {
      const value = requireValue(args, index, arg);
      const normalized = validateAndNormalizeOption('orm', value, arg);
      options.orm = normalized === 'hybrid' ? 'efcore-dapper' : normalized;
      options._explicitFlags.add('--orm');
      index += 1;
      continue;
    }

    if (arg === '--database' || arg === '--db') {
      const value = requireValue(args, index, arg);
      const normalized = validateAndNormalizeOption('db', value, arg);
      options.database = normalized;
      options.db = normalized;
      options._explicitFlags.add('--db');
      index += 1;
      continue;
    }

    if (arg === '--logging') {
      const value = requireValue(args, index, '--logging');
      const normalized = validateAndNormalizeOption('logging', value, '--logging');
      options.logging = normalized === 'builtin' ? 'ilogger' : normalized;
      options._explicitFlags.add('--logging');
      index += 1;
      continue;
    }

    if (arg === '--background-jobs' || arg === '--jobs') {
      const value = requireValue(args, index, arg).toLowerCase();
      if (!['none', 'hangfire'].includes(value)) {
        throw new Error(`Invalid value "${value}" for ${arg}. Supported values: none, hangfire.`);
      }
      options.backgroundJobs = value;
      options._explicitFlags.add('--background-jobs');
      index += 1;
      continue;
    }

    if (arg === '--realtime' || arg === '--real-time') {
      const value = requireValue(args, index, arg).toLowerCase();
      if (!['none', 'signalr'].includes(value)) {
        throw new Error(`Invalid value "${value}" for ${arg}. Supported values: none, signalr.`);
      }
      options.realtime = value;
      options._explicitFlags.add('--realtime');
      index += 1;
      continue;
    }

    if (arg === '--auth' || arg === '--auth-mode') {
      // Check if next arg is a value or if --auth was used as a boolean flag
      const next = args[index + 1];
      if (next && !next.startsWith('-')) {
        const normalized = validateAndNormalizeOption('auth', next, arg);
        options.auth = normalized;
        options.authMode = normalized === 'jwt' ? 'identity-jwt' : normalized === 'cookies' ? 'identity' : 'none';
        options._explicitFlags.add('--auth');
        index += 1;
        continue;
      }
    }

    if (arg === '--frontend') {
      const next = args[index + 1];
      if (next && !next.startsWith('-')) {
        const normalized = validateAndNormalizeOption('frontend', next, '--frontend');
        options.frontend = normalized;
        options.frontendLibrary = normalized;
        options.frontendEnabled = true;
        options._explicitFlags.add('--frontend');
        index += 1;
        continue;
      }
    }

    if (arg === '--frontend-tooling' || arg === '--fe-tooling' || arg === '--react-framework') {
      const value = requireValue(args, index, arg);
      const normalized = validateAndNormalizeOption('frontendTooling', value, arg);
      options.frontendTooling = normalized;
      options.reactFramework = normalized;
      options._explicitFlags.add('--frontend-tooling');
      index += 1;
      continue;
    }

    if (arg === '--language' || arg === '--lang') {
      const value = requireValue(args, index, arg);
      const normalized = validateAndNormalizeOption('language', value, arg);
      options.language = normalized;
      options._explicitFlags.add('--language');
      index += 1;
      continue;
    }

    if (arg === '--styling' || arg === '--style') {
      const value = requireValue(args, index, arg);
      const normalized = validateAndNormalizeOption('styling', value, arg);
      options.styling = normalized;
      options._explicitFlags.add('--styling');
      index += 1;
      continue;
    }

    if (arg === '--state') {
      const value = requireValue(args, index, '--state');
      const normalized = validateAndNormalizeOption('state', value, '--state');
      options.state = normalized;
      options._explicitFlags.add('--state');
      index += 1;
      continue;
    }

    if (arg === '--http' || arg === '--http-client') {
      const value = requireValue(args, index, arg);
      const normalized = validateAndNormalizeOption('http', value, arg);
      options.http = normalized;
      options.httpClient = normalized === 'angular-http' ? 'httpclient' : normalized;
      options._explicitFlags.add('--http');
      index += 1;
      continue;
    }

    if (arg === '--forms') {
      const value = requireValue(args, index, '--forms');
      const normalized = validateAndNormalizeOption('forms', value, '--forms');
      options.forms = normalized === 'rhf-zod' ? 'react-hook-form-zod' : normalized === 'angular-reactive' ? 'reactive-forms' : normalized;
      options._explicitFlags.add('--forms');
      index += 1;
      continue;
    }

    if (arg === '--ui' || arg === '--component-system' || arg === '--components') {
      const value = requireValue(args, index, arg);
      const normalized = validateAndNormalizeOption('ui', value, arg);
      options.ui = normalized;
      options.componentSystem = normalized;
      options._explicitFlags.add('--ui');
      index += 1;
      continue;
    }

    if (arg in BOOLEAN_FLAGS) {
      explicitBooleans[arg] = true;
      const [key, value] = BOOLEAN_FLAGS[arg];
      options[key] = value;
      options._explicitFlags.add(arg);
      if (key === 'signalr') {
        options.realtime = value ? 'signalr' : 'none';
      } else if (key === 'hangfire') {
        options.backgroundJobs = value ? 'hangfire' : 'none';
      }
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}. Use --help to see supported flags.`);
    }

    if (options.projectName) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }

    options.projectName = arg;
  }

  // Validate boolean conflicts
  validateBooleanConflicts(explicitBooleans);

  // Derive backend/frontend enablement from mode if specified
  if (options.mode === 'fullstack') {
    options.backend = options.backend ?? true;
    options.frontendEnabled = options.frontendEnabled ?? true;
  } else if (options.mode === 'backend-only') {
    options.backend = true;
    options.frontendEnabled = false;
  } else if (options.mode === 'frontend-only') {
    options.backend = false;
    options.frontendEnabled = true;
  }

  return options;
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

export function printHelp() {
  const pkg = readPackageMeta();
  const bin = getBinCommandName();

  const text = `
${pkg.name} v${pkg.version}

${pkg.description}

Usage:
  ${bin} <project-name> [options]

Modes:
  --type <type>                      fullstack | backend | frontend
  --fullstack                        Create Full Stack project (Backend + Frontend)
  --backend-only                     Create Backend only project
  --frontend-only                    Create Frontend only project

Backend Options (.NET backend projects target .NET 10):
  --backend-type <type>              controllers | minimal-api | mvc | razor-pages
  --architecture <arch>              cqrs | services
  --mapping <mapping>                manual | automapper
  --orm <orm>                        efcore | dapper | hybrid
  --db <db>                          sqlserver | postgresql | sqlite
  --auth <auth>                      jwt | cookies | none
  --logging <logging>                serilog | builtin
  --signalr / --no-signalr           Enable / disable SignalR
  --hangfire / --no-hangfire         Enable / disable Hangfire

Frontend Options:
  --frontend <framework>             react | angular
  --frontend-tooling <tooling>       vite | next | angular-cli
  --language <language>              typescript | javascript
  --styling <styling>                tailwind | bootstrap
  --state <state>                    redux | zustand | ngrx | none
  --http <client>                    axios | fetch | angular-http
  --forms <forms>                    rhf-zod | angular-reactive | none
  --ui <ui>                          shadcn | mui | antd | angular-material | antd-angular | none
  --localization / --no-localization Enable / disable localization

General Options:
  -y, --yes                          Use defaults without prompting
  --verbose                          Show full output from internal commands
  -o, --output <dir>                 Parent directory for the new project (default: cwd)
  -p, --package-manager <name>       npm | yarn | pnpm | bun
  -h, --help                         Show help
  -v, --version                      Show version

Examples:
  # Interactive
  ${bin} my-app

  # Hybrid
  ${bin} my-app --type backend --orm efcore --db postgresql

  # Non-interactive Backend
  ${bin} my-app --type backend --backend-type controllers --architecture cqrs --mapping manual --orm efcore --db postgresql --auth jwt --signalr --hangfire --yes

  # Non-interactive Frontend
  ${bin} my-ui --type frontend --frontend react --frontend-tooling vite --language typescript --styling tailwind --state zustand --http axios --forms rhf-zod --ui shadcn --yes

  # Non-interactive Full Stack
  ${bin} my-app --type fullstack --architecture services --mapping manual --orm efcore --db postgresql --auth jwt --signalr --hangfire --frontend react --frontend-tooling vite --language typescript --styling tailwind --state zustand --http axios --forms rhf-zod --ui shadcn --yes
`.trim();

  process.stdout.write(`${text}\n`);
}

export function printVersion() {
  const pkg = readPackageMeta();
  process.stdout.write(`${pkg.version}\n`);
}

export const DEFAULT_OPTIONS = {
  packageManager: 'npm',
  mode: 'fullstack',
  setupMode: 'recommended',
  verbose: false,
  backend: true,
  presentation: 'controllers',
  frontendEnabled: true,
  architecture: 'cqrs-mediatr',
  mapping: 'manual',
  orm: 'efcore',
  database: 'sqlserver',
  logging: 'serilog',
  backgroundJobs: 'none',
  realtime: 'none',
  authMode: 'identity-jwt',
  frontendLibrary: 'react',
  reactFramework: 'next',
  language: 'typescript',
  styling: 'tailwind',
  state: 'redux',
  httpClient: 'axios',
  forms: 'react-hook-form-zod',
  componentSystem: 'shadcn',
  localization: true,
  sqlServer: true,
  auth: true,
  users: false,
  permissions: false,
  audit: false,
  notifications: false,
  domainLocalization: false,
  richText: false,
  dashboard: true,
};
