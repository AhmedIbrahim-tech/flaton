import { usesIdentityAuth } from '../feature-profile.js';

/**
 * @param {object} config
 */
export function usesPermissionAttributes(config) {
  return usesIdentityAuth(config) && config.permissions === true;
}

/**
 * @param {object} config
 * @param {'View' | 'Create' | 'Update' | 'Delete' | 'Restore'} action
 */
export function methodPermissionAttribute(config, action) {
  if (!usesPermissionAttributes(config)) {
    return '';
  }
  const constant = `${config.feature.pluralName}${action}`;
  return `    [HasPermission(PermissionConstants.${constant})]\n`;
}

/**
 * @param {object} config
 */
export function authorizationUsings(config) {
  if (!usesIdentityAuth(config)) {
    return [];
  }

  const ns = config.projectName;
  const isWeb = config.manifest?.backend?.presentation === 'mvc' || config.manifest?.backend?.presentation === 'razor-pages';
  const attrNs = isWeb ? `${ns}.Web.Attributes` : `${ns}.API.Attributes`;
  const usings = ['using Microsoft.AspNetCore.Authorization;'];
  if (usesPermissionAttributes(config)) {
    usings.push(`using ${attrNs};`);
    usings.push(`using ${ns}.Application.Common.Authorization;`);
  }
  return usings;
}

/**
 * @param {object} config
 */
export function controllerAuthorizationAttribute(config) {
  if (!usesIdentityAuth(config)) {
    return '';
  }
  return '[Authorize]\n';
}
