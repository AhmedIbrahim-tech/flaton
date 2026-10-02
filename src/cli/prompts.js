import { input, select, confirm } from '@inquirer/prompts';
import { DEFAULT_OPTIONS } from './arguments.js';
import { printGenerationSummary, printRecommendedDefaultsSummary } from './summary.js';
import { validateProjectName, validatePackageManager } from '../utils/validation.js';
import { GenerationError } from '../utils/errors.js';
import { defaultFrontendSelection, resolveFrontendSelection } from '../models/frontend.js';
import { defaultBackendSelection, assertBackendCompatibility } from '../models/backend.js';
import { loadUserPreferences, saveUserPreferences } from '../utils/user-preferences.js';

/**
 * @param {Record<string, unknown>} parsed
 */
export async function resolveOptions(parsed) {
  const projectNameResult = await resolveProjectName(parsed);
  const names = projectNameResult.names;

  // Check for saved developer preferences
  const savedPreferences = loadUserPreferences();
  let preferencesAction = 'fresh';

  if (!parsed.yes && savedPreferences && parsed.useSavedPreferences === undefined && !parsed.mode) {
    preferencesAction = await select({
      message: 'Found saved developer preferences:',
      choices: [
        { name: 'Use saved preferences', value: 'use-saved' },
        { name: 'Customize', value: 'customize' },
        { name: 'Start fresh', value: 'fresh' },
      ],
    });
  } else if (parsed.useSavedPreferences && savedPreferences) {
    preferencesAction = 'use-saved';
  }

  // 1. What do you want to create?
  const mode = await resolveCreationMode(parsed, preferencesAction, savedPreferences);
  const backendEnabled = mode === 'fullstack' || mode === 'backend-only';
  const frontendEnabled = mode === 'fullstack' || mode === 'frontend-only';

  // 2. Setup Mode: Recommended Defaults vs Customize
  const setupMode = await resolveSetupMode(parsed, preferencesAction, savedPreferences);

  let backend = null;
  let frontend = { enabled: false, library: null, framework: null };

  if (setupMode === 'recommended' && preferencesAction !== 'use-saved') {
    // Determine target frontend library/framework for recommended summary
    let targetFrontend = defaultFrontendSelection('next');
    if (frontendEnabled) {
      const frontendLib = await resolveFrontendLibrary(parsed);
      let reactFw = 'next';
      if (frontendLib === 'react') {
        reactFw = await resolveReactFramework(parsed);
      }
      targetFrontend = frontendLib === 'angular'
        ? resolveFrontendSelection({ frontendLibrary: 'angular' }).frontend
        : defaultFrontendSelection(reactFw);
    }

    if (!parsed.yes) {
      printRecommendedDefaultsSummary(mode, targetFrontend);
      const continueWithRecommended = await select({
        message: 'Continue with these settings?',
        choices: [
          { name: 'Yes (Generate recommended stack)', value: 'yes' },
          { name: 'Customize (Fine-tune architectural decisions)', value: 'customize' },
        ],
      });

      if (continueWithRecommended === 'customize') {
        backend = backendEnabled ? await resolveCustomBackend(parsed, mode, savedPreferences) : null;
        frontend = frontendEnabled ? await resolveCustomFrontend(parsed, targetFrontend) : { enabled: false };
      } else {
        backend = backendEnabled ? defaultBackendSelection() : null;
        frontend = frontendEnabled ? targetFrontend : { enabled: false };
      }
    } else {
      backend = backendEnabled ? defaultBackendSelection() : null;
      frontend = frontendEnabled ? targetFrontend : { enabled: false };
    }
  } else if (preferencesAction === 'use-saved' && savedPreferences) {
    const savedPresentation = mode === 'fullstack' ? 'controllers' : (savedPreferences.backend?.presentation ?? 'controllers');
    backend = backendEnabled
      ? { ...defaultBackendSelection(), ...(savedPreferences.backend ?? {}), presentation: savedPresentation }
      : null;
    frontend = frontendEnabled
      ? { ...defaultFrontendSelection(), ...(savedPreferences.frontend ?? {}) }
      : { enabled: false };
  } else {
    // Customization Mode
    backend = backendEnabled ? await resolveCustomBackend(parsed, mode, savedPreferences) : null;
    frontend = frontendEnabled ? await resolveCustomFrontend(parsed) : { enabled: false };
  }

  // Package manager selection if frontend is enabled
  const packageManager = frontend.enabled
    ? await resolvePackageManager(parsed, savedPreferences?.packageManager)
    : (parsed.packageManager ?? DEFAULT_OPTIONS.packageManager);

  // V4 module options compatibility
  const modules = {
    auth: Boolean(backend?.authentication && backend.authentication !== 'none'),
    users: Boolean(backend?.authentication && backend.authentication !== 'none'),
    permissions: Boolean(backend?.authentication && backend.authentication !== 'none'),
    audit: false,
    notifications: Boolean(backend?.realtime === 'signalr'),
    localization: Boolean(frontend.localization),
    richText: false,
    dashboard: Boolean(frontend.enabled),
    defaultRole: 'User',
    roles: ['Admin', 'Editor', 'User'],
  };

  const options = {
    ...names,
    output: parsed.output,
    yes: Boolean(parsed.yes),
    mode,
    setupMode,
    packageManager,
    backend: backend ? { ...backend, enabled: true } : { enabled: false },
    frontend,
    sqlServer: backend?.database === 'sqlserver',
    auth: Boolean(backend?.authentication && backend.authentication !== 'none'),
    localization: Boolean(frontend.localization),
    dashboard: Boolean(frontend.enabled),
    realtime: backend?.realtime === 'signalr' || frontend?.realtime === 'signalr',
    modules,
    defaultRole: 'User',
    roles: ['Admin', 'Editor', 'User'],
    saveDefaults: parsed.saveDefaults,
  };

  if (options.backend?.enabled) {
    assertBackendCompatibility(options.backend);
  }

  // Final confirmation summary before generation
  if (!parsed.yes) {
    printGenerationSummary(options);
    const generateConfirmed = await confirm({
      message: 'Generate project?',
      default: true,
    });

    if (!generateConfirmed) {
      return null;
    }
  }

  return options;
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {string} preferencesAction
 * @param {object | null} savedPreferences
 */
async function resolveCreationMode(parsed, preferencesAction, savedPreferences) {
  if (parsed.mode) {
    return parsed.mode;
  }
  if (parsed.backend === false && parsed.frontendEnabled !== false) {
    return 'frontend-only';
  }
  if (parsed.backend !== false && parsed.frontendEnabled === false) {
    return 'backend-only';
  }
  if (parsed.yes) {
    return DEFAULT_OPTIONS.mode;
  }
  if (preferencesAction === 'use-saved' && savedPreferences?.mode) {
    return savedPreferences.mode;
  }

  return select({
    message: 'What do you want to create?',
    choices: [
      { name: '1. Full Stack (ASP.NET Core Web API + Frontend Client)', value: 'fullstack' },
      { name: '2. Backend Only (ASP.NET Core Web API)', value: 'backend-only' },
      { name: '3. Frontend Only (React / Next.js / Vite / Angular Client)', value: 'frontend-only' },
    ],
  });
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {string} preferencesAction
 * @param {object | null} savedPreferences
 */
async function resolveSetupMode(parsed, preferencesAction, savedPreferences) {
  if (parsed.setupMode) {
    return parsed.setupMode;
  }
  if (parsed.yes) {
    return DEFAULT_OPTIONS.setupMode;
  }
  if (preferencesAction === 'use-saved') {
    return 'saved';
  }
  if (preferencesAction === 'customize') {
    return 'customize';
  }

  return select({
    message: 'Setup Mode:',
    choices: [
      { name: 'Recommended Defaults', value: 'recommended' },
      { name: 'Customize', value: 'customize' },
    ],
  });
}

/**
 * @param {Record<string, unknown>} parsed
 */
async function resolveFrontendLibrary(parsed) {
  if (parsed.frontendLibrary) {
    return parsed.frontendLibrary;
  }
  if (parsed.yes) {
    return DEFAULT_OPTIONS.frontendLibrary;
  }

  return select({
    message: 'Frontend Framework:',
    choices: [
      { name: 'React', value: 'react' },
      { name: 'Angular', value: 'angular' },
    ],
  });
}

/**
 * @param {Record<string, unknown>} parsed
 */
async function resolveReactFramework(parsed) {
  if (parsed.reactFramework) {
    return parsed.reactFramework;
  }
  if (parsed.yes) {
    return DEFAULT_OPTIONS.reactFramework;
  }

  return select({
    message: 'React Framework:',
    choices: [
      { name: 'Next.js (App Router)', value: 'next' },
      { name: 'Vite (SPA)', value: 'vite' },
    ],
  });
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {string} [mode]
 * @param {object | null} [savedPreferences]
 */
async function resolveCustomBackend(parsed, mode = 'backend-only', savedPreferences = null) {
  if (parsed.yes) {
    return {
      enabled: true,
      presentation: mode === 'fullstack'
        ? 'controllers'
        : (parsed.presentation ?? DEFAULT_OPTIONS.presentation),
      architecture: parsed.architecture ?? DEFAULT_OPTIONS.architecture,
      mapping: parsed.mapping ?? DEFAULT_OPTIONS.mapping,
      orm: parsed.orm ?? DEFAULT_OPTIONS.orm,
      database: parsed.database ?? (parsed.sqlServer === false ? 'sqlite' : DEFAULT_OPTIONS.database),
      logging: parsed.logging ?? DEFAULT_OPTIONS.logging,
      backgroundJobs: parsed.backgroundJobs ?? DEFAULT_OPTIONS.backgroundJobs,
      realtime: parsed.realtime ?? DEFAULT_OPTIONS.realtime,
      authentication: parsed.authMode ?? (parsed.auth === false ? 'none' : DEFAULT_OPTIONS.authMode),
    };
  }

  const presentation = mode === 'fullstack'
    ? 'controllers'
    : (parsed.presentation ?? (await select({
        message: 'Backend Type:',
        choices: [
          { name: 'Web API (Controllers)', value: 'controllers' },
          { name: 'Minimal API', value: 'minimal-api' },
          { name: 'MVC', value: 'mvc' },
          { name: 'Razor Pages', value: 'razor-pages' },
        ],
        default: savedPreferences?.backend?.presentation ?? 'controllers',
      })));

  const architecture = parsed.architecture ?? (await select({
    message: 'Application Architecture:',
    choices: [
      { name: 'CQRS + MediatR', value: 'cqrs-mediatr' },
      { name: 'Application Services', value: 'services' },
    ],
  }));

  const mapping = parsed.mapping ?? (await select({
    message: 'Mapping:',
    choices: [
      { name: 'Manual Mapping', value: 'manual' },
      { name: 'AutoMapper', value: 'automapper' },
    ],
  }));

  const orm = parsed.orm ?? (await select({
    message: 'Data Access:',
    choices: [
      { name: 'Entity Framework Core', value: 'efcore' },
      { name: 'Dapper', value: 'dapper' },
      { name: 'EF Core + Dapper (EF for writes, Dapper for reads)', value: 'efcore-dapper' },
    ],
  }));

  const database = parsed.database ?? (await select({
    message: 'Database:',
    choices: [
      { name: 'SQL Server', value: 'sqlserver' },
      { name: 'PostgreSQL', value: 'postgresql' },
      { name: 'SQLite', value: 'sqlite' },
    ],
  }));

  const logging = parsed.logging ?? (await select({
    message: 'Logging:',
    choices: [
      { name: 'Serilog', value: 'serilog' },
      { name: 'Built-in ILogger', value: 'ilogger' },
    ],
  }));

  const backgroundJobs = parsed.backgroundJobs ?? (await select({
    message: 'Background Jobs:',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'Hangfire', value: 'hangfire' },
    ],
  }));

  const realtime = parsed.realtime ?? (await select({
    message: 'Real Time Communication:',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'SignalR', value: 'signalr' },
    ],
  }));

  let authChoices;
  if (orm === 'dapper') {
    authChoices = [
      { name: 'None', value: 'none' },
    ];
  } else if (presentation === 'mvc' || presentation === 'razor-pages') {
    authChoices = [
      { name: 'Identity + Cookies', value: 'identity' },
      { name: 'None', value: 'none' },
    ];
  } else {
    authChoices = [
      { name: 'Identity + JWT', value: 'identity-jwt' },
      { name: 'Identity + Cookies', value: 'identity' },
      { name: 'None', value: 'none' },
    ];
  }

  const authentication = parsed.authMode ?? (await select({
    message: 'Authentication:',
    choices: authChoices,
  }));

  return {
    enabled: true,
    presentation,
    architecture,
    mapping,
    orm,
    database,
    logging,
    backgroundJobs,
    realtime,
    authentication,
  };
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {object} [baseFrontend]
 */
async function resolveCustomFrontend(parsed, baseFrontend) {
  const library = baseFrontend?.library ?? (await resolveFrontendLibrary(parsed));

  if (library === 'angular') {
    const styling = parsed.styling ?? 'tailwind';
    const localization = parsed.localization ?? (await confirm({
      message: 'Include UI localization foundation (en/ar, RTL/LTR)?',
      default: true,
    }));
    const realtime = parsed.realtime ?? (await select({
      message: 'Real Time Communication:',
      choices: [
        { name: 'None', value: 'none' },
        { name: 'SignalR Client', value: 'signalr' },
      ],
    }));

    return {
      enabled: true,
      library: 'angular',
      framework: null,
      language: 'typescript',
      styling,
      state: 'ngrx',
      httpClient: 'httpclient',
      forms: 'reactive-forms',
      componentSystem: 'none',
      localization,
      realtime,
    };
  }

  // React Customization
  const framework = baseFrontend?.framework ?? (await resolveReactFramework(parsed));

  const language = parsed.language ?? (await select({
    message: 'Language:',
    choices: [
      { name: 'TypeScript', value: 'typescript' },
      { name: 'JavaScript', value: 'javascript' },
    ],
  }));

  const styling = parsed.styling ?? (await select({
    message: 'Styling:',
    choices: [
      { name: 'Tailwind CSS', value: 'tailwind' },
      { name: 'Bootstrap', value: 'bootstrap' },
    ],
  }));

  const state = parsed.state ?? (await select({
    message: 'State Management:',
    choices: [
      { name: 'Redux Toolkit', value: 'redux' },
      { name: 'Zustand', value: 'zustand' },
      { name: 'None', value: 'none' },
    ],
  }));

  const httpClient = parsed.httpClient ?? (await select({
    message: 'HTTP Client:',
    choices: [
      { name: 'Axios', value: 'axios' },
      { name: 'Fetch', value: 'fetch' },
    ],
  }));

  const forms = parsed.forms ?? (await select({
    message: 'Forms:',
    choices: [
      { name: 'React Hook Form + Zod', value: 'react-hook-form-zod' },
      { name: 'None', value: 'none' },
    ],
  }));

  const localization = parsed.localization ?? (await select({
    message: 'Localization:',
    choices: [
      { name: 'Enabled (Multi-language & RTL/LTR support)', value: true },
      { name: 'Disabled', value: false },
    ],
  }));

  // Component System (Filter shadcn/ui out if Bootstrap is selected)
  const componentChoices = [
    { name: 'Material UI (MUI)', value: 'mui' },
    { name: 'Ant Design', value: 'antd' },
    { name: 'None (Clean unstyled components)', value: 'none' },
  ];

  if (styling === 'tailwind') {
    componentChoices.unshift({ name: 'shadcn/ui', value: 'shadcn' });
  }

  const componentSystem = parsed.componentSystem ?? (await select({
    message: 'Component System:',
    choices: componentChoices,
  }));

  const realtime = parsed.realtime ?? (await select({
    message: 'Real Time Communication:',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'SignalR Client (@microsoft/signalr)', value: 'signalr' },
    ],
  }));

  return {
    enabled: true,
    library: 'react',
    framework,
    language,
    styling,
    state,
    httpClient,
    forms,
    componentSystem,
    localization: Boolean(localization),
    realtime,
  };
}

/**
 * @param {Record<string, unknown>} parsed
 */
async function resolveProjectName(parsed) {
  if (typeof parsed.projectName === 'string' && parsed.projectName.length > 0) {
    const result = validateProjectName(parsed.projectName);
    if (!result.ok) {
      throw new GenerationError(result.error, {
        step: 'Validate project name',
        command: '(none)',
        targetDirectory: parsed.output,
      });
    }
    return result;
  }

  if (parsed.yes) {
    throw new GenerationError('Project name is required when using --yes.', {
      step: 'Validate project name',
      command: '(none)',
      targetDirectory: parsed.output,
    });
  }

  const answer = await input({
    message: 'Project name:',
    validate(value) {
      const result = validateProjectName(value);
      return result.ok ? true : result.error;
    },
  });

  const result = validateProjectName(answer);
  if (!result.ok) {
    throw new GenerationError(result.error, {
      step: 'Validate project name',
      command: '(none)',
      targetDirectory: parsed.output,
    });
  }

  return result;
}

/**
 * @param {Record<string, unknown>} parsed
 * @param {string} [defaultPm]
 */
async function resolvePackageManager(parsed, defaultPm) {
  if (typeof parsed.packageManager === 'string') {
    if (!validatePackageManager(parsed.packageManager)) {
      throw new GenerationError(`Unsupported package manager "${parsed.packageManager}".`, {
        step: 'Validate package manager',
        command: '(none)',
        targetDirectory: parsed.output,
      });
    }
    return parsed.packageManager;
  }

  if (parsed.yes) {
    return defaultPm ?? DEFAULT_OPTIONS.packageManager;
  }

  return select({
    message: 'Package manager:',
    default: defaultPm ?? DEFAULT_OPTIONS.packageManager,
    choices: [
      { name: 'npm', value: 'npm' },
      { name: 'yarn', value: 'yarn' },
      { name: 'pnpm', value: 'pnpm' },
    ],
  });
}
