/**
 * Resolves backend and frontend profile values from `.fullstack-app.json`.
 * Planners must read these fields instead of inventing stack defaults.
 */

/**
 * @param {object} [input]
 * @returns {boolean}
 */
export function resolveBackendEnabled(input = {}) {
  const backend = input.backend ?? input.manifest?.backend;
  if (typeof backend === 'boolean') {
    return backend;
  }
  return backend?.enabled === true;
}

/**
 * @param {object} [input]
 * @returns {'none' | 'identity' | 'identity-jwt'}
 */
export function resolveBackendAuthentication(input = {}) {
  const value =
    input.authentication
    ?? input.manifest?.backend?.authentication
    ?? 'none';
  if (value === 'identity' || value === 'identity-jwt') {
    return value;
  }
  return 'none';
}

/**
 * @param {object} [input]
 * @returns {'manual' | 'automapper'}
 */
export function resolveBackendMapping(input = {}) {
  const value = input.manifest?.backend?.mapping ?? input.backend?.mapping ?? input.mapping ?? 'manual';
  return value === 'automapper' ? 'automapper' : 'manual';
}

/**
 * @param {object} [input]
 * @returns {boolean}
 */
export function resolvePermissionsEnabled(input = {}) {
  if (typeof input.permissions === 'boolean') {
    return input.permissions;
  }
  const modules = input.manifest?.modules ?? {};
  return modules.permissions?.enabled === true;
}

/**
 * @param {object} [input]
 */
export function resolveFrontendProfile(input = {}) {
  const frontend = input.frontend ?? input.manifest?.frontend ?? {};
  const library = frontend.library ?? input.frontendStrategy?.library ?? null;
  const framework =
    frontend.framework
    ?? input.frontendStrategy?.framework
    ?? null;

  const language = frontend.language === 'javascript' ? 'javascript' : 'typescript';

  let state = 'redux';
  if (library === 'angular') {
    state = frontend.state === 'none' ? 'none' : 'ngrx';
  } else if (frontend.state === 'zustand') {
    state = 'zustand';
  } else if (frontend.state === 'none') {
    state = 'none';
  } else if (frontend.state === 'redux' || frontend.state === 'ngrx') {
    state = frontend.state;
  }

  let httpClient = 'axios';
  if (library === 'angular') {
    httpClient = 'httpclient';
  } else if (frontend.httpClient === 'fetch') {
    httpClient = 'fetch';
  }

  let forms = 'react-hook-form-zod';
  if (library === 'angular') {
    forms = 'reactive-forms';
  } else if (frontend.forms === 'none') {
    forms = 'none';
  }

  return {
    enabled: frontend.enabled === true,
    library,
    framework: library === 'react' && framework === 'vite' ? 'vite' : library === 'react' ? 'next' : framework,
    language,
    styling: frontend.styling ?? 'tailwind',
    state,
    httpClient,
    forms,
    componentSystem: frontend.componentSystem ?? 'none',
  };
}

/**
 * @param {object} config
 */
export function isTypeScript(config) {
  return (config.frontend?.language ?? 'typescript') !== 'javascript';
}

/**
 * @param {object} config
 */
export function sourceExt(config) {
  return isTypeScript(config) ? 'ts' : 'js';
}

/**
 * @param {object} config
 */
export function jsxExt(config) {
  return isTypeScript(config) ? 'tsx' : 'jsx';
}

/**
 * @param {object} config
 */
export function isReduxState(config) {
  return config.frontend?.state === 'redux';
}

/**
 * @param {object} config
 */
export function isZustandState(config) {
  return config.frontend?.state === 'zustand';
}

/**
 * @param {object} config
 */
export function isNoneState(config) {
  return config.frontend?.state === 'none';
}

/**
 * @param {object} config
 */
export function usesReactHookForm(config) {
  return config.frontend?.forms !== 'none';
}

/**
 * @param {object} config
 */
export function usesFetchClient(config) {
  return config.frontend?.httpClient === 'fetch';
}

/**
 * @param {object} config
 */
export function usesIdentityAuth(config) {
  const value = config.authentication ?? config.backend?.authentication ?? 'none';
  return value === 'identity' || value === 'identity-jwt';
}

/**
 * @param {object} config
 */
export function isAutoMapper(config) {
  return (config.mapping ?? config.backend?.mapping) === 'automapper';
}
