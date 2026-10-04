import path from 'node:path';
import { writeFile } from '../utils/filesystem.js';
import { readPackageMeta } from '../cli/arguments.js';
import { buildDefaultModulesBlock } from '../module-generator/module.registry.js';
import { resolveProjectPaths } from '../utils/project-paths.js';
import { CURRENT_DOTNET_VERSION, CURRENT_TARGET_FRAMEWORK } from '../utils/dotnet.js';

/**
 * @param {object} options
 */
export async function writeGenerationManifest(options) {
  const pkg = readPackageMeta();
  const backend = options.backend?.enabled || options.backend === true
    ? (typeof options.backend === 'object' ? options.backend : { enabled: true })
    : { enabled: false };
  const frontend = options.frontend?.enabled ? options.frontend : { enabled: false };

  const paths = options.paths ?? resolveProjectPaths({
    backend,
    frontend,
  });

  const modules = buildDefaultModulesBlock({
    auth: Boolean(options.modules?.auth ?? options.auth),
    userManagement: options.modules?.users,
    modules: options.modules,
    audit: options.modules?.audit,
    notifications: options.modules?.notifications,
    domainLocalization: options.modules?.localization ?? options.localization,
    richText: options.modules?.richText,
    dashboard: options.modules?.dashboard ?? options.dashboard,
  });

  // Manifest starts with modules disabled; installEnabledModules flips them
  // after scaffolding so the authoritative state matches installed files.
  const initialModules = Object.fromEntries(
    Object.entries(modules).map(([key, value]) => [
      key,
      value.enabled ? { enabled: false } : { enabled: false },
    ]),
  );

  const manifest = {
    generatorVersion: pkg.version,
    projectName: options.pascalName,
    paths: {
      backend: paths.backend,
      frontend: paths.frontend,
    },
    backend: backend.enabled
      ? {
          enabled: true,
          dotnet: backend.dotnet ?? CURRENT_DOTNET_VERSION,
          targetFramework: backend.targetFramework ?? CURRENT_TARGET_FRAMEWORK,
          presentation: backend.presentation ?? options.presentation ?? 'controllers',
          architecture: backend.architecture ?? options.architecture ?? 'cqrs-mediatr',
          orm: backend.orm ?? options.orm ?? 'efcore',
          database: backend.database ?? options.database ?? (options.sqlServer === false ? 'sqlite' : 'sqlserver'),
          mapping: backend.mapping ?? options.mapping ?? 'manual',
          authentication: backend.authentication ?? 'identity-jwt',
          realtime: backend.realtime ?? 'none',
          logging: backend.logging ?? 'serilog',
          backgroundJobs: backend.backgroundJobs ?? 'none',
        }
      : {
          enabled: false,
          dotnet: null,
          targetFramework: null,
          presentation: null,
          architecture: null,
          orm: null,
          database: null,
          mapping: null,
          authentication: null,
          realtime: null,
        },
    frontend: frontend.enabled
      ? {
          enabled: true,
          library: frontend.library,
          framework: frontend.framework,
          language: frontend.language ?? 'typescript',
          styling: frontend.styling ?? 'tailwind',
          state: frontend.state ?? (frontend.library === 'angular' ? 'ngrx' : 'redux'),
          httpClient: frontend.httpClient ?? (frontend.library === 'angular' ? 'httpclient' : 'axios'),
          forms: frontend.forms ?? (frontend.library === 'angular' ? 'reactive-forms' : 'react-hook-form-zod'),
          componentSystem: frontend.componentSystem ?? (frontend.styling === 'tailwind' && frontend.library === 'react' ? 'shadcn' : 'none'),
          localization: Boolean(frontend.localization),
          realtime: frontend.realtime ?? 'none',
        }
      : {
          enabled: false,
          library: null,
          framework: null,
          language: null,
          styling: null,
          state: null,
          httpClient: null,
          forms: null,
          componentSystem: null,
          localization: false,
          realtime: null,
        },
    packageManager: options.packageManager,
    modules: initialModules,
  };

  await writeFile(
    path.join(options.targetDirectory, '.fullstack-app.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
