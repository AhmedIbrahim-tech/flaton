/**
 * V4 Authentication module — Program.cs patcher.
 *
 * Rewriting `Program.cs` from a generator is fragile, so this helper performs
 * small, idempotent, marker-based string edits instead. Every insertion is
 * guarded so running it twice (or against an already-patched file) is a no-op.
 *
 * It applies four changes when missing:
 *   1. `using <ProjectName>.Infrastructure.DependencyInjection;` (AddAuthModule)
 *   2. `builder.Services.AddAuthModule(builder.Configuration);`
 *   3. `app.UseAuthentication(); app.UseAuthorization();` before `MapControllers`
 *   4. `await app.Services.SeedAuthModuleAsync();` before `app.Run();`
 */

const SERVICE_MARKER = 'AddAuthModule';
const MIDDLEWARE_MARKER = 'UseAuthentication';
const SEED_MARKER = 'SeedAuthModuleAsync';

/**
 * @typedef {object} ProgramPatchResult
 * @property {string} contents The (possibly) updated Program.cs contents.
 * @property {boolean} changed Whether any edit was applied.
 * @property {string[]} applied Human-readable list of the edits performed.
 * @property {string[]} skipped Edits that were already present.
 */

/**
 * Patch a Program.cs source string to wire up the auth module.
 *
 * @param {string} existingProgramCs Raw contents of Program.cs.
 * @returns {ProgramPatchResult}
 */
export function patchProgramForAuth(existingProgramCs) {
  if (typeof existingProgramCs !== 'string') {
    throw new Error('patchProgramForAuth requires the Program.cs contents as a string.');
  }

  let contents = existingProgramCs;
  /** @type {string[]} */
  const applied = [];
  /** @type {string[]} */
  const skipped = [];

  contents = insertUsing(contents, applied, skipped);
  contents = insertServiceRegistration(contents, applied, skipped);
  contents = insertMiddleware(contents, applied, skipped);
  contents = insertRateLimiter(contents, applied, skipped);
  contents = insertSeeding(contents, applied, skipped);

  return {
    contents,
    changed: applied.length > 0,
    applied,
    skipped,
  };
}

/**
 * Ensure AddAuthModule is in scope. Generated Program.cs already imports
 * Infrastructure.DependencyInjection (same namespace as AuthenticationServiceExtensions).
 *
 * @param {string} contents
 * @param {string[]} applied
 * @param {string[]} skipped
 * @returns {string}
 */
function insertUsing(contents, applied, skipped) {
  const diUsingRegex = /using\s+[\w.]+\.Infrastructure\.DependencyInjection\s*;/;
  if (diUsingRegex.test(contents)) {
    skipped.push('using ...Infrastructure.DependencyInjection;');
    return contents;
  }

  const legacyAuthUsingRegex = /using\s+[\w.]+\.Infrastructure\.Authentication\s*;/;
  if (legacyAuthUsingRegex.test(contents)) {
    skipped.push('using ...Infrastructure.Authentication;');
    return contents;
  }

  const infraUsingRegex = /using\s+([\w.]+)\.Infrastructure(?:\.DependencyInjection)?\s*;/;
  const match = contents.match(infraUsingRegex);
  if (match) {
    const namespaceRoot = match[1];
    const diUsing = `using ${namespaceRoot}.Infrastructure.DependencyInjection;`;
    if (contents.includes(diUsing)) {
      skipped.push(diUsing);
      return contents;
    }
    const replacement = `${match[0]}\n${diUsing}`;
    applied.push(diUsing);
    return contents.replace(match[0], replacement);
  }

  const usingLineRegex = /^using\s+[\w.]+\s*;\s*$/gm;
  let lastUsing = null;
  let current;
  while ((current = usingLineRegex.exec(contents)) !== null) {
    lastUsing = current;
  }

  if (lastUsing) {
    const insertAt = lastUsing.index + lastUsing[0].length;
    const diUsing = 'using Infrastructure.DependencyInjection;';
    applied.push('using ...Infrastructure.DependencyInjection;');
    return `${contents.slice(0, insertAt)}\n${diUsing}${contents.slice(insertAt)}`;
  }

  skipped.push('using ...Infrastructure.DependencyInjection; (no using block found)');
  return contents;
}

/**
 * Insert `builder.Services.AddAuthModule(builder.Configuration);` right after
 * `AddInfrastructure`, or after `AddApplication` as a fallback.
 *
 * @param {string} contents
 * @param {string[]} applied
 * @param {string[]} skipped
 * @returns {string}
 */
function insertServiceRegistration(contents, applied, skipped) {
  if (contents.includes(SERVICE_MARKER)) {
    skipped.push('builder.Services.AddAuthModule(builder.Configuration);');
    return contents;
  }

  const registration = 'builder.Services.AddAuthModule(builder.Configuration);';
  const anchors = [
    /^([ \t]*)builder\.Services\.AddInfrastructure\([^;]*\);[ \t]*$/m,
    /^([ \t]*)builder\.Services\.AddApplication\([^;]*\);[ \t]*$/m,
  ];

  for (const anchor of anchors) {
    const match = contents.match(anchor);
    if (match) {
      const indent = match[1] ?? '';
      const replacement = `${match[0]}\n${indent}${registration}`;
      applied.push(registration);
      return contents.replace(match[0], replacement);
    }
  }

  // Last resort: insert immediately before the app is built.
  const buildAnchor = /^([ \t]*)var\s+app\s*=\s*builder\.Build\(\);[ \t]*$/m;
  const buildMatch = contents.match(buildAnchor);
  if (buildMatch) {
    const indent = buildMatch[1] ?? '';
    const replacement = `${indent}${registration}\n\n${buildMatch[0]}`;
    applied.push(registration);
    return contents.replace(buildMatch[0], replacement);
  }

  skipped.push('builder.Services.AddAuthModule(...) (no anchor found)');
  return contents;
}

/**
 * Insert authentication + authorization middleware before `MapControllers`.
 *
 * @param {string} contents
 * @param {string[]} applied
 * @param {string[]} skipped
 * @returns {string}
 */
function insertMiddleware(contents, applied, skipped) {
  if (contents.includes(MIDDLEWARE_MARKER)) {
    skipped.push('app.UseAuthentication(); app.UseAuthorization();');
    return contents;
  }

  // If UseAuthorization already exists (e.g. in MVC / Razor Pages templates), insert UseAuthentication right before it.
  const authzAnchor = /^([ \t]*)app\.UseAuthorization\(\);[ \t]*$/m;
  const authzMatch = contents.match(authzAnchor);
  if (authzMatch) {
    const indent = authzMatch[1] ?? '';
    const replacement = `${indent}app.UseAuthentication();\n${authzMatch[0]}`;
    applied.push('app.UseAuthentication();');
    return contents.replace(authzMatch[0], replacement);
  }

  const mapControllersAnchor = /^([ \t]*)app\.MapControllers\(\);[ \t]*$/m;
  const match = contents.match(mapControllersAnchor);
  if (match) {
    const indent = match[1] ?? '';
    const middleware = `${indent}app.UseAuthentication();\n${indent}app.UseAuthorization();`;
    const replacement = `${middleware}\n${match[0]}`;
    applied.push('app.UseAuthentication(); app.UseAuthorization();');
    return contents.replace(match[0], replacement);
  }

  const routeAnchors = [
    /^([ \t]*)app\.MapControllerRoute\([^;]*\);[ \t]*$/m,
    /^([ \t]*)app\.MapRazorPages\(\);[ \t]*$/m,
    /^([ \t]*)app\.MapHealthChecks\([^;]*\);[ \t]*$/m,
  ];

  for (const anchor of routeAnchors) {
    const rMatch = contents.match(anchor);
    if (rMatch) {
      const indent = rMatch[1] ?? '';
      const middleware = `${indent}app.UseAuthentication();\n${indent}app.UseAuthorization();`;
      const replacement = `${middleware}\n${rMatch[0]}`;
      applied.push('app.UseAuthentication(); app.UseAuthorization();');
      return contents.replace(rMatch[0], replacement);
    }
  }

  // Fallback: before app.Run().
  const runAnchor = /^([ \t]*)app\.Run\(\);[ \t]*$/m;
  const runMatch = contents.match(runAnchor);
  if (runMatch) {
    const indent = runMatch[1] ?? '';
    const middleware = `${indent}app.UseAuthentication();\n${indent}app.UseAuthorization();`;
    const replacement = `${middleware}\n\n${runMatch[0]}`;
    applied.push('app.UseAuthentication(); app.UseAuthorization();');
    return contents.replace(runMatch[0], replacement);
  }

  skipped.push('app.UseAuthentication(); app.UseAuthorization(); (no anchor found)');
  return contents;
}

/**
 * Insert `app.UseRateLimiter();` after authentication middleware when missing.
 *
 * @param {string} contents
 * @param {string[]} applied
 * @param {string[]} skipped
 * @returns {string}
 */
function insertRateLimiter(contents, applied, skipped) {
  if (contents.includes('UseRateLimiter')) {
    skipped.push('app.UseRateLimiter();');
    return contents;
  }

  const authAnchor = /^([ \t]*)app\.UseAuthorization\(\);[ \t]*$/m;
  const match = contents.match(authAnchor);
  if (match) {
    const indent = match[1] ?? '';
    const replacement = `${match[0]}\n${indent}app.UseRateLimiter();`;
    applied.push('app.UseRateLimiter();');
    return contents.replace(match[0], replacement);
  }

  skipped.push('app.UseRateLimiter(); (no UseAuthorization anchor)');
  return contents;
}

/**
 * Insert role/permission seeding before `app.Run();`.
 *
 * @param {string} contents
 * @param {string[]} applied
 * @param {string[]} skipped
 * @returns {string}
 */
function insertSeeding(contents, applied, skipped) {
  if (contents.includes(SEED_MARKER)) {
    skipped.push('await app.Services.SeedAuthModuleAsync();');
    return contents;
  }

  const runAnchor = /^([ \t]*)app\.Run\(\);[ \t]*$/m;
  const match = contents.match(runAnchor);
  if (match) {
    const indent = match[1] ?? '';
    const seeding = `${indent}await app.Services.SeedAuthModuleAsync();`;
    const replacement = `${seeding}\n\n${match[0]}`;
    applied.push('await app.Services.SeedAuthModuleAsync();');
    return contents.replace(match[0], replacement);
  }

  skipped.push('await app.Services.SeedAuthModuleAsync(); (no app.Run() found)');
  return contents;
}
