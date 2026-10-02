import path from 'node:path';
import { runCommand, runCommandCapture } from '../utils/command.js';
import { logger } from '../utils/logger.js';

/**
 * @param {{ pascalName: string, targetDirectory: string, backendDirectory?: string, paths?: { backend?: string } }} options
 */
export async function generateSolution(options) {
  const backendDir = options.backendDirectory ?? (options.paths?.backend
    ? (options.paths.backend === '.' ? options.targetDirectory : path.join(options.targetDirectory, options.paths.backend))
    : options.targetDirectory);

  const slnFile = `${options.pascalName}.slnx`;
  const presentation = options.backend?.presentation ?? options.presentation ?? 'controllers';
  const presentationFolder = (presentation === 'mvc' || presentation === 'razor-pages') ? 'Web' : 'API';
  const projects = [
    path.join(presentationFolder, `${presentationFolder}.csproj`),
    path.join('Application', 'Application.csproj'),
    path.join('Domain', 'Domain.csproj'),
    path.join('Infrastructure', 'Infrastructure.csproj'),
  ];

  runCommand('dotnet', ['new', 'sln', '--name', options.pascalName, '--format', 'slnx', '--force'], {
    cwd: backendDir,
    step: 'Create solution',
  });

  const listed = runCommandCapture('dotnet', ['sln', slnFile, 'list'], {
    cwd: backendDir,
    step: 'List solution projects',
  });
  const listedText = `${listed.stdout ?? ''}\n${listed.stderr ?? ''}`.replaceAll('\\', '/');
  const missing = projects.filter((relative) => !listedText.includes(relative.replaceAll('\\', '/')));

  if (missing.length > 0) {
    runCommand('dotnet', ['sln', slnFile, 'add', ...missing], {
      cwd: backendDir,
      step: 'Add projects to solution',
    });
  }

  logger.success('Solution references configured');
}
