import { select, confirm } from '@inquirer/prompts';
import {
  MODULES,
  listModuleIds,
  isModuleEnabled,
  resolveModuleInstallOrder,
  validateModuleCompatibility,
} from './module.registry.js';
import { logger } from '../utils/logger.js';

/**
 * Interactive prompt wizard for Flatron application modules.
 *
 * @param {object} parsed CLI parsed arguments
 * @param {string} projectRoot Project root directory
 * @param {object} manifest Parsed .fullstack-app.json manifest
 * @returns {Promise<object | null>} Resolved options for module generator or null if cancelled
 */
export async function promptModuleOptions(parsed, projectRoot, manifest) {
  let moduleId = parsed.moduleName;

  // 1. Module selection if not passed directly
  if (!moduleId) {
    const choices = listModuleIds().map((id) => {
      const mod = MODULES[id];
      const installed = isModuleEnabled(manifest, id);
      const statusBadge = installed ? 'Installed' : 'Available';
      return {
        name: `${mod.name.padEnd(22)} [${statusBadge.padEnd(9)}]  ${mod.description}`,
        value: id,
      };
    });

    moduleId = await select({
      message: 'Select an application module to install:',
      choices,
    });
  }

  const selectedMod = MODULES[moduleId];
  if (!selectedMod) {
    throw new Error(`Unknown module "${moduleId}".`);
  }

  // 2. Already installed check
  const alreadyInstalled = isModuleEnabled(manifest, moduleId);
  let force = Boolean(parsed.force);

  if (alreadyInstalled && !force) {
    if (parsed.yes) {
      logger.info(`${selectedMod.name} is already installed.`);
      logger.info('Pass --force to reinstall generator-owned module files.');
      return null;
    }

    logger.info(`\n${selectedMod.name} is already installed in this project.`);
    const reinstall = await confirm({
      message: 'Reinstall generator-owned module files with --force?',
      default: false,
    });
    if (!reinstall) {
      logger.info('Operation cancelled.');
      return null;
    }
    force = true;
  }

  // 3. Project compatibility verification
  const compat = validateModuleCompatibility(moduleId, manifest);
  if (!compat.compatible) {
    logger.error(`\nIncompatible module: ${compat.reason}`);
    return null;
  }

  // 4. Resolve dependencies
  const installOrder = resolveModuleInstallOrder(moduleId);
  const missingDeps = installOrder.filter(
    (id) => id !== moduleId && !isModuleEnabled(manifest, id),
  );

  for (const depId of missingDeps) {
    const depCompat = validateModuleCompatibility(depId, manifest);
    if (!depCompat.compatible) {
      logger.error(
        `\nCannot install required dependency '${MODULES[depId].name}': ${depCompat.reason}`,
      );
      return null;
    }
  }

  if (missingDeps.length > 0) {
    const depNames = missingDeps.map((id) => MODULES[id].name).join(', ');
    process.stdout.write(`\n${selectedMod.name} requires: ${depNames}\n`);

    if (parsed.yes) {
      logger.info(`Auto-resolving dependencies with --yes: installing ${depNames} first.`);
    } else {
      const agree = await confirm({
        message: `Install required dependency ${depNames}?`,
        default: true,
      });
      if (!agree) {
        logger.info('Module installation cancelled.');
        return null;
      }
    }
  }

  // 5. Display module details
  process.stdout.write('\n');
  process.stdout.write(`Module: ${selectedMod.name}\n`);
  process.stdout.write(`${selectedMod.summary}\n\n`);
  process.stdout.write('Includes:\n');
  for (const inc of selectedMod.includes) {
    process.stdout.write(`  - ${inc}\n`);
  }
  process.stdout.write('\n');
  process.stdout.write(
    `Dependencies:    ${selectedMod.requires.length > 0 ? selectedMod.requires.map((r) => MODULES[r].name).join(', ') : 'None'}\n`,
  );
  process.stdout.write(`Already installed: ${alreadyInstalled ? 'Yes' : 'No'}\n`);

  // 6. Database / Migration determination
  const relevantModules = installOrder.filter(
    (id) => !isModuleEnabled(manifest, id) || (id === moduleId && force),
  );
  const anyChangesDatabase = relevantModules.some(
    (id) => MODULES[id].changesDatabase,
  );
  const hasEfCore =
    manifest.backend?.enabled !== false &&
    manifest.mode !== 'frontend-only' &&
    manifest.backend?.orm !== 'dapper';

  let createMigration = Boolean(parsed.migration);
  if (!parsed.yes && !parsed.migration && anyChangesDatabase && hasEfCore) {
    createMigration = await confirm({
      message: 'Create EF migration after module installation?',
      default: false,
    });
  }

  // 7. Review installation plan
  process.stdout.write('\n');
  process.stdout.write('--------------------------------------------------\n');
  process.stdout.write('Installation Plan\n');
  process.stdout.write('--------------------------------------------------\n');
  process.stdout.write('Modules to install in order:\n');
  relevantModules.forEach((id, index) => {
    process.stdout.write(`  ${index + 1}. ${MODULES[id].name} (${id})\n`);
  });

  process.stdout.write(
    `Database migration: ${createMigration ? 'Will generate EF migration' : anyChangesDatabase ? 'Manual migration required later' : 'Not required'}\n`,
  );
  process.stdout.write(
    `Project:            ${manifest.mode ?? 'fullstack'} (Backend: ${manifest.backend?.presentation ?? 'none'}, Frontend: ${manifest.frontend?.framework ?? manifest.frontend?.tooling ?? 'none'})\n`,
  );

  const cmdFlags = [];
  if (createMigration) cmdFlags.push('--migration');
  if (force) cmdFlags.push('--force');
  const previewCmd = `flatron create module ${moduleId}${cmdFlags.length > 0 ? ' ' + cmdFlags.join(' ') : ''}`;
  process.stdout.write(`Equivalent command: ${previewCmd}\n`);
  process.stdout.write('--------------------------------------------------\n\n');

  // 8. Final confirmation
  if (!parsed.yes) {
    const confirmed = await confirm({
      message: `Install module${relevantModules.length > 1 ? 's' : ''}?`,
      default: true,
    });
    if (!confirmed) {
      logger.info('Module installation cancelled.');
      return null;
    }
  }

  return {
    moduleName: moduleId,
    projectRoot,
    dryRun: Boolean(parsed.dryRun),
    migration: createMigration,
    force,
    yes: Boolean(parsed.yes),
    defaultRole: parsed.defaultRole ?? 'User',
    roles: parsed.roles ?? ['Admin', 'Editor', 'User'],
  };
}
