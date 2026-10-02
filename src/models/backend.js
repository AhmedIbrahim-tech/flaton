export const BACKEND_PRESENTATIONS = /** @type {const} */ (['controllers', 'minimal-api', 'mvc', 'razor-pages']);
export const BACKEND_ARCHITECTURES = /** @type {const} */ (['cqrs-mediatr', 'services']);
export const BACKEND_MAPPINGS = /** @type {const} */ (['manual', 'automapper']);
export const BACKEND_ORMS = /** @type {const} */ (['efcore', 'dapper', 'efcore-dapper']);
export const BACKEND_DATABASES = /** @type {const} */ (['sqlserver', 'postgresql', 'sqlite']);
export const BACKEND_LOGGINGS = /** @type {const} */ (['serilog', 'ilogger']);
export const BACKEND_BACKGROUND_JOBS = /** @type {const} */ (['none', 'hangfire']);
export const BACKEND_REALTIMES = /** @type {const} */ (['none', 'signalr']);
export const BACKEND_AUTHENTICATIONS = /** @type {const} */ (['identity-jwt', 'identity', 'identity-cookie', 'identity-cookies', 'none']);

/**
 * @typedef {object} BackendSelection
 * @property {boolean} enabled
 * @property {'controllers' | 'minimal-api' | 'mvc' | 'razor-pages'} [presentation]
 * @property {'cqrs-mediatr' | 'services'} [architecture]
 * @property {'manual' | 'automapper'} [mapping]
 * @property {'efcore' | 'dapper' | 'efcore-dapper'} [orm]
 * @property {'sqlserver' | 'postgresql' | 'sqlite'} [database]
 * @property {'serilog' | 'ilogger'} [logging]
 * @property {'none' | 'hangfire'} [backgroundJobs]
 * @property {'none' | 'signalr'} [realtime]
 * @property {'identity-jwt' | 'identity' | 'identity-cookie' | 'identity-cookies' | 'none'} [authentication]
 */

/**
 * Recommended ASP.NET Core Clean Architecture defaults.
 * @returns {BackendSelection}
 */
export function defaultBackendSelection() {
  return {
    enabled: true,
    presentation: 'controllers',
    architecture: 'cqrs-mediatr',
    mapping: 'manual',
    orm: 'efcore',
    database: 'sqlserver',
    logging: 'serilog',
    backgroundJobs: 'none',
    realtime: 'none',
    authentication: 'identity-jwt',
  };
}

const IDENTITY_AUTHENTICATIONS = new Set(['identity-jwt', 'identity', 'identity-cookie', 'identity-cookies']);

/**
 * ASP.NET Identity stores (users, roles, claims) require EF Core.
 * Dapper-only projects cannot host Identity without generating a broken app.
 * @param {string} [authentication]
 */
export function identityRequiresEfCore(authentication) {
  return IDENTITY_AUTHENTICATIONS.has(authentication);
}

/**
 * Identity seeders, JWT placeholders, and Identity EF packages are only
 * produced when authentication is enabled.
 * @param {string} [authentication]
 */
export function shouldGenerateIdentityArtifacts(authentication) {
  return Boolean(authentication) && authentication !== 'none';
}

/**
 * Rejects backend option combinations that cannot generate a valid app.
 * @param {{ presentation?: string, orm?: string, authentication?: string }} [backend]
 */
export function assertBackendCompatibility(backend = {}) {
  const presentation = backend.presentation ?? 'controllers';
  const orm = backend.orm ?? 'efcore';
  const authentication = backend.authentication ?? 'none';

  if (orm === 'dapper' && identityRequiresEfCore(authentication)) {
    throw new Error(
      'Dapper-only cannot be combined with ASP.NET Identity. Identity requires EF Core. Use --orm efcore or --orm efcore-dapper, or set --auth-mode none.',
    );
  }

  if ((presentation === 'mvc' || presentation === 'razor-pages') && authentication === 'identity-jwt') {
    throw new Error(
      'MVC and Razor Pages support cookie authentication (Identity + Cookies), not JWT-only.',
    );
  }
}

/**
 * @param {BackendSelection | null | undefined} backend
 */
export function describeBackend(backend) {
  if (!backend || !backend.enabled) {
    return 'None';
  }

  const presentation = backend.presentation ?? 'controllers';
  let presentationName = 'ASP.NET Core Web API';
  if (presentation === 'minimal-api') {
    presentationName = 'ASP.NET Core Minimal API';
  } else if (presentation === 'mvc') {
    presentationName = 'ASP.NET Core MVC';
  } else if (presentation === 'razor-pages') {
    presentationName = 'ASP.NET Core Razor Pages';
  }

  const parts = [presentationName, 'Clean Architecture'];

  if (backend.architecture === 'cqrs-mediatr') {
    parts.push('CQRS + MediatR');
  } else if (backend.architecture === 'services') {
    parts.push('Application Services');
  }

  if (backend.orm === 'efcore') {
    parts.push('EF Core');
  } else if (backend.orm === 'dapper') {
    parts.push('Dapper');
  } else if (backend.orm === 'efcore-dapper') {
    parts.push('EF Core + Dapper');
  }

  if (backend.database === 'sqlserver') {
    parts.push('SQL Server');
  } else if (backend.database === 'postgresql') {
    parts.push('PostgreSQL');
  } else if (backend.database === 'sqlite') {
    parts.push('SQLite');
  }

  if (backend.authentication === 'identity-jwt') {
    parts.push('Identity + JWT');
  } else if (backend.authentication === 'identity' || backend.authentication === 'identity-cookie') {
    parts.push('Identity + Cookies');
  }

  if (backend.logging === 'serilog') {
    parts.push('Serilog');
  } else if (backend.logging === 'ilogger') {
    parts.push('Built-in ILogger');
  }

  if (backend.realtime === 'signalr') {
    parts.push('SignalR');
  }

  if (backend.backgroundJobs === 'hangfire') {
    parts.push('Hangfire');
  }

  return parts.join(' | ');
}

