import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackageManager } from '../utils/validation.js';
import { isFrontendLibrary, isReactFramework } from '../models/frontend.js';

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
  '--signalr': ['realtime', 'signalr'],
  '--no-signalr': ['realtime', 'none'],
  '--sql-server': ['sqlServer', true],
  '--no-sql-server': ['sqlServer', false],
  '--auth': ['auth', true],
  '--no-auth': ['auth', false],
  '--localization': ['localization', true],
  '--no-localization': ['localization', false],
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
};

/**
 * @param {string[]} argv
 */
export function parseArguments(argv) {
  const args = argv.slice(2);
  /** @type {Record<string, unknown>} */
  const options = {
    projectName: undefined,
    output: process.cwd(),
    yes: false,
    mode: undefined, // 'fullstack' | 'backend-only' | 'frontend-only'
    setupMode: undefined, // 'recommended' | 'customize'
    useSavedPreferences: undefined,
    saveDefaults: undefined,
    packageManager: undefined,
    backend: undefined,
    presentation: undefined,
    architecture: undefined,
    mapping: undefined,
    orm: undefined,
    database: undefined,
    logging: undefined,
    backgroundJobs: undefined,
    realtime: undefined,
    authMode: undefined,
    frontendEnabled: undefined,
    frontendLibrary: undefined,
    reactFramework: undefined,
    language: undefined,
    styling: undefined,
    state: undefined,
    httpClient: undefined,
    forms: undefined,
    componentSystem: undefined,
    sqlServer: undefined,
    auth: undefined,
    localization: undefined,
    dashboard: undefined,
    users: undefined,
    permissions: undefined,
    audit: undefined,
    notifications: undefined,
    domainLocalization: undefined,
    richText: undefined,
    help: false,
    version: false,
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
      continue;
    }

    if (arg === '--output' || arg === '-o') {
      const value = requireValue(args, index, '--output');
      options.output = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--package-manager' || arg === '-p') {
      const value = requireValue(args, index, '--package-manager');
      if (!validatePackageManager(value)) {
        throw new Error(`Unsupported package manager "${value}". Use npm, yarn, or pnpm.`);
      }
      options.packageManager = value;
      index += 1;
      continue;
    }

    if (arg === '--mode' || arg === '--target' || arg === '--project-type') {
      const value = requireValue(args, index, arg).toLowerCase();
      if (!['fullstack', 'backend-only', 'frontend-only'].includes(value)) {
        throw new Error(`Unsupported mode "${value}". Use fullstack, backend-only, or frontend-only.`);
      }
      options.mode = value;
      index += 1;
      continue;
    }

    if (arg === '--setup-mode') {
      const value = requireValue(args, index, '--setup-mode').toLowerCase();
      if (!['recommended', 'customize'].includes(value)) {
        throw new Error(`Unsupported setup mode "${value}". Use recommended or customize.`);
      }
      options.setupMode = value;
      index += 1;
      continue;
    }

    if (arg === '--presentation' || arg === '--backend-type') {
      const value = requireValue(args, index, arg).toLowerCase();
      if (!['controllers', 'minimal-api', 'mvc', 'razor-pages'].includes(value)) {
        throw new Error(`Unsupported backend type "${value}". Use controllers, minimal-api, mvc, or razor-pages.`);
      }
      options.presentation = value;
      index += 1;
      continue;
    }

    if (arg === '--architecture') {
      const value = requireValue(args, index, '--architecture').toLowerCase();
      options.architecture = value;
      index += 1;
      continue;
    }

    if (arg === '--mapping') {
      const value = requireValue(args, index, '--mapping').toLowerCase();
      options.mapping = value;
      index += 1;
      continue;
    }

    if (arg === '--orm' || arg === '--data-access') {
      const value = requireValue(args, index, arg).toLowerCase();
      options.orm = value;
      index += 1;
      continue;
    }

    if (arg === '--database' || arg === '--db') {
      const value = requireValue(args, index, arg).toLowerCase();
      options.database = value;
      index += 1;
      continue;
    }

    if (arg === '--logging') {
      const value = requireValue(args, index, '--logging').toLowerCase();
      options.logging = value;
      index += 1;
      continue;
    }

    if (arg === '--background-jobs' || arg === '--jobs') {
      const value = requireValue(args, index, arg).toLowerCase();
      options.backgroundJobs = value;
      index += 1;
      continue;
    }

    if (arg === '--realtime' || arg === '--real-time') {
      const value = requireValue(args, index, arg).toLowerCase();
      options.realtime = value;
      index += 1;
      continue;
    }

    if (arg === '--auth-mode') {
      const value = requireValue(args, index, '--auth-mode').toLowerCase();
      options.authMode = value;
      index += 1;
      continue;
    }

    if (arg === '--frontend') {
      const value = requireValue(args, index, '--frontend');
      if (!isFrontendLibrary(value)) {
        throw new Error(`Unsupported frontend "${value}". Use react or angular.`);
      }
      options.frontendEnabled = true;
      options.frontendLibrary = value;
      index += 1;
      continue;
    }

    if (arg === '--react-framework') {
      const value = requireValue(args, index, '--react-framework');
      if (!isReactFramework(value)) {
        throw new Error(`Unsupported React framework "${value}". Use next or vite.`);
      }
      options.reactFramework = value;
      index += 1;
      continue;
    }

    if (arg === '--language' || arg === '--lang') {
      const value = requireValue(args, index, arg).toLowerCase();
      options.language = value;
      index += 1;
      continue;
    }

    if (arg === '--styling' || arg === '--style') {
      const value = requireValue(args, index, arg).toLowerCase();
      options.styling = value;
      index += 1;
      continue;
    }

    if (arg === '--state') {
      const value = requireValue(args, index, '--state').toLowerCase();
      options.state = value;
      index += 1;
      continue;
    }

    if (arg === '--http-client' || arg === '--http') {
      const value = requireValue(args, index, arg).toLowerCase();
      options.httpClient = value;
      index += 1;
      continue;
    }

    if (arg === '--forms') {
      const value = requireValue(args, index, '--forms').toLowerCase();
      options.forms = value;
      index += 1;
      continue;
    }

    if (arg === '--component-system' || arg === '--components') {
      const value = requireValue(args, index, arg).toLowerCase();
      options.componentSystem = value;
      index += 1;
      continue;
    }

    if (arg in BOOLEAN_FLAGS) {
      const [key, value] = BOOLEAN_FLAGS[arg];
      options[key] = value;
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
  ${bin} [project-name] [options]
  node ./bin/${bin}.js [project-name] [options]

Modes:
  --fullstack                        Create Full Stack project (Backend + Frontend)
  --backend-only                     Create Backend only project
  --frontend-only                    Create Frontend only project

Setup & Preferences:
  --setup-mode recommended|customize Choose between recommended stack or custom choices
  --recommended                      Use recommended production-ready stack defaults
  --customize                        Customize architectural decisions
  --use-saved-preferences            Use previously saved global developer preferences
  --save-defaults                    Save choices as global developer defaults

Backend Options:
  --backend / --no-backend           Include ASP.NET Core Clean Architecture backend
  --presentation controllers|minimal-api|mvc|razor-pages Backend presentation type
  --architecture cqrs-mediatr|services CQRS + MediatR or Application Services
  --mapping manual|automapper        Manual mapping extensions or AutoMapper
  --orm efcore|dapper|efcore-dapper  Entity Framework Core, Dapper, or both
                                    (Identity requires efcore or efcore-dapper)
  --database sqlserver|postgresql|sqlite SQL Server, PostgreSQL, or SQLite
  --logging serilog|ilogger          Serilog or built-in ILogger
  --background-jobs none|hangfire    Hangfire background processing
  --realtime none|signalr            SignalR real-time hubs & client
  --auth-mode identity-jwt|identity|none Authentication mode (Identity + JWT default)

Frontend Options:
  --frontend react|angular           Frontend library
  --no-frontend                      Skip frontend generation
  --react-framework next|vite        Next.js (App Router) or Vite SPA
  --language typescript|javascript   TypeScript or JavaScript
  --styling tailwind|bootstrap       Tailwind CSS or Bootstrap
  --state redux|zustand|ngrx|none    Redux Toolkit, Zustand, NgRx, or None
  --http-client axios|fetch          Axios or Fetch
  --forms react-hook-form-zod|none   React Hook Form + Zod validation
  --component-system shadcn|mui|antd|none shadcn/ui, MUI, Ant Design, or None

General Options:
  -h, --help                         Show help
  -v, --version                      Show version
  -y, --yes                          Use defaults without prompting
  -o, --output <dir>                 Parent directory for the new project (default: cwd)
  -p, --package-manager <name>       npm | yarn | pnpm (default: npm)

Examples:
  ${bin} MyApp --yes --fullstack
  ${bin} MyApi --yes --backend-only --database postgresql --orm dapper --realtime signalr
  ${bin} MyUi --yes --frontend-only --frontend react --react-framework vite --state zustand
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
