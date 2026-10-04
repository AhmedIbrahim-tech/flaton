import { runCommandCapture } from './command.js';
import { GenerationError } from './errors.js';

export const CURRENT_DOTNET_VERSION = '10';
export const CURRENT_TARGET_FRAMEWORK = 'net10.0';

/**
 * Returns the target framework to use for .NET generation.
 * If a specific requested framework/version is provided (e.g. from an existing manifest),
 * normalizes and returns it (e.g. "9" -> "net9.0", "net8.0" -> "net8.0") for backward compatibility.
 * Otherwise, returns the central baseline target framework (`net10.0`).
 *
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

  return CURRENT_TARGET_FRAMEWORK;
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

