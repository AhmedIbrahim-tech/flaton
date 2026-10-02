import { runCommandCapture } from './command.js';
import { GenerationError } from './errors.js';

/**
 * @param {string} version
 */
function isPrerelease(version) {
  return /preview|rc|alpha|beta/i.test(version);
}

/**
 * @param {string} a
 * @param {string} b
 */
function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(pa.length, pb.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (pa[index] ?? 0) - (pb[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

/**
 * @returns {string}
 */
function getLatestStableSdkVersion() {
  const result = runCommandCapture('dotnet', ['--list-sdks'], {
    step: 'Detect installed .NET SDKs',
  });
  const versions = (result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().split(' ')[0])
    .filter(Boolean);

  if (versions.length === 0) {
    throw new GenerationError('No .NET SDK is installed. Install a stable .NET SDK and retry.', {
      step: 'Detect installed .NET SDKs',
      command: 'dotnet --list-sdks',
      targetDirectory: process.cwd(),
    });
  }

  const stable = versions.filter((version) => !isPrerelease(version));
  const pool = stable.length > 0 ? stable : versions;
  pool.sort(compareVersions);
  return pool[pool.length - 1];
}

/**
 * @param {string} stdout
 */
function parseTemplateFrameworks(stdout) {
  const match = stdout.match(/--framework <([^>]+)>/);
  if (!match) {
    return [];
  }

  return match[1]
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Detects a target framework that both the installed SDK and the webapi template support.
 * If a specific requested version is provided (e.g. "10", "9", "8" or "net10.0"), normalizes and returns it.
 * Prefers the latest stable SDK major when the template lists that TFM.
 * @param {string} [requested]
 * @returns {string}
 */
export function detectTargetFramework(requested) {
  if (requested) {
    const raw = String(requested).trim().toLowerCase();
    const match = raw.match(/^net?(\d+)(\.0)?$/) || raw.match(/^(\d+)$/);
    if (match) {
      const major = match[1];
      return `net${major}.0`;
    }
    return raw.startsWith('net') ? raw : `net${raw}.0`;
  }

  const sdkVersion = getLatestStableSdkVersion();
  const sdkMajor = Number.parseInt(sdkVersion.split('.')[0] ?? '', 10);

  const help = runCommandCapture('dotnet', ['new', 'webapi', '-h'], {
    step: 'Detect supported webapi frameworks',
  });
  const available = parseTemplateFrameworks(`${help.stdout ?? ''}\n${help.stderr ?? ''}`);
  const frameworks = available.length > 0 ? available : [`net${sdkMajor}.0`];

  const preferred = `net${sdkMajor}.0`;
  if (frameworks.includes(preferred)) {
    return preferred;
  }

  const compatible = frameworks
    .map((tfm) => ({
      tfm,
      major: Number.parseInt((tfm.match(/net(\d+)/) ?? [])[1] ?? '', 10),
    }))
    .filter((item) => Number.isFinite(item.major) && item.major <= sdkMajor)
    .sort((a, b) => a.major - b.major);

  if (compatible.length > 0) {
    return compatible[compatible.length - 1].tfm;
  }

  return frameworks[0];
}

export function assertDotnetAvailable() {
  try {
    runCommandCapture('dotnet', ['--version'], { step: 'Check .NET SDK' });
  } catch (error) {
    throw new GenerationError(
      'The dotnet CLI was not found. Install the .NET SDK and ensure it is on PATH.',
      {
        step: 'Check .NET SDK',
        command: 'dotnet --version',
        targetDirectory: process.cwd(),
      },
    );
  }
}
