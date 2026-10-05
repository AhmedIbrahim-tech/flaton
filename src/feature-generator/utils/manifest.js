import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathExists } from '../../utils/filesystem.js';

const MANIFEST_NAME = '.fullstack-app.json';
const MAX_PARENT_LEVELS = 5;

/**
 * Traverses upwards to locate the directory containing `.fullstack-app.json`.
 * @param {string} startDir
 * @returns {Promise<string | null>}
 */
export async function findProjectRoot(startDir) {
  if (!startDir) return null;
  let current = path.resolve(startDir);

  for (let level = 0; level <= MAX_PARENT_LEVELS; level += 1) {
    const candidate = path.join(current, MANIFEST_NAME);
    if (await pathExists(candidate)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return null;
}

/**
 * Reads and parses `.fullstack-app.json` from the project root.
 * @param {string} projectRoot
 * @returns {Promise<object>}
 */
export async function readManifest(projectRoot) {
  if (!projectRoot) {
    throw new Error('Project root directory is required to read manifest.');
  }
  const manifestPath = path.join(projectRoot, MANIFEST_NAME);
  if (!(await pathExists(manifestPath))) {
    throw new Error(
      `Project manifest not found at "${manifestPath}". Ensure you are running this command inside a Flatron project root.`,
    );
  }
  const raw = await fs.readFile(manifestPath, 'utf8');
  try {
    const manifest = JSON.parse(raw);
    if (!manifest || typeof manifest !== 'object') {
      throw new Error(`Invalid manifest format in "${manifestPath}". Expected a JSON object.`);
    }
    return manifest;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Malformed JSON in manifest at "${manifestPath}": ${error.message}`);
    }
    throw error;
  }
}

/**
 * Writes the manifest to `.fullstack-app.json`.
 * @param {string} projectRoot
 * @param {object} manifest
 */
export async function writeManifest(projectRoot, manifest) {
  if (!projectRoot) {
    throw new Error('Project root directory is required to write manifest.');
  }
  const manifestPath = path.join(projectRoot, MANIFEST_NAME);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest ?? {}, null, 2)}\n`, 'utf8');
}

/**
 * Resolves frontend library and framework strategy from manifest.
 * @param {object} [manifest]
 * @returns {{ library: string | null, framework: string | null }}
 */
export function resolveFrontendStrategy(manifest) {
  const safeManifest = manifest && typeof manifest === 'object' ? manifest : {};
  const frontend = safeManifest.frontend && typeof safeManifest.frontend === 'object' ? safeManifest.frontend : {};
  const library = frontend.library ?? null;
  const framework = frontend.framework ?? null;

  if (library === 'react' && framework === 'next') {
    return { library: 'react', framework: 'next' };
  }

  if (library === 'react' && framework === 'vite') {
    return { library: 'react', framework: 'vite' };
  }

  if (library === 'angular') {
    return { library: 'angular', framework: null };
  }

  return { library, framework };
}
