import { input, select, confirm } from '@inquirer/prompts';
import { DEFAULT_OPTIONS } from './arguments.js';
import { printGenerationSummary, printRecommendedDefaultsSummary } from './summary.js';
import { validateProjectName, validatePackageManager } from '../utils/validation.js';
import { GenerationError } from '../utils/errors.js';
import { defaultFrontendSelection, resolveFrontendSelection } from '../models/frontend.js';
import { defaultBackendSelection, assertBackendCompatibility } from '../models/backend.js';
import { loadUserPreferences, saveUserPreferences } from '../utils/user-preferences.js';
import { validateCompatibility } from './validate-options.js';
import { normalizeBackendOptions, normalizeFrontendOptions } from './normalize-options.js';

/**
 * Checks if the user supplied explicit configuration flags on the CLI.
 * @param {Record<string, unknown>} parsed
 */
function hasExplicitConfig(parsed) {
  const flags = parsed._explicitFlags;
  if (!flags || !(flags instanceof Set)) return false;
  for (const flag of flags) {
    if (
      flag !== '--output' &&
      flag !== '--save-defaults' &&
      flag !== '--package-manager' &&
      flag !== '-p' &&
      flag !== '-o' &&
      flag !== '--verbose'
    ) {
      return true;
    }
  }
  return false;
}


/**
 * @param {Record<string, unknown>} parsed
 */
export async function resolveOptions(parsed) {
  const projectNameResult = await resolveProjectName(parsed);
  const names = projectNameResult.names;

  // Pre-validate any explicitly supplied CLI flag combinations
  const preCheckBackend = normalizeBackendOptions(parsed, parsed.mode ?? 'fullstack');
  const preCheckFrontend = normalizeFrontendOptions(parsed);
  validateCompatibility({
    mode: parsed.mode ?? (parsed.backend === false ? 'frontend-only' : parsed.frontendEnabled === false ? 'backend-only' : 'fullstack'),
    backend: { ...preCheckBackend, enabled: parsed.backend !== false },
    frontend: { ...preCheckFrontend, enabled: parsed.frontendEnabled !== false },
  });

  // Check for saved developer preferences
  const savedPreferences = loadUserPreferences();
  let preferencesAction = 'fresh';

  const hasFlags = hasExplicitConfig(parsed);

  if (!parsed.yes && !hasFlags && savedPreferences && parsed.useSavedPreferences === undefined && !parsed.mode) {
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

  // 1. Project Mode
  const mode = await resolveCreationMode(parsed, preferencesAction, savedPreferences);
  const backendEnabled = mode === 'fullstack' || mode === 'backend-only';
  const frontendEnabled = mode === 'fullstack' || mode === 'frontend-only';

  // 2. Setup Mode: Recommended Defaults vs Customize
  const setupMode = await resolveSetupMode(parsed, preferencesAction, savedPreferences, hasFlags);

  let backend = null;
  let frontend = { enabled: false, library: null, framework: null };

  if (setupMode === 'recommended' && preferencesAction !== 'use-saved' && !hasFlags) {
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
  } else if (preferencesAction === 'use-saved' && savedPreferences && !hasFlags) {
    const savedPresentation = mode === 'fullstack' ? 'controllers' : (savedPreferences.backend?.presentation ?? 'controllers');
    const { dotnet: _ignoredDotnet, dotnetVersion: _ignoredDotnetVersion, ...cleanBackendPrefs } = savedPreferences.backend ?? {};
    backend = backendEnabled
      ? { ...defaultBackendSelection(), ...cleanBackendPrefs, presentation: savedPresentation }
      : null;
    frontend = frontendEnabled
      ? { ...defaultFrontendSelection(), ...(savedPreferences.frontend ?? {}) }
      : { enabled: false };
  } else {
    // Customization / Hybrid / Flag-driven Mode
    backend = backendEnabled ? await resolveCustomBackend(parsed, mode, savedPreferences) : null;
    frontend = frontendEnabled ? await resolveCustomFrontend(parsed) : { enabled: false };
  }

  // Package manager selection if frontend is enabled
  const packageManager = frontend.enabled
    ? await resolvePackageManager(parsed, savedPreferences?.packageManager)
    : (parsed.packageManager ?? DEFAULT_OPTIONS.packageManager);

  // V4 module options compatibility
  const modules = {
    auth: Boolean(parsed.authFlag ?? (backend?.authentication && backend.authentication !== 'none')),
    users: Boolean(parsed.users),
    permissions: Boolean(parsed.permissions),
    audit: Boolean(parsed.audit),
    notifications: Boolean(parsed.notifications),
    localization: Boolean(parsed.localization ?? frontend.localization),
    richText: Boolean(parsed.richText),
    dashboard: Boolean(parsed.dashboard ?? frontend.enabled),
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
    verbose: Boolean(parsed.verbose),
  };

  // Final compatibility validation
  validateCompatibility({
    mode,
    backend: options.backend,
    frontend: options.frontend,
  });

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
 * @param {boolean} [hasFlags]
 */
async function resolveSetupMode(parsed, preferencesAction, savedPreferences, hasFlags = false) {
  if (parsed.setupMode) {
    return parsed.setupMode;
  }
  if (hasFlags) {
    return 'customize';
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
  if (parsed.frontend || parsed.frontendLibrary) {
    return parsed.frontend ?? parsed.frontendLibrary;
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
  if (parsed.frontendTooling || parsed.reactFramework) {
    return parsed.frontendTooling ?? parsed.reactFramework;
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
  const norm = normalizeBackendOptions(parsed, mode);

  if (parsed.yes) {
    const presentation = mode === 'fullstack'
      ? 'controllers'
      : (norm.presentation ?? DEFAULT_OPTIONS.presentation);

    const defaultAuth = (presentation === 'mvc' || presentation === 'razor-pages')
      ? 'identity'
      : (norm.orm === 'dapper' ? 'none' : DEFAULT_OPTIONS.authMode);

    return {
      enabled: true,
      presentation,
      architecture: norm.architecture ?? DEFAULT_OPTIONS.architecture,
      mapping: norm.mapping ?? DEFAULT_OPTIONS.mapping,
      orm: norm.orm ?? DEFAULT_OPTIONS.orm,
      database: norm.database ?? DEFAULT_OPTIONS.database,
      logging: norm.logging ?? DEFAULT_OPTIONS.logging,
      backgroundJobs: norm.backgroundJobs ?? DEFAULT_OPTIONS.backgroundJobs,
      realtime: norm.realtime ?? DEFAULT_OPTIONS.realtime,
      authentication: norm.authentication ?? defaultAuth,
    };
  }

  const presentation = mode === 'fullstack'
    ? 'controllers'
    : (norm.presentation ?? (await select({
        message: 'Backend Type:',
        choices: [
          { name: 'Web API (Controllers)', value: 'controllers' },
          { name: 'Minimal API', value: 'minimal-api' },
          { name: 'MVC', value: 'mvc' },
          { name: 'Razor Pages', value: 'razor-pages' },
        ],
        default: savedPreferences?.backend?.presentation ?? 'controllers',
      })));

  const architecture = norm.architecture ?? (await select({
    message: 'Application Architecture:',
    choices: [
      { name: 'CQRS + MediatR', value: 'cqrs-mediatr' },
      { name: 'Application Services', value: 'services' },
    ],
  }));

  const mapping = norm.mapping ?? (await select({
    message: 'Mapping:',
    choices: [
      { name: 'Manual Mapping', value: 'manual' },
      { name: 'AutoMapper', value: 'automapper' },
    ],
  }));

  const orm = norm.orm ?? (await select({
    message: 'Data Access:',
    choices: [
      { name: 'Entity Framework Core', value: 'efcore' },
      { name: 'Dapper', value: 'dapper' },
      { name: 'EF Core + Dapper (EF for writes, Dapper for reads)', value: 'efcore-dapper' },
    ],
  }));

  const database = norm.database ?? (await select({
    message: 'Database:',
    choices: [
      { name: 'SQL Server', value: 'sqlserver' },
      { name: 'PostgreSQL', value: 'postgresql' },
      { name: 'SQLite', value: 'sqlite' },
    ],
  }));

  const logging = norm.logging ?? (await select({
    message: 'Logging:',
    choices: [
      { name: 'Serilog', value: 'serilog' },
      { name: 'Built-in ILogger', value: 'ilogger' },
    ],
  }));

  const backgroundJobs = norm.backgroundJobs ?? (await select({
    message: 'Background Jobs:',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'Hangfire', value: 'hangfire' },
    ],
  }));

  const realtime = norm.realtime ?? (await select({
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

  const authentication = norm.authentication ?? (await select({
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
  const norm = normalizeFrontendOptions(parsed);
  const library = norm.library ?? baseFrontend?.library ?? (await resolveFrontendLibrary(parsed));

  if (library === 'angular') {
    const styling = norm.styling ?? 'tailwind';
    const state = norm.state ?? (parsed.yes ? 'ngrx' : await select({
      message: 'State Management:',
      choices: [
        { name: 'NgRx', value: 'ngrx' },
        { name: 'None', value: 'none' },
      ],
    }));
    const componentSystem = norm.componentSystem ?? (parsed.yes ? 'none' : await select({
      message: 'UI Library:',
      choices: [
        { name: 'Angular Material', value: 'angular-material' },
        { name: 'Ant Design Angular', value: 'antd-angular' },
        { name: 'None', value: 'none' },
      ],
    }));
    const localization = norm.localization !== undefined ? norm.localization : (parsed.yes ? true : await confirm({
      message: 'Include UI localization foundation (en/ar, RTL/LTR)?',
      default: true,
    }));
    const realtime = norm.realtime ?? (parsed.yes ? 'none' : await select({
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
      state,
      httpClient: 'httpclient',
      forms: 'reactive-forms',
      componentSystem,
      localization: Boolean(localization),
      realtime,
    };
  }

  // React Customization
  const framework = norm.framework ?? baseFrontend?.framework ?? (await resolveReactFramework(parsed));

  if (parsed.yes) {
    const styling = norm.styling ?? DEFAULT_OPTIONS.styling;
    const componentSystem = norm.componentSystem ?? (styling === 'tailwind' ? DEFAULT_OPTIONS.componentSystem : 'none');
    return {
      enabled: true,
      library: 'react',
      framework,
      language: norm.language ?? DEFAULT_OPTIONS.language,
      styling,
      state: norm.state ?? DEFAULT_OPTIONS.state,
      httpClient: norm.httpClient ?? DEFAULT_OPTIONS.httpClient,
      forms: norm.forms ?? DEFAULT_OPTIONS.forms,
      componentSystem,
      localization: norm.localization !== undefined ? norm.localization : DEFAULT_OPTIONS.localization,
      realtime: norm.realtime ?? DEFAULT_OPTIONS.realtime,
    };
  }

  const language = norm.language ?? (await select({
    message: 'Language:',
    choices: [
      { name: 'TypeScript', value: 'typescript' },
      { name: 'JavaScript', value: 'javascript' },
    ],
  }));

  const styling = norm.styling ?? (await select({
    message: 'Styling:',
    choices: [
      { name: 'Tailwind CSS', value: 'tailwind' },
      { name: 'Bootstrap', value: 'bootstrap' },
    ],
  }));

  const state = norm.state ?? (await select({
    message: 'State Management:',
    choices: [
      { name: 'Redux Toolkit', value: 'redux' },
      { name: 'Zustand', value: 'zustand' },
      { name: 'None', value: 'none' },
    ],
  }));

  const httpClient = norm.httpClient ?? (await select({
    message: 'HTTP Client:',
    choices: [
      { name: 'Axios', value: 'axios' },
      { name: 'Fetch', value: 'fetch' },
    ],
  }));

  const forms = norm.forms ?? (await select({
    message: 'Forms:',
    choices: [
      { name: 'React Hook Form + Zod', value: 'react-hook-form-zod' },
      { name: 'None', value: 'none' },
    ],
  }));

  const localization = norm.localization !== undefined ? norm.localization : (await select({
    message: 'Localization:',
    choices: [
      { name: 'Enabled (Multi-language & RTL/LTR support)', value: true },
      { name: 'Disabled', value: false },
    ],
  }));

  // Component System (Filter shadcn/ui out if Bootstrap is selected)
  let componentChoices = [
    { name: 'Material UI (MUI)', value: 'mui' },
    { name: 'Ant Design', value: 'antd' },
    { name: 'None (Clean unstyled components)', value: 'none' },
  ];

  if (styling === 'tailwind') {
    componentChoices = [{ name: 'shadcn/ui', value: 'shadcn' }, ...componentChoices];
  }

  const componentSystem = norm.componentSystem ?? (await select({
    message: 'Component System:',
    choices: componentChoices,
  }));

  const realtime = norm.realtime ?? (await select({
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
