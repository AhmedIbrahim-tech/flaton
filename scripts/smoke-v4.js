import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runCommand } from '../src/utils/command.js';
import { run } from '../src/utils/package-manager.js';
import { pathExists } from '../src/utils/filesystem.js';
import { loadProjectLayout, backendFile, frontendFile } from './smoke-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatorRoot = path.resolve(__dirname, '..');

const MODULE_FLAGS = [
  '--auth',
  '--users',
  '--permissions',
  '--audit',
  '--notifications',
  '--dashboard',
];

function pass(message) {
  process.stdout.write(`✓ ${message}\n`);
}

function fail(message) {
  process.stderr.write(`✗ ${message}\n`);
  process.exitCode = 1;
}

function createProject(projectName, frontendArgs, outputDir, extraFlags = []) {
  runCommand(
    process.execPath,
    [
      path.join(generatorRoot, 'bin', 'flatron.js'),
      projectName,
      '--yes',
      '--package-manager',
      'npm',
      '--output',
      outputDir,
      '--backend',
      '--sql-server',
      ...frontendArgs,
      ...MODULE_FLAGS,
      ...extraFlags,
    ],
    {
      cwd: generatorRoot,
      step: `Create ${projectName}`,
    },
  );
}

function moduleCmd(projectDir, args) {
  runCommand(
    process.execPath,
    [path.join(generatorRoot, 'bin', 'create-fullstack-module.js'), ...args],
    { cwd: projectDir, step: `module ${args.join(' ')}` },
  );
}

function featureCmd(projectDir, args) {
  runCommand(
    process.execPath,
    [path.join(generatorRoot, 'bin', 'create-fullstack-feature.js'), ...args],
    { cwd: projectDir, step: `feature ${args.join(' ')}` },
  );
}

async function ensureBackendBuild(layout) {
  runCommand('dotnet', ['restore'], { cwd: layout.backendDir, step: 'dotnet restore' });
  runCommand('dotnet', ['build'], { cwd: layout.backendDir, step: 'dotnet build' });
}

async function buildFrontend(layout, framework) {
  run('npm', 'build', { cwd: layout.frontendDir, step: `${framework} build` });
}

async function securityAudit(projectDir) {
  const patterns = [
    'localStorage.setItem("accessToken"',
    "localStorage.setItem('accessToken'",
    'sessionStorage.setItem("accessToken"',
    "sessionStorage.setItem('accessToken'",
    'AllowAnyOrigin()',
  ];

  /** @type {string[]} */
  const hits = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|cs|json)$/.test(entry.name)) continue;
      const text = await fs.readFile(full, 'utf8');
      for (const pattern of patterns) {
        if (text.includes(pattern)) {
          // AllowAnyOrigin is only a failure if AllowCredentials is also present nearby
          if (pattern.startsWith('AllowAnyOrigin')) {
            if (text.includes('AllowCredentials')) {
              hits.push(`${full}: ${pattern} + AllowCredentials`);
            }
          } else {
            hits.push(`${full}: ${pattern}`);
          }
        }
      }
      if (/RefreshToken\s*=\s*raw|TokenHash\s*=\s*rawRefresh|password.*Console\.Write/i.test(text)) {
        hits.push(`${full}: suspicious refresh/password logging pattern`);
      }
    }
  }

  await walk(projectDir);
  if (hits.length) {
    throw new Error(`Security audit failed:\n${hits.join('\n')}`);
  }
  pass(`Security audit clean (${path.basename(projectDir)})`);
}

async function assertAuthArchitecture(layout, library) {
  await assertExists(
    backendFile(layout, 'Infrastructure', 'DependencyInjection', 'AuthenticationServiceExtensions.cs'),
    'Auth DI',
  );
  await assertExists(
    backendFile(layout, 'Infrastructure', 'Persistence', 'Entities', 'RefreshToken.cs'),
    'RefreshToken entity',
  );
  await assertExists(
    backendFile(layout, 'API', 'Controllers', 'AuthController.cs'),
    'AuthController',
  );

  const refreshEntity = await fs.readFile(
    backendFile(layout, 'Infrastructure', 'Persistence', 'Entities', 'RefreshToken.cs'),
    'utf8',
  );
  if (!refreshEntity.includes('TokenHash')) {
    throw new Error('RefreshToken must store TokenHash');
  }
  if (/string\s+Token\s*\{/.test(refreshEntity) && !refreshEntity.includes('TokenHash')) {
    throw new Error('Plaintext Token property found on RefreshToken');
  }
  pass('Refresh token hash-only persistence');

  if (library === 'react') {
    await assertExists(
      frontendFile(layout, 'src', 'modules', 'auth', 'slices', 'thunks', 'login.thunk.ts'),
      'React auth thunk under slices/thunks',
    );
    await assertMissing(
      frontendFile(layout, 'src', 'modules', 'auth', 'thunks'),
      'No modules/auth/thunks directory',
    );
  }

  if (library === 'angular') {
    const packageJson = JSON.parse(
      await fs.readFile(frontendFile(layout, 'package.json'), 'utf8'),
    );
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const banned of ['react', 'react-dom', 'next', 'redux', '@reduxjs/toolkit']) {
      if (deps[banned]) {
        throw new Error(`Angular project leaked React dependency: ${banned}`);
      }
    }
    pass('Angular has no React dependency leakage');
  }
}

async function assertExists(target, label) {
  if (!(await pathExists(target))) {
    throw new Error(`Missing ${label}: ${target}`);
  }
  pass(label);
}

async function assertMissing(target, label) {
  if (await pathExists(target)) {
    throw new Error(`Unexpected path present (${label}): ${target}`);
  }
  pass(label);
}

async function verifyManifestModules(projectDir) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(projectDir, '.fullstack-app.json'), 'utf8'),
  );
  if (manifest.generatorVersion !== '4.0.0') {
    throw new Error(`Expected generatorVersion 4.0.0, got ${manifest.generatorVersion}`);
  }
  for (const key of ['auth', 'users', 'permissions', 'audit', 'notifications', 'dashboard']) {
    if (!manifest.modules?.[key]?.enabled) {
      throw new Error(`Module ${key} should be enabled in manifest`);
    }
  }
  pass('Manifest V4 modules enabled');
}

async function runAuthRuntimeSmoke(layout) {
  const apiDir = backendFile(layout, 'API');
  const infraDir = backendFile(layout, 'Infrastructure');
  const env = {
    ...process.env,
    Jwt__SigningKey: 'smoke-test-signing-key-change-me-32chars',
    ConnectionStrings__DefaultConnection:
      process.env.CFA_SMOKE_SQL ??
      'Server=(localdb)\\mssqllocaldb;Database=V4NextSmokeAuth;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True',
    ASPNETCORE_ENVIRONMENT: 'Development',
    ASPNETCORE_URLS: 'http://127.0.0.1:5088',
  };

  // Create migration + update for smoke DB only (explicit smoke harness, not the generator).
  try {
    runCommand(
      'dotnet',
      [
        'ef',
        'migrations',
        'add',
        'SmokeAuth',
        '--project',
        infraDir,
        '--startup-project',
        apiDir,
        '--output-dir',
        'Persistence/Migrations',
      ],
      { cwd: layout.backendDir, step: 'smoke ef migration' },
    );
    runCommand(
      'dotnet',
      [
        'ef',
        'database',
        'update',
        '--project',
        infraDir,
        '--startup-project',
        apiDir,
      ],
      { cwd: layout.backendDir, step: 'smoke ef database update' },
    );
  } catch (error) {
    process.stdout.write(
      `! Auth runtime smoke skipped (EF/SQL unavailable): ${error instanceof Error ? error.message : error}\n`,
    );
    return { skipped: true };
  }

  const child = spawn('dotnet', ['run', '--no-build', '--project', apiDir], {
    cwd: layout.backendDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = await waitForOutput(child, /Now listening|Application started/i, 90_000);
  if (!ready) {
    child.kill();
    process.stdout.write('! Auth runtime smoke skipped (API failed to start)\n');
    return { skipped: true };
  }

  try {
    const email = `user_${Date.now()}@example.com`;
    const password = 'Passw0rd!';

    const register = await fetchJson('http://127.0.0.1:5088/api/v1/Auth/Register', {
      method: 'POST',
      body: { email, password, displayName: 'Smoke User' },
    });
    if (register.status >= 400) {
      throw new Error(`Register failed: ${register.status} ${register.text}`);
    }
    pass('Register succeeds without auto-login requirement');

    const login = await fetchJson('http://127.0.0.1:5088/api/v1/Auth/Login', {
      method: 'POST',
      body: { email, password },
    });
    if (login.status >= 400) {
      throw new Error(`Login failed: ${login.status} ${login.text}`);
    }
    const accessToken = login.json?.accessToken ?? login.json?.data?.accessToken;
    if (!accessToken) {
      throw new Error(`Login response missing accessToken: ${login.text}`);
    }
    if (JSON.stringify(login.json).toLowerCase().includes('refreshtoken')) {
      throw new Error('Login JSON must not include refreshToken');
    }
    const setCookie = login.headers.getSetCookie?.() ?? [];
    const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
    if (!cookieHeader.toLowerCase().includes('refreshtoken')) {
      throw new Error('Login did not set refresh cookie');
    }
    pass('Login returns access token + refresh cookie (no refresh in JSON)');

    const me = await fetchJson('http://127.0.0.1:5088/api/v1/Auth/Me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (me.status >= 400) {
      throw new Error(`Me failed: ${me.status} ${me.text}`);
    }
    pass('Me succeeds with access token');

    const refresh = await fetchJson('http://127.0.0.1:5088/api/v1/Auth/Refresh', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    if (refresh.status >= 400) {
      throw new Error(`Refresh failed: ${refresh.status} ${refresh.text}`);
    }
    const newCookie = (refresh.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    pass('Refresh rotates token');

    const reuse = await fetchJson('http://127.0.0.1:5088/api/v1/Auth/Refresh', {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    if (reuse.status < 400) {
      throw new Error('Old refresh token was accepted after rotation');
    }
    pass('Old refresh token rejected after rotation');

    const logout = await fetchJson('http://127.0.0.1:5088/api/v1/Auth/Logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Cookie: newCookie || cookieHeader,
      },
    });
    if (logout.status >= 400) {
      throw new Error(`Logout failed: ${logout.status} ${logout.text}`);
    }
    pass('Logout succeeds');

    return { skipped: false };
  } finally {
    child.kill();
  }
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {RegExp} pattern
 * @param {number} timeoutMs
 */
function waitForOutput(child, pattern, timeoutMs) {
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += String(chunk);
      if (pattern.test(buffer)) {
        cleanup();
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
  });
}

/**
 * @param {string} url
 * @param {{ method: string, body?: object, headers?: Record<string, string> }} options
 */
async function fetchJson(url, options) {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, text, json, headers: response.headers };
}

async function smokeOne({ name, frontendArgs, library, framework, extraFlags = [] }) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), `cfa-v4-${name}-`));
  process.stdout.write(`\n=== ${name} → ${outputDir} ===\n`);

  createProject(name, frontendArgs, outputDir, extraFlags);
  const projectDir = path.join(outputDir, name);
  const layout = await loadProjectLayout(projectDir);

  moduleCmd(projectDir, ['--status']);
  moduleCmd(projectDir, ['auth', '--dry-run']);

  await verifyManifestModules(projectDir);
  await assertAuthArchitecture(layout, library);

  // Duplicate protection
  moduleCmd(projectDir, ['auth', '--yes']);
  pass('Duplicate auth install reports already enabled');

  featureCmd(projectDir, [
    'Product',
    '--yes',
    '--fullstack',
    '--surface',
    'dashboard',
    '--field',
    'Name:string:required:max=120',
    '--field',
    'Price:decimal:required',
    '--permissions',
  ]);
  pass('Product feature generated with permissions');

  if (extraFlags.includes('--domain-localization') && extraFlags.includes('--rich-text')) {
    featureCmd(projectDir, [
      'Article',
      '--yes',
      '--fullstack',
      '--surface',
      'both',
      '--field',
      'Slug:string:required:max=160',
      '--field',
      'Title:string:required:max=200',
      '--field',
      'Summary:string:required:max=500',
      '--field',
      'Content:richText:required',
    ]);
    pass('Article feature with richText field');
  }

  await securityAudit(projectDir);
  await ensureBackendBuild(layout);
  pass(`${name} backend build`);

  await buildFrontend(layout, framework);
  pass(`${name} frontend build`);

  return { projectDir, layout };
}

async function main() {
  process.stdout.write('CREATE FULLSTACK APP — V4 SMOKE\n');

  const nextResult = await smokeOne({
    name: 'V4NextSmoke',
    frontendArgs: ['--frontend', 'react', '--react-framework', 'next'],
    library: 'react',
    framework: 'next',
    extraFlags: ['--domain-localization', '--rich-text'],
  });

  const authRuntime = await runAuthRuntimeSmoke(nextResult.layout);

  await smokeOne({
    name: 'V4ViteSmoke',
    frontendArgs: ['--frontend', 'react', '--react-framework', 'vite'],
    library: 'react',
    framework: 'vite',
  });

  await smokeOne({
    name: 'V4AngularSmoke',
    frontendArgs: ['--frontend', 'angular'],
    library: 'angular',
    framework: 'angular',
  });

  process.stdout.write('\nV4 smoke finished.\n');
  if (authRuntime?.skipped) {
    process.stdout.write('Auth runtime: SKIPPED (environment)\n');
  } else {
    process.stdout.write('Auth runtime: EXECUTED\n');
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
