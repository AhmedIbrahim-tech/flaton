/**
 * Normalizes CLI options to internal generator models.
 */

/**
 * Normalizes backend options to internal representation.
 * @param {Record<string, unknown>} raw
 * @param {string} mode
 */
export function normalizeBackendOptions(raw, mode) {
  const presentation = mode === 'fullstack'
    ? 'controllers'
    : (raw.backendType ?? raw.presentation);

  let architecture = raw.architecture;
  if (architecture === 'cqrs') architecture = 'cqrs-mediatr';

  let orm = raw.orm;
  if (orm === 'hybrid') orm = 'efcore-dapper';

  let database = raw.db ?? raw.database;

  let authentication = raw.auth ?? raw.authMode;
  if (authentication === 'jwt') authentication = 'identity-jwt';
  else if (authentication === 'cookies' || authentication === 'identity-cookie' || authentication === 'identity-cookies') authentication = 'identity';

  let logging = raw.logging;
  if (logging === 'builtin') logging = 'ilogger';

  let backgroundJobs = raw.backgroundJobs;
  if (raw.hangfire === true) backgroundJobs = 'hangfire';
  else if (raw.hangfire === false) backgroundJobs = 'none';

  let realtime = raw.realtime;
  if (raw.signalr === true) realtime = 'signalr';
  else if (raw.signalr === false) realtime = 'none';

  return {
    presentation,
    architecture,
    mapping: raw.mapping,
    orm,
    database,
    authentication,
    logging,
    backgroundJobs,
    realtime,
  };
}

/**
 * Normalizes frontend options to internal representation.
 * @param {Record<string, unknown>} raw
 */
export function normalizeFrontendOptions(raw) {
  const library = raw.frontend ?? raw.frontendLibrary;
  let framework = raw.frontendTooling ?? raw.reactFramework;
  if (library === 'angular') {
    framework = null;
  }

  let language = raw.language;
  if (library === 'angular') {
    language = 'typescript';
  }

  const styling = raw.styling;
  const state = raw.state;

  let httpClient = raw.http ?? raw.httpClient;
  if (httpClient === 'angular-http') httpClient = 'httpclient';

  let forms = raw.forms;
  if (forms === 'rhf-zod') forms = 'react-hook-form-zod';
  else if (forms === 'angular-reactive') forms = 'reactive-forms';

  const componentSystem = raw.ui ?? raw.componentSystem;

  let realtime = raw.realtime;
  if (raw.signalr === true) realtime = 'signalr';
  else if (raw.signalr === false) realtime = 'none';

  const localization = raw.localization !== undefined ? Boolean(raw.localization) : undefined;

  return {
    library,
    framework,
    language,
    styling,
    state,
    httpClient,
    forms,
    componentSystem,
    localization,
    realtime,
  };
}
