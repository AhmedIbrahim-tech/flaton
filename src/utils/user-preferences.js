import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PREFERENCES_DIR_NAME = '.flatron';
const LEGACY_PREFERENCES_DIR_NAMES = ['.create-fullstack-app', '.generate-fullstack-app'];
const PREFERENCES_FILE_NAME = 'config.json';

/**
 * Returns the absolute path to the global user preferences file.
 * @returns {string}
 */
export function getUserPreferencesPath() {
  return path.join(os.homedir(), PREFERENCES_DIR_NAME, PREFERENCES_FILE_NAME);
}

/**
 * Loads saved developer preferences from ~/.flatron/config.json (or legacy path).
 * Returns null if no preferences are found or if the file cannot be parsed.
 * @returns {Record<string, unknown> | null}
 */
export function loadUserPreferences() {
  try {
    let filePath = getUserPreferencesPath();
    if (!fs.existsSync(filePath)) {
      // Check legacy paths if available
      for (const legacyDir of LEGACY_PREFERENCES_DIR_NAMES) {
        const legacyPath = path.join(os.homedir(), legacyDir, PREFERENCES_FILE_NAME);
        if (fs.existsSync(legacyPath)) {
          filePath = legacyPath;
          break;
        }
      }
      if (!fs.existsSync(filePath)) {
        return null;
      }
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Saves developer preferences to ~/.flatron/config.json.
 * @param {Record<string, unknown>} preferences
 */
export function saveUserPreferences(preferences) {
  try {
    const dirPath = path.join(os.homedir(), PREFERENCES_DIR_NAME);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const filePath = getUserPreferencesPath();
    fs.writeFileSync(filePath, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears saved developer preferences.
 */
export function clearUserPreferences() {
  try {
    const filePath = getUserPreferencesPath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}
