import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  MODULES,
  MODULE_GENERATOR_VERSION,
  listModuleIds,
  moduleManifestKey,
  isModuleEnabled,
  getMissingDependencies,
  resolveModuleInstallOrder,
  normalizeModuleId,
} from './module.registry.js';
import {
  findProjectRoot,
  readManifest,
  writeManifest,
  resolveFrontendStrategy,
} from '../feature-generator/utils/manifest.js';
import { pathExists, writeFile, ensureDir } from '../utils/filesystem.js';
import { runCommand } from '../utils/command.js';
import { add as installNpmPackages } from '../utils/package-manager.js';
import { logger } from '../utils/logger.js';
import { planAuthBackend, planAuthRegistryUpdates, getAuthAppsettingsPatch, AUTH_BACKEND_ORCHESTRATION_NOTES, authBackendConflictPaths } from './auth/auth-backend.generator.js';
import { assertBackendCompatibility } from '../models/backend.js';
import { planAuthFrontend } from './auth/auth-frontend.generator.js';
import { patchProgramForAuth } from './auth/auth-program-patch.js';
import { planUsersModule } from './users/users.generator.js';
import { planPermissionsModule } from './permissions/permissions.generator.js';
import { planAuditModule } from './audit/audit.generator.js';
import { planNotificationsModule } from './notifications/notifications.generator.js';
import { planLocalizationModule } from './localization/localization.generator.js';
import { planRichTextModule } from './rich-text/rich-text.generator.js';
import { planDashboardModule } from './dashboard/dashboard.generator.js';
import { finalizePlan, setModuleManifestContext } from './modules-orchestrator-helpers.js';
import { getBackendDirectory, getFrontendDirectory } from '../utils/project-paths.js';
import { upsertUsing } from '../utils/csharp-source.js';
import { upsertInfrastructureRegistration } from '../feature-generator/backend/clean-architecture.js';

const MIGRATION_NAMES = {
  auth: 'AddAuthentication',
  permissions: 'AddPermissions',
  audit: 'AddAuditTrail',
  notifications: 'AddNotifications',
  localization: 'AddLocalization',
  users: 'AddUsersModule',
  'rich-text': 'AddRichText',
  dashboard: 'AddDashboard',
};

/**
 * @param {string} cwd
 */
export async function listModulesCli(cwd) {
  for (const id of listModuleIds()) {
    process.stdout.write(`${id}\n`);
  }
}

/**
 * @param {string} cwd
 */
export async function printModuleStatus(cwd) {
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    throw new Error('This directory is not a generate-fullstack-app project.');
  }
  const manifest = await readManifest(projectRoot);
  const labels = {
    auth: 'Authentication',
    users: 'Users',
    permissions: 'Permissions',
    audit: 'Audit',
    notifications: 'Notifications',
    localization: 'Localization',
    'rich-text': 'Rich Text',
    dashboard: 'Dashboard',
  };

  for (const id of listModuleIds()) {
    const enabled = isModuleEnabled(manifest, id);
    const label = (labels[id] ?? id).padEnd(18);
    process.stdout.write(`${label} ${enabled ? 'ENABLED' : 'DISABLED'}\n`);
  }
}

/**
 * @param {object} options
 */
export async function generateModule(options) {
  const projectRoot =
    options.projectRoot ?? (await findProjectRoot(process.cwd()));
  if (!projectRoot) {
    throw new Error('This directory is not a generate-fullstack-app project.');
  }

  const moduleId = normalizeModuleId(options.moduleName);
  if (!moduleId) {
    throw new Error(`Unknown module "${options.moduleName}".`);
  }

  const manifest = await readManifest(projectRoot);
  setModuleManifestContext(manifest);
  const frontendStrategy = resolveFrontendStrategy(manifest);
  const projectName = inferProjectName(projectRoot, manifest);

  if (isModuleEnabled(manifest, moduleId) && !options.force) {
    logger.info(`${MODULES[moduleId].name} is already enabled.`);
    logger.info('Pass --force to reinstall generator-owned module files.');
    return { skipped: true, reason: 'already-enabled', moduleId };
  }

  const missing = getMissingDependencies(manifest, moduleId);
  if (missing.length > 0) {
    const depNames = missing.map((id) => MODULES[id].name).join(', ');
    if (options.yes) {
      throw new Error(
        `${MODULES[moduleId].name} requires ${depNames}. Enable those modules first (or omit --yes to be prompted).`,
      );
    }
    const proceed = await confirm({
      message: `${MODULES[moduleId].name} requires ${depNames}. Enable required modules first?`,
      default: true,
    });
    if (!proceed) {
      logger.info('Module installation cancelled.');
      return { skipped: true, reason: 'missing-dependencies', moduleId, missing };
    }
  }

  const installOrder = resolveModuleInstallOrder(moduleId).filter(
    (id) => !isModuleEnabled(manifest, id) || (id === moduleId && options.force),
  );

  /** @type {object[]} */
  const plans = [];
  for (const id of installOrder) {
    const plan = await planModule(id, {
      projectName,
      projectRoot,
      manifest,
      frontendStrategy,
      defaultRole: options.defaultRole ?? 'User',
      roles: options.roles ?? ['Admin', 'Editor', 'User'],
      dryRun: options.dryRun,
      force: options.force,
      packageManager: manifest.packageManager ?? 'npm',
    });
    plans.push(plan);
  }

  if (options.dryRun) {
    printDryRun(moduleId, plans, manifest);
    return { dryRun: true, moduleId, plans };
  }

  /** @type {{ method: string, namespace: string }[]} */
  const allRegistrations = [];
  /** @type {string[]} */
  const allNotes = [];

  for (const plan of plans) {
    await writePlanFiles(projectRoot, plan, Boolean(options.force));
    await applyRegistryUpdates(projectRoot, plan);
    allRegistrations.push(...(plan.registrations ?? []));
    allNotes.push(...(plan.notes ?? []));

    if (plan.id === 'auth') {
      await applyAuthOrchestration(projectRoot, projectName, frontendStrategy, manifest);
    }

    await installPlanPackages(projectRoot, plan, manifest.packageManager ?? 'npm', frontendStrategy, manifest);
    markModuleEnabled(manifest, plan.id);
  }

  await syncInfrastructureRegistrations(projectRoot, projectName, allRegistrations, manifest);
  manifest.generatorVersion = MODULE_GENERATOR_VERSION;
  await writeManifest(projectRoot, manifest);

  if (options.migration) {
    await createModuleMigration(projectRoot, projectName, moduleId, manifest);
  }

  logger.success(`Module "${moduleId}" installed.`);
  for (const note of allNotes) {
    logger.info(note);
  }
  if (!options.migration) {
    const migrationName = MIGRATION_NAMES[moduleId] ?? `Add${pascal(moduleId)}`;
    logger.info(
      `Create an EF migration when ready: create-fullstack-module ${moduleId} --migration (or dotnet ef migrations add ${migrationName}). Database update is never run automatically.`,
    );
  }

  return { moduleId, plans, manifest };
}

/**
 * Install multiple modules (used by project creation).
 * @param {object} options
 */
export async function installEnabledModules(options) {
  const { projectRoot, moduleIds, yes = true } = options;
  for (const id of moduleIds) {
    if (!id) continue;
    await generateModule({
      projectRoot,
      moduleName: id,
      yes,
      defaultRole: options.defaultRole,
      roles: options.roles,
      migration: false,
      force: false,
    });
  }
}

/**
 * @param {import('./module.registry.js').ModuleId} moduleId
 * @param {object} config
 */
async function planModule(moduleId, config) {
  if (config.manifest) {
    setModuleManifestContext(config.manifest);
  }
  switch (moduleId) {
    case 'auth':
      return planAuthCombined(config);
    case 'users':
      return planUsersModule(config);
    case 'permissions':
      return planPermissionsModule(config);
    case 'audit':
      return planAuditModule(config);
    case 'notifications':
      return planNotificationsModule(config);
    case 'localization':
      return planLocalizationModule(config);
    case 'rich-text':
      return planRichTextModule(config);
    case 'dashboard':
      return planDashboardModule(config);
    default:
      throw new Error(`No planner for module "${moduleId}".`);
  }
}

/**
 * @param {object} config
 */
function planAuthCombined(config) {
  const orm = config.manifest?.backend?.orm ?? 'efcore';
  assertBackendCompatibility({
    orm,
    authentication: config.manifest?.backend?.authentication ?? 'identity-jwt',
  });
  if (orm === 'dapper') {
    throw new Error(
      'Cannot install Authentication on a Dapper-only project. Identity requires EF Core. Use --orm efcore or --orm efcore-dapper.',
    );
  }

  const backendFiles = planAuthBackend(config);
  const frontend = config.frontendStrategy?.library
    ? planAuthFrontend(config)
    : { files: [], registryUpdates: [] };

  return finalizePlan({
    id: 'auth',
    requires: [],
    files: [...backendFiles, ...(frontend.files ?? [])],
    registryUpdates: [
      ...planAuthRegistryUpdates(config),
      ...(frontend.registryUpdates ?? []),
    ],
    registrations: [],
    packages: {
      backend: MODULES.auth.packages?.backend ?? [],
      react: [],
      angular: [],
    },
    notes: AUTH_BACKEND_ORCHESTRATION_NOTES,
  });
}

/**
 * @param {string} projectRoot
 * @param {object} plan
 * @param {boolean} force
 */
async function writePlanFiles(projectRoot, plan, force) {
  for (const file of plan.files ?? []) {
    const absolute = path.join(projectRoot, file.relativePath);
    const mode = file.writeMode ?? 'create';

    if (mode === 'ifMissing' && (await pathExists(absolute)) && !force) {
      continue;
    }

    if (mode === 'create' && (await pathExists(absolute)) && !force) {
      // Allow overwrite for generator-owned .g.cs / module files when installing fresh
      if (!/\.g\.(cs|ts|tsx)$/.test(file.relativePath) && !force) {
        // Still write for first install of module-owned paths
      }
    }

    await writeFile(absolute, file.contents);
  }
}

/**
 * @param {string} projectRoot
 * @param {object} plan
 */
async function applyRegistryUpdates(projectRoot, plan) {
  for (const update of plan.registryUpdates ?? []) {
    const absolute = path.join(projectRoot, update.relativePath);
    let existing = '';
    if (await pathExists(absolute)) {
      existing = await fs.readFile(absolute, 'utf8');
    } else {
      await ensureDir(path.dirname(absolute));
    }
    const next = update.update(existing);
    await writeFile(absolute, next);
  }
}

/**
 * @param {string} projectRoot
 * @param {string} projectName
 * @param {{ library?: string|null, framework?: string|null }} frontendStrategy
 * @param {object} [manifest]
 */
async function applyAuthOrchestration(projectRoot, projectName, frontendStrategy, manifest) {
  await patchIdentityDbContext(projectRoot, projectName, manifest);
  await patchProgramCs(projectRoot, manifest);
  await mergeAuthAppsettings(projectRoot, frontendStrategy, manifest);
  await ensureAuthPackages(projectRoot, manifest);
  await ensureCorsAllowCredentials(projectRoot, frontendStrategy, manifest);
}

/**
 * @param {string} projectRoot
 * @param {string} projectName
 * @param {object} [manifest]
 */
async function patchIdentityDbContext(projectRoot, projectName, manifest) {
  const backendDir = getBackendDirectory(projectRoot, manifest) ?? projectRoot;
  const dbContextPath = path.join(
    backendDir,
    'Infrastructure',
    'Persistence',
    'ApplicationDbContext.cs',
  );
  if (!(await pathExists(dbContextPath))) {
    logger.info('ApplicationDbContext.cs not found — skip Identity base class patch.');
    return;
  }

  let contents = await fs.readFile(dbContextPath, 'utf8');
  if (contents.includes('IdentityDbContext<')) {
    return;
  }

  if (!contents.includes(`using ${projectName}.Infrastructure.Identity;`)) {
    contents = contents.replace(
      /(using .+;\r?\n)(?!using)/,
      `$1using ${projectName}.Infrastructure.Identity;\nusing Microsoft.AspNetCore.Identity.EntityFrameworkCore;\n`,
    );
  } else if (!contents.includes('Microsoft.AspNetCore.Identity.EntityFrameworkCore')) {
    contents = `using Microsoft.AspNetCore.Identity.EntityFrameworkCore;\n${contents}`;
  }

  contents = contents.replace(
    /public (?:partial )?class ApplicationDbContext\s*:\s*DbContext\s*,\s*IApplicationDbContext/,
    'public class ApplicationDbContext : IdentityDbContext<ApplicationUser, ApplicationRole, Guid>, IApplicationDbContext',
  );

  await writeFile(dbContextPath, contents);
  logger.success('ApplicationDbContext upgraded to IdentityDbContext');
}

/**
 * @param {string} projectRoot
 * @param {object} [manifest]
 */
async function patchProgramCs(projectRoot, manifest) {
  const backendDir = getBackendDirectory(projectRoot, manifest) ?? projectRoot;
  const presentation = manifest?.backend?.presentation ?? 'controllers';
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const presentationFolder = isWeb ? 'Web' : 'API';
  const programPath = path.join(backendDir, presentationFolder, 'Program.cs');
  if (!(await pathExists(programPath))) {
    return;
  }
  const existing = await fs.readFile(programPath, 'utf8');
  const result = patchProgramForAuth(existing);
  if (presentation === 'minimal-api') {
    const projectName = manifest?.displayName ?? manifest?.name ?? 'App';
    const authEndpointsUsing = `using ${projectName}.API.Endpoints.Authentication;`;
    if (!result.contents.includes(authEndpointsUsing)) {
      result.contents = `${authEndpointsUsing}\n${result.contents}`;
      result.changed = true;
    }
    if (!result.contents.includes('MapAuthenticationEndpoints()')) {
      result.contents = result.contents.replace(/app\.Run\(\);/, 'app.MapAuthenticationEndpoints();\napp.Run();');
      result.changed = true;
    }
  }
  if (result.changed) {
    await writeFile(programPath, result.contents);
    logger.success(`Program.cs patched (${result.applied.join(', ')})`);
  }
}

/**
 * @param {string} projectRoot
 * @param {{ library?: string|null, framework?: string|null }} frontendStrategy
 * @param {object} [manifest]
 */
async function mergeAuthAppsettings(projectRoot, frontendStrategy, manifest) {
  const backendDir = getBackendDirectory(projectRoot, manifest) ?? projectRoot;
  const presentation = manifest?.backend?.presentation ?? 'controllers';
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const presentationFolder = isWeb ? 'Web' : 'API';
  const appsettingsPath = path.join(backendDir, presentationFolder, 'appsettings.json');
  const devPath = path.join(backendDir, presentationFolder, 'appsettings.Development.json');

  if (await pathExists(appsettingsPath)) {
    const current = JSON.parse(await fs.readFile(appsettingsPath, 'utf8'));
    const patched = deepMerge(current, getAuthAppsettingsPatch());
    const origin = defaultOrigin(frontendStrategy);
    patched.Cors = patched.Cors ?? {};
    patched.Cors.AllowedOrigins = patched.Cors.AllowedOrigins ?? [origin];
    patched.Cors.AllowCredentials = true;
    await writeFile(appsettingsPath, `${JSON.stringify(patched, null, 2)}\n`);
  }

  if (await pathExists(devPath)) {
    const current = JSON.parse(await fs.readFile(devPath, 'utf8'));
    const origin = defaultOrigin(frontendStrategy);
    const patch = {
      RefreshToken: {
        Secure: false,
        SameSite: 'Lax',
      },
      Cors: {
        AllowedOrigins: [origin],
        AllowCredentials: true,
      },
      Jwt: {
        SigningKey: 'development-only-signing-key-change-me-32b',
      },
    };
    await writeFile(devPath, `${JSON.stringify(deepMerge(current, patch), null, 2)}\n`);
  } else {
    const origin = defaultOrigin(frontendStrategy);
    await writeFile(
      devPath,
      `${JSON.stringify(
        {
          RefreshToken: { Secure: false, SameSite: 'Lax' },
          Cors: { AllowedOrigins: [origin], AllowCredentials: true },
          Jwt: { SigningKey: 'development-only-signing-key-change-me-32b' },
        },
        null,
        2,
      )}\n`,
    );
  }
}

/**
 * @param {{ library?: string|null, framework?: string|null }} frontendStrategy
 */
function defaultOrigin(frontendStrategy) {
  if (frontendStrategy?.library === 'angular') return 'http://localhost:4200';
  if (frontendStrategy?.framework === 'vite') return 'http://localhost:5173';
  return 'http://localhost:3000';
}

/**
 * @param {string} projectRoot
 * @param {object} [manifest]
 */
async function ensureAuthPackages(projectRoot, manifest) {
  const backendDir = getBackendDirectory(projectRoot, manifest) ?? projectRoot;
  const presentation = manifest?.backend?.presentation ?? 'controllers';
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const presentationFolder = isWeb ? 'Web' : 'API';
  const authMode = manifest?.backend?.authentication ?? 'identity-jwt';
  const isJwt = authMode === 'identity-jwt';
  const infraCsproj = path.join(backendDir, 'Infrastructure', 'Infrastructure.csproj');
  const presentationCsproj = path.join(backendDir, presentationFolder, `${presentationFolder}.csproj`);
  const appCsproj = path.join(backendDir, 'Application', 'Application.csproj');

  const packages = [
    {
      project: infraCsproj,
      packages: [
        'Microsoft.AspNetCore.Identity.EntityFrameworkCore',
        ...(isJwt ? ['Microsoft.AspNetCore.Authentication.JwtBearer', 'System.IdentityModel.Tokens.Jwt'] : []),
      ],
    },
    ...(isJwt && presentationFolder === 'API'
      ? [
          {
            project: presentationCsproj,
            packages: ['Microsoft.AspNetCore.Authentication.JwtBearer'],
          },
        ]
      : []),
    {
      project: appCsproj,
      packages: ['Microsoft.AspNetCore.Authorization'],
    },
  ];

  for (const entry of packages) {
    if (!(await pathExists(entry.project))) continue;
    for (const pkg of entry.packages) {
      const contents = await fs.readFile(entry.project, 'utf8');
      if (contents.includes(pkg)) continue;
      runCommand('dotnet', ['add', entry.project, 'package', pkg], {
        cwd: backendDir,
        step: `Add ${pkg}`,
      });
    }
  }

  if (await pathExists(infraCsproj)) {
    let contents = await fs.readFile(infraCsproj, 'utf8');
    if (!contents.includes('Microsoft.AspNetCore.App')) {
      contents = contents.replace(
        /<\/Project>/,
        `  <ItemGroup>\n    <FrameworkReference Include="Microsoft.AspNetCore.App" />\n  </ItemGroup>\n</Project>`,
      );
      await writeFile(infraCsproj, contents);
    }
  }
}

/**
 * @param {string} projectRoot
 * @param {{ library?: string|null, framework?: string|null }} frontendStrategy
 * @param {object} [manifest]
 */
async function ensureCorsAllowCredentials(projectRoot, frontendStrategy, manifest) {
  const backendDir = getBackendDirectory(projectRoot, manifest) ?? projectRoot;
  const presentation = manifest?.backend?.presentation ?? 'controllers';
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const presentationFolder = isWeb ? 'Web' : 'API';
  const programPath = path.join(backendDir, presentationFolder, 'Program.cs');
  if (!(await pathExists(programPath))) return;
  let contents = await fs.readFile(programPath, 'utf8');
  if (contents.includes('AllowCredentials()')) return;

  if (contents.includes('AllowAnyOrigin()')) {
    contents = contents.replace(
      /policy\s*=>\s*policy[\s\S]*?AllowAnyOrigin\(\)[\s\S]*?;/,
      `policy =>
            {
                var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
                    ?? new[] { "${defaultOrigin(frontendStrategy)}" };
                policy.WithOrigins(origins)
                    .AllowAnyHeader()
                    .AllowAnyMethod()
                    .AllowCredentials();
            });`,
    );
    await writeFile(programPath, contents);
    logger.success('CORS updated for credentialed refresh cookies');
  }
}

/**
 * @param {string} projectRoot
 * @param {object} plan
 * @param {string} packageManager
 * @param {{ library?: string|null }} frontendStrategy
 * @param {object} [manifest]
 */
async function installPlanPackages(projectRoot, plan, packageManager, frontendStrategy, manifest) {
  const clientDir = getFrontendDirectory(projectRoot, manifest);
  if (!clientDir || !(await pathExists(clientDir))) return;

  const packages = [];
  if (frontendStrategy?.library === 'react') {
    packages.push(...(plan.packages?.react ?? []));
  }
  if (frontendStrategy?.library === 'angular') {
    packages.push(...(plan.packages?.angular ?? []));
  }

  if (packages.length === 0) return;
  installNpmPackages(packageManager, packages, {
    cwd: clientDir,
    step: `Install frontend packages for ${plan.id}`,
  });
}

/**
 * @param {string} projectRoot
 * @param {string} projectName
 * @param {{ method: string, namespace: string }[]} registrations
 * @param {object} [manifest]
 */
async function syncInfrastructureRegistrations(projectRoot, projectName, registrations, manifest) {
  const backendDir = getBackendDirectory(projectRoot, manifest) ?? projectRoot;
  const target = path.join(
    backendDir,
    'Infrastructure',
    'DependencyInjection',
    'InfrastructureServiceExtensions.cs',
  );

  const legacyFiles = [
    path.join(backendDir, 'Infrastructure', 'DependencyInjection.Generated.g.cs'),
    path.join(backendDir, 'Infrastructure', 'DependencyInjection.Modules.g.cs'),
  ];

  /** @type {{ method: string, namespace: string }[]} */
  const unique = [];
  const seen = new Set();

  let existing = '';
  if (await pathExists(target)) {
    existing = await fs.readFile(target, 'utf8');
    const methodMatches = [...existing.matchAll(/services\.(Add\w+Module)\s*\(/g)].map(
      (m) => m[1],
    );
    for (const method of methodMatches) {
      if (seen.has(method)) continue;
      seen.add(method);
      const fromPlan = registrations.find((r) => r.method === method);
      unique.push({
        method,
        namespace: fromPlan?.namespace ?? namespaceForModuleMethod(projectName, method),
      });
    }
  }

  for (const legacy of legacyFiles) {
    if (!(await pathExists(legacy))) {
      continue;
    }
    const legacyContents = await fs.readFile(legacy, 'utf8');
    const methodMatches = [...legacyContents.matchAll(/services\.(Add\w+Module)\s*\(/g)].map(
      (m) => m[1],
    );
    for (const method of methodMatches) {
      if (seen.has(method)) continue;
      seen.add(method);
      const fromPlan = registrations.find((r) => r.method === method);
      unique.push({
        method,
        namespace: fromPlan?.namespace ?? namespaceForModuleMethod(projectName, method),
      });
    }
    await fs.unlink(legacy);
  }

  for (const reg of registrations) {
    if (seen.has(reg.method)) continue;
    seen.add(reg.method);
    unique.push(reg);
  }

  if (!unique.length) {
    return;
  }

  let contents = existing;
  for (const reg of unique) {
    contents = upsertUsing(contents, `using ${reg.namespace};`);
    contents = upsertInfrastructureRegistration(
      contents,
      projectName,
      [],
      `        services.${reg.method}();`,
    );
  }

  await writeFile(target, contents);
}

/**
 * @param {string} projectName
 * @param {string} method
 */
function namespaceForModuleMethod(projectName, method) {
  const modulePart = method.replace(/^Add/, '').replace(/Module$/, '');
  return `${projectName}.Infrastructure.DependencyInjection`;
}

/**
 * @param {object} manifest
 * @param {string} moduleId
 */
function markModuleEnabled(manifest, moduleId) {
  manifest.modules = manifest.modules ?? {};
  const key = moduleManifestKey(moduleId);
  manifest.modules[key] = {
    enabled: true,
    version: MODULE_GENERATOR_VERSION,
  };
}

/**
 * @param {string} projectRoot
 * @param {string} projectName
 * @param {string} moduleId
 * @param {object} [manifest]
 */
async function createModuleMigration(projectRoot, projectName, moduleId, manifest) {
  if (manifest?.backend?.orm === 'dapper') {
    logger.info('Skipping EF migration because this project uses Dapper-only data access.');
    return;
  }
  const name = MIGRATION_NAMES[moduleId] ?? `Add${pascal(moduleId)}`;
  const backendDir = getBackendDirectory(projectRoot, manifest) ?? projectRoot;
  const infra = path.join(backendDir, 'Infrastructure');
  const api = path.join(backendDir, 'API');
  if (!(await pathExists(infra)) || !(await pathExists(api))) {
    logger.info('Skipping migration — backend projects not found.');
    return;
  }

  runCommand(
    'dotnet',
    [
      'ef',
      'migrations',
      'add',
      name,
      '--project',
      infra,
      '--startup-project',
      api,
      '--output-dir',
      'Persistence/Migrations',
    ],
    {
      cwd: backendDir,
      step: `Create migration ${name}`,
    },
  );
  logger.success(`Migration ${name} created (database update was NOT applied).`);
}

/**
 * @param {string} moduleId
 * @param {object[]} plans
 * @param {object} manifest
 */
function printDryRun(moduleId, plans, manifest) {
  process.stdout.write(`\nDry run for module: ${moduleId}\n`);
  process.stdout.write(`Generator version: ${MODULE_GENERATOR_VERSION}\n\n`);

  for (const plan of plans) {
    process.stdout.write(`## ${plan.id}\n`);
    process.stdout.write(`Files: ${plan.files?.length ?? 0}\n`);
    for (const file of plan.files ?? []) {
      process.stdout.write(`  + ${file.relativePath}${file.writeMode ? ` (${file.writeMode})` : ''}\n`);
    }
    if (plan.registryUpdates?.length) {
      process.stdout.write('Registry updates:\n');
      for (const update of plan.registryUpdates) {
        process.stdout.write(`  ~ ${update.relativePath}\n`);
      }
    }
    if (plan.registrations?.length) {
      process.stdout.write('DI registrations:\n');
      for (const reg of plan.registrations) {
        process.stdout.write(`  * ${reg.method}()\n`);
      }
    }
    if (plan.packages?.backend?.length) {
      process.stdout.write(`Backend packages: ${plan.packages.backend.join(', ')}\n`);
    }
    if (plan.packages?.react?.length) {
      process.stdout.write(`React packages: ${plan.packages.react.join(', ')}\n`);
    }
    if (plan.notes?.length) {
      process.stdout.write('Notes:\n');
      for (const note of plan.notes) {
        process.stdout.write(`  - ${note}\n`);
      }
    }
    process.stdout.write('\n');
  }

  process.stdout.write('Manifest changes:\n');
  for (const plan of plans) {
    process.stdout.write(
      `  modules.${moduleManifestKey(plan.id)} = { enabled: true, version: "${MODULE_GENERATOR_VERSION}" }\n`,
    );
  }
  process.stdout.write(
    `\nRecommended migration: ${MIGRATION_NAMES[moduleId] ?? `Add${pascal(moduleId)}`}\n`,
  );
  process.stdout.write('(No filesystem changes were made.)\n');
}

/**
 * @param {string} projectRoot
 * @param {object} manifest
 */
function inferProjectName(projectRoot, manifest) {
  if (manifest.projectName) return manifest.projectName;
  const folder = path.basename(projectRoot);
  return folder.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}

/**
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        /** @type {Record<string, unknown>} */ (target[key]),
        /** @type {Record<string, unknown>} */ (value),
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * @param {string} value
 */
function pascal(value) {
  return String(value)
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export { findProjectRoot, authBackendConflictPaths };
