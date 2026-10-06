/**
 * V4 application modules registry and dependency graph.
 */

export const MODULE_GENERATOR_VERSION = '4.0.0';

/** @typedef {'auth'|'users'|'permissions'|'audit'|'notifications'|'localization'|'rich-text'|'dashboard'} ModuleId */

/**
 * @type {Record<ModuleId, {
 *   id: ModuleId,
 *   name: string,
 *   description: string,
 *   requires: ModuleId[],
 *   packages?: { backend?: string[], react?: string[], angular?: string[] }
 * }>}
 */
export const MODULES = {
  auth: {
    id: 'auth',
    name: 'Authentication',
    description: 'Identity + JWT access tokens + HttpOnly refresh cookies',
    summary: 'Adds authentication infrastructure with ASP.NET Identity, JWT access tokens, and HttpOnly refresh cookies.',
    includes: [
      'ASP.NET Identity (User & Role persistence with EF Core)',
      'Authentication services & JWT token generation',
      'HttpOnly refresh cookies & rotation support',
      'Current-user accessor & claims principal integration',
      'Login, registration, token refresh, and logout endpoints',
      'Client-side auth store, login/register forms, and route protection',
    ],
    requires: [],
    requiresBackend: true,
    requiresFrontend: false,
    requiresEfCore: true,
    changesDatabase: true,
    packages: {
      backend: [
        'Microsoft.AspNetCore.Identity.EntityFrameworkCore',
        'Microsoft.AspNetCore.Authentication.JwtBearer',
        'System.IdentityModel.Tokens.Jwt',
      ],
    },
  },
  users: {
    id: 'users',
    name: 'User Management',
    description: 'Admin user search, roles, enable/disable',
    summary: 'Provides administrative user management capabilities, role assignments, and account status controls.',
    includes: [
      'User query & search endpoints (pagination, filtering, sorting)',
      'Account status toggling (enable / disable users)',
      'Role assignment & permission role mapping',
      'Frontend administrative user list, search filters, and edit modals',
    ],
    requires: ['auth'],
    requiresBackend: true,
    requiresFrontend: false,
    requiresEfCore: true,
    changesDatabase: true,
  },
  permissions: {
    id: 'permissions',
    name: 'Permissions',
    description: 'Permission-based authorization policies',
    summary: 'Adds granular permission-based authorization, policy definitions, and role-permission mappings.',
    includes: [
      'Fine-grained permission definitions and constants',
      'Dynamic authorization policy provider & requirement handlers',
      'Role claims & permission seeders for default roles',
      'Permission-protected API endpoint attributes and policies',
    ],
    requires: ['auth'],
    requiresBackend: true,
    requiresFrontend: false,
    requiresEfCore: true,
    changesDatabase: true,
  },
  audit: {
    id: 'audit',
    name: 'Audit Trail',
    description: 'Entity change audit logging with redaction',
    summary: 'Automatically captures entity changes on save, with sensitive field redaction and audit log queries.',
    includes: [
      'AuditTrail & AuditEntry domain and persistence models',
      'Automatic DbContext SaveChanges audit interceptor',
      'Sensitive data redaction (passwords, tokens, keys)',
      'Audit log query endpoints & frontend audit history viewer',
    ],
    requires: [],
    requiresBackend: true,
    requiresFrontend: false,
    requiresEfCore: true,
    changesDatabase: true,
  },
  notifications: {
    id: 'notifications',
    name: 'Notifications',
    description: 'In-app user notifications',
    summary: 'Provides in-app notification persistence, recipient dispatching, and UI notification center.',
    includes: [
      'Notification entity, repository, and persistence models',
      'In-app notification dispatch service (INotificationService)',
      'User notification query, mark-read, and dismiss endpoints',
      'Optional SignalR real-time notification push (when realtime is enabled)',
      'Frontend notification bell, unread badge, and notification center list',
    ],
    requires: ['auth'],
    requiresBackend: true,
    requiresFrontend: false,
    requiresEfCore: true,
    changesDatabase: true,
  },
  localization: {
    id: 'localization',
    name: 'Domain Localization',
    description: 'Entity translation tables and language management',
    summary: 'Supports multi-language entity translation storage and runtime culture resolution.',
    includes: [
      'Language entity & entity translation tables',
      'Localization query service & request culture provider',
      'Default language seeding (en, ar, etc.)',
      'Integration with frontend localization state',
    ],
    requires: [],
    requiresBackend: true,
    requiresFrontend: false,
    requiresEfCore: true,
    changesDatabase: true,
  },
  'rich-text': {
    id: 'rich-text',
    name: 'Rich Text',
    description: 'Structured rich-text documents (Tiptap JSON)',
    summary: 'Adds Tiptap-powered rich-text WYSIWYG editing, document schemas, and toolbar controls.',
    includes: [
      'Tiptap WYSIWYG editor component and formatting toolbar',
      'Structured JSON document schema and renderer',
      'Integration with feature generator rich-text fields',
    ],
    requires: [],
    requiresBackend: false,
    requiresFrontend: true,
    requiresEfCore: false,
    changesDatabase: false,
    packages: {
      react: ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/extension-link'],
    },
  },
  dashboard: {
    id: 'dashboard',
    name: 'Dashboard Foundation',
    description: 'Shared dashboard shell, widgets, and CRUD UI',
    summary: 'Provides a dashboard shell with sidebar navigation, statistic cards, and auto-registration container.',
    includes: [
      'Responsive dashboard layout with sidebar and user header',
      'Key metrics stat cards & recent activity widget',
      'Navigation registry for auto-registering generated features',
    ],
    requires: [],
    requiresBackend: false,
    requiresFrontend: true,
    requiresEfCore: false,
    changesDatabase: false,
  },
};

/**
 * @param {string} id
 * @returns {ModuleId | null}
 */
export function normalizeModuleId(id) {
  const key = String(id ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');

  if (key === 'richtext' || key === 'rich-text') {
    return 'rich-text';
  }

  if (key in MODULES) {
    return /** @type {ModuleId} */ (key);
  }

  return null;
}

/**
 * Resolve transitive dependencies (dependencies first).
 * @param {ModuleId} moduleId
 * @returns {ModuleId[]}
 */
export function resolveModuleInstallOrder(moduleId) {
  /** @type {ModuleId[]} */
  const ordered = [];
  /** @type {Set<string>} */
  const visiting = new Set();
  /** @type {Set<string>} */
  const visited = new Set();

  /**
   * @param {ModuleId} id
   */
  function visit(id) {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new Error(`Circular module dependency involving "${id}".`);
    }
    visiting.add(id);
    const mod = MODULES[id];
    for (const dep of mod.requires) {
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  }

  visit(moduleId);
  return ordered;
}

/**
 * @param {object} manifest
 * @param {ModuleId} moduleId
 */
export function isModuleEnabled(manifest, moduleId) {
  const modules = manifest?.modules ?? {};
  const key = moduleId === 'rich-text' ? 'richText' : moduleId;
  const entry = modules[key] ?? modules[moduleId];
  return Boolean(entry?.enabled);
}

/**
 * Manifest key for a module id.
 * @param {ModuleId} moduleId
 */
export function moduleManifestKey(moduleId) {
  if (moduleId === 'rich-text') {
    return 'richText';
  }
  return moduleId;
}

/**
 * @param {object} manifest
 * @param {ModuleId} moduleId
 */
export function getMissingDependencies(manifest, moduleId) {
  const mod = MODULES[moduleId];
  return mod.requires.filter((dep) => !isModuleEnabled(manifest, dep));
}

/**
 * Default modules block for a new project.
 * @param {object} options
 */
export function buildDefaultModulesBlock(options) {
  const auth = Boolean(options.modules?.auth ?? options.auth);
  const users = Boolean(options.modules?.users ?? (auth && options.userManagement !== false));
  const permissions = Boolean(options.modules?.permissions ?? auth);
  const audit = Boolean(options.modules?.audit);
  const notifications = Boolean(options.modules?.notifications);
  const localization = Boolean(options.modules?.localization ?? options.domainLocalization);
  const richText = Boolean(options.modules?.richText ?? options.richText);
  const dashboard = Boolean(options.modules?.dashboard ?? options.dashboard);

  /**
   * @param {boolean} enabled
   */
  const entry = (enabled) =>
    enabled
      ? { enabled: true, version: MODULE_GENERATOR_VERSION }
      : { enabled: false };

  return {
    auth: entry(auth),
    users: entry(users && auth),
    permissions: entry(permissions && auth),
    audit: entry(audit),
    notifications: entry(notifications && auth),
    localization: entry(localization),
    richText: entry(richText),
    dashboard: entry(dashboard),
  };
}

export function listModuleIds() {
  return Object.keys(MODULES);
}

/**
 * Validate whether a module is compatible with a given Flatron project manifest.
 * @param {string} moduleId
 * @param {object} manifest
 * @returns {{ compatible: boolean, reason?: string }}
 */
export function validateModuleCompatibility(moduleId, manifest) {
  const mod = MODULES[moduleId];
  if (!mod) {
    return {
      compatible: false,
      reason: `Unknown module "${moduleId}".`,
    };
  }

  const isFrontendOnly =
    manifest?.mode === 'frontend-only' || manifest?.backend?.enabled === false;
  const isBackendOnly =
    manifest?.mode === 'backend-only' || manifest?.frontend?.enabled === false;
  const orm = manifest?.backend?.orm ?? 'efcore';

  if (mod.requiresBackend && isFrontendOnly) {
    return {
      compatible: false,
      reason: `The '${mod.name}' module requires a backend project. The current project is frontend-only.`,
    };
  }

  if (mod.requiresFrontend && isBackendOnly) {
    return {
      compatible: false,
      reason: `The '${mod.name}' module requires a frontend project. The current project is backend-only.`,
    };
  }

  if (mod.requiresEfCore && !isFrontendOnly && orm === 'dapper') {
    return {
      compatible: false,
      reason: `The '${mod.name}' module requires EF Core persistence. The current project uses Dapper-only data access.`,
    };
  }

  return { compatible: true };
}

