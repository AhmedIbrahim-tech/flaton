import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathExists } from '../../utils/filesystem.js';
import { getBackendDirectory } from '../../utils/project-paths.js';

const RESERVED_ENTITY_FILENAMES = new Set([
  'baseentity.cs',
  'auditableentity.cs',
  'entity.cs',
  'aggregateroot.cs',
  'iauditableentity.cs',
  'isoftdelete.cs',
]);

/**
 * Discovers existing entities / feature names in a Flatron project.
 * Combines:
 *  1. Features recorded in .fullstack-app.json (manifest.features)
 *  2. Entities defined in Backend Domain/Entities/ directory
 *  3. Built-in module entities (User, Role) if authentication is enabled
 *
 * @param {string} projectRoot
 * @param {object} manifest
 * @returns {Promise<string[]>}
 */
export async function discoverExistingEntities(projectRoot, manifest = {}) {
  const entitySet = new Set();

  // 1. Manifest features
  const features = manifest.features ?? {};
  for (const [key, value] of Object.entries(features)) {
    if (value && typeof value === 'object' && value.entity) {
      entitySet.add(String(value.entity));
    } else if (key) {
      entitySet.add(key.charAt(0).toUpperCase() + key.slice(1));
    }
  }

  // 2. Built-in entities if auth module / backend auth is active
  const hasAuth =
    manifest.modules?.auth?.enabled ||
    manifest.modules?.users?.enabled ||
    (manifest.backend && manifest.backend.authentication && manifest.backend.authentication !== 'none');

  if (hasAuth) {
    entitySet.add('User');
    entitySet.add('Role');
  }

  // 3. Scan Backend Domain/Entities directories if backend exists
  if (manifest.backend?.enabled !== false && projectRoot) {
    try {
      const backendDir = getBackendDirectory(projectRoot, manifest);
      const candidates = [
        path.join(backendDir, 'src', 'Core', 'Domain', 'Entities'),
        path.join(backendDir, 'src', 'Domain', 'Entities'),
        path.join(backendDir, 'Core', 'Domain', 'Entities'),
        path.join(backendDir, 'Domain', 'Entities'),
      ];

      for (const dir of candidates) {
        if (await pathExists(dir)) {
          const files = await fs.readdir(dir);
          for (const file of files) {
            const lower = file.toLowerCase();
            if (lower.endsWith('.cs') && !RESERVED_ENTITY_FILENAMES.has(lower)) {
              const entityName = file.slice(0, -3);
              if (/^[A-Za-z_][A-Za-z0-9]*$/.test(entityName)) {
                entitySet.add(entityName);
              }
            }
          }
        }
      }
    } catch {
      // Non-critical; fallback to manifest
    }
  }

  return Array.from(entitySet).sort();
}
