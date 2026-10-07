import { OPTION_DEFINITIONS } from './option-definitions.js';

/**
 * Validates a single CLI option against allowed values.
 *
 * @param {string} key
 * @param {string} value
 * @param {string} [flagName]
 * @returns {string} Normalized canonical value
 */
export function validateAndNormalizeOption(key, value, flagName) {
  const def = OPTION_DEFINITIONS[key];
  if (!def) {
    return value;
  }

  const flag = flagName ?? def.flag;
  const raw = String(value).trim().toLowerCase();

  if (def.supported.includes(raw)) {
    return raw;
  }

  if (raw in def.aliases) {
    return def.aliases[raw];
  }

  throw new Error(
    `Invalid value "${value}" for ${flag}. Supported values: ${def.supported.join(', ')}.`,
  );
}

/**
 * Checks for boolean flag conflicts (e.g. --signalr and --no-signalr).
 *
 * @param {Record<string, boolean>} explicitBooleans
 */
export function validateBooleanConflicts(explicitBooleans) {
  const pairs = [
    ['--signalr', '--no-signalr'],
    ['--hangfire', '--no-hangfire'],
    ['--localization', '--no-localization'],
    ['--swagger', '--no-swagger'],
    ['--fluent-validation', '--no-fluent-validation'],
    ['--global-usings', '--no-global-usings'],
    ['--health-checks', '--no-health-checks'],
    ['--save-defaults', '--no-save-defaults'],
    ['--backend', '--no-backend'],
    ['--frontend', '--no-frontend'],
  ];

  for (const [pos, neg] of pairs) {
    if (explicitBooleans[pos] && explicitBooleans[neg]) {
      throw new Error(`Cannot use both ${pos} and ${neg}.`);
    }
  }
}

/**
 * Validates cross-option compatibility rules.
 *
 * @param {object} config
 */
export function validateCompatibility(config) {
  const { mode, backend, frontend } = config;

  if (mode === 'fullstack' && backend?.enabled) {
    const pres = backend.presentation;
    if (pres && pres !== 'controllers' && pres !== 'minimal-api') {
      throw new Error(
        `Full Stack mode only supports Web API (Controllers or Minimal API). Cannot use with backend type "${pres}".`,
      );
    }
  }

  if (backend?.enabled) {
    const { presentation, orm, authentication } = backend;

    if (orm === 'dapper' && (authentication === 'identity-jwt' || authentication === 'identity' || authentication === 'identity-cookie' || authentication === 'identity-cookies' || authentication === 'jwt' || authentication === 'cookies')) {
      throw new Error(
        'Dapper-only cannot be combined with ASP.NET Identity. Identity requires EF Core. Use --orm efcore or --orm hybrid, or set --auth none.',
      );
    }

    if ((presentation === 'mvc' || presentation === 'razor-pages') && (authentication === 'identity-jwt' || authentication === 'jwt')) {
      throw new Error(
        'MVC and Razor Pages support cookie authentication (Identity + Cookies), not JWT-only.',
      );
    }
  }

  if (frontend?.enabled) {
    const { library, framework, language, styling, state, httpClient, forms, componentSystem } = frontend;

    if (library === 'angular') {
      if (framework && (framework === 'vite' || framework === 'next')) {
        throw new Error(`Angular does not support --frontend-tooling ${framework}. Use angular-cli.`);
      }
      if (language === 'javascript' || language === 'js') {
        throw new Error('Angular does not support JavaScript. Use --language typescript.');
      }
      if (state === 'redux' || state === 'zustand') {
        throw new Error(`Angular does not support --state ${state}. Use ngrx or none.`);
      }
      if (httpClient === 'axios' || httpClient === 'fetch') {
        throw new Error(`Angular does not support --http ${httpClient}. Use angular-http.`);
      }
      if (forms === 'rhf-zod' || forms === 'react-hook-form-zod') {
        throw new Error('Angular does not support --forms rhf-zod. Use angular-reactive or none.');
      }
      if (componentSystem === 'shadcn' || componentSystem === 'mui' || componentSystem === 'antd') {
        throw new Error(`Angular does not support --ui ${componentSystem}. Use angular-material, antd-angular, or none.`);
      }
    }

    if (library === 'react') {
      if (framework === 'angular-cli') {
        throw new Error('React does not support --frontend-tooling angular-cli. Use vite or next.');
      }
      if (state === 'ngrx') {
        throw new Error('React does not support --state ngrx. Use redux, zustand, or none.');
      }
      if (httpClient === 'angular-http' || httpClient === 'httpclient') {
        throw new Error('React does not support --http angular-http. Use axios or fetch.');
      }
      if (forms === 'angular-reactive' || forms === 'reactive-forms') {
        throw new Error('React does not support --forms angular-reactive. Use rhf-zod or none.');
      }
      if (componentSystem === 'angular-material' || componentSystem === 'material') {
        throw new Error('React does not support --ui angular-material. Use shadcn, mui, antd, or none.');
      }
      if (componentSystem === 'antd-angular') {
        throw new Error('React does not support --ui antd-angular. Use shadcn, mui, antd, or none.');
      }
    }

    if (styling === 'bootstrap' && componentSystem === 'shadcn') {
      throw new Error('shadcn/ui requires Tailwind CSS. It cannot be used with Bootstrap.');
    }
  }
}
