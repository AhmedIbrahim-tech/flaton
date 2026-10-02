import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { GenerationError } from './errors.js';
export {
  getCreateNextAppPackageManagerFlag,
  add as installPackages,
  run as runPackageScript,
} from './package-manager.js';

const WINDOWS_SHIMS = new Set(['npm', 'npx', 'yarn', 'pnpm', 'pnpx', 'corepack']);

/**
 * @param {'npm' | 'npx'} command
 */
function findNpmCli(command) {
  const cliName = command === 'npx' ? 'npx-cli.js' : 'npm-cli.js';
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', cliName),
    path.join(path.dirname(process.execPath), 'lib', 'node_modules', 'npm', 'bin', cliName),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

/**
 * @returns {string | undefined}
 */
function findCorepackCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js'),
    path.join(path.dirname(process.execPath), 'lib', 'node_modules', 'corepack', 'dist', 'corepack.js'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

/**
 * Resolve a spawn target without interpolating user input into a shell string.
 * @param {string} command
 * @returns {{ file: string, prefix: string[], display: string }}
 */
export function resolveSpawnTarget(command) {
  if (command === 'npm' || command === 'npx') {
    const cli = findNpmCli(command);
    if (cli) {
      return { file: process.execPath, prefix: [cli], display: command };
    }
  }

  if (command === 'yarn' || command === 'pnpm') {
    const corepack = findCorepackCli();
    if (corepack) {
      return { file: process.execPath, prefix: [corepack, command], display: command };
    }
  }

  const file = process.platform === 'win32' && WINDOWS_SHIMS.has(command)
    ? `${command}.cmd`
    : command;

  return { file, prefix: [], display: command };
}

/**
 * @param {string} command
 * @param {string[]} args
 */
export function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

let isVerboseMode = false;

/**
 * @param {boolean} value
 */
export function setVerbose(value) {
  isVerboseMode = Boolean(value);
}

/**
 * @returns {boolean}
 */
export function isVerbose() {
  return isVerboseMode;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, stdio?: import('node:child_process').StdioOptions, env?: NodeJS.ProcessEnv, step?: string, verbose?: boolean }} [options]
 */
export function runCommand(command, args, options = {}) {
  const target = resolveSpawnTarget(command);
  const cwd = options.cwd ?? process.cwd();
  const step = options.step ?? command;
  const verbose = options.verbose ?? isVerboseMode;
  const stdio = options.stdio ?? (verbose ? 'inherit' : ['ignore', 'pipe', 'pipe']);
  const spawnArgs = [...target.prefix, ...args];

  const result = spawnSync(target.file, spawnArgs, {
    cwd,
    env: options.env ?? process.env,
    stdio,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });

  if (result.error) {
    const captured = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const detail = captured ? `\n${captured}` : '';
    throw new GenerationError(`${result.error.message}${detail}`, {
      step,
      command: formatCommand(target.display, args),
      targetDirectory: cwd,
    });
  }

  if (result.status !== 0) {
    const captured = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const detail = captured ? `\n${captured}` : '';
    throw new GenerationError(`${step} failed with exit code ${result.status}.${detail}`, {
      step,
      command: formatCommand(target.display, args),
      targetDirectory: cwd,
    });
  }

  return result;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, step?: string }} [options]
 */
export function runCommandCapture(command, args, options = {}) {
  return runCommand(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    verbose: false,
  });
}

