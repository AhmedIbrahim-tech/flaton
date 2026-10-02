import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { writeGenerationManifest } from '../src/generators/manifest.generator.js';
import { buildFeatureConfig } from '../src/feature-generator/feature.config.js';
import { planBackendFeature } from '../src/feature-generator/backend/backend-feature.generator.js';
import {
  resolveReactOverlayProfile,
  renderApiClientSource,
} from '../src/generators/frontend/react/react-common.generator.js';
import { planAuthFrontend } from '../src/module-generator/auth/auth-frontend.generator.js';
import { setModuleManifestContext } from '../src/module-generator/modules-orchestrator-helpers.js';

function productConfig(architecture) {
  return buildFeatureConfig({
    singularName: 'Product',
    fields: [{ name: 'Name', type: 'string' }],
    manifest: {
      backend: { enabled: true, architecture },
      frontend: { enabled: true, library: 'react', framework: 'next' },
      paths: { backend: 'Backend', frontend: 'Frontend' },
    },
    projectRoot: '/test',
    projectName: 'TestApp',
    frontendStrategy: { library: 'react', framework: 'next' },
  });
}

test('Full Stack layout writes Backend/ and Frontend/ paths', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-layout-'));
  await writeGenerationManifest({
    targetDirectory: tempDir,
    pascalName: 'FullApp',
    backend: { enabled: true, architecture: 'cqrs-mediatr' },
    frontend: { enabled: true, library: 'react', framework: 'next' },
    modules: {},
  });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(tempDir, '.fullstack-app.json'), 'utf8'),
  );
  assert.deepEqual(manifest.paths, { backend: 'Backend', frontend: 'Frontend' });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Application Services mode generates no MediatR or IRequest references', () => {
  const config = productConfig('services');
  assert.equal(config.architecture, 'services');
  const files = planBackendFeature(config);
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotMatch(
      file.contents,
      /MediatR|IRequest\b|IRequestHandler|ISender/,
      `Unexpected MediatR usage in ${file.relativePath}`,
    );
  }
  assert.ok(
    files.some((file) => file.relativePath.replaceAll('\\', '/').endsWith('Interfaces/IProductService.cs')),
    'Expected IProductService.cs',
  );
});

test('CQRS mode still generates MediatR handlers', () => {
  const config = productConfig('cqrs-mediatr');
  assert.equal(config.architecture, 'cqrs-mediatr');
  const files = planBackendFeature(config);
  const handlers = files.filter((file) => file.relativePath.includes('Handler.cs'));
  assert.ok(handlers.length > 0, 'Expected CQRS handler files');
  assert.ok(handlers.some((file) => /IRequest/.test(file.contents)));
  assert.ok(files.some((file) => /using MediatR/.test(file.contents)));
});

test('Fetch frontend api-client does not import axios', () => {
  const source = renderApiClientSource({ httpClient: 'fetch' });
  assert.doesNotMatch(source, /axios/);
  assert.match(source, /fetch\(/);
  const profile = resolveReactOverlayProfile({ httpClient: 'fetch' });
  assert.equal(profile.httpClient, 'fetch');
});

test('Zustand frontend skips Redux store files', () => {
  const profile = resolveReactOverlayProfile({ state: 'zustand' });
  assert.equal(profile.state, 'zustand');
  const skipped = profile.skipPaths.map((item) => item.replaceAll('\\', '/'));
  assert.ok(skipped.some((item) => item.endsWith('store/store.ts')));
  assert.ok(skipped.some((item) => item.endsWith('store/generated-reducers.ts')));

  const manifest = {
    backend: { enabled: true },
    frontend: { enabled: true, library: 'react', framework: 'next', state: 'zustand' },
    paths: { backend: 'Backend', frontend: 'Frontend' },
  };
  setModuleManifestContext(manifest);
  const plan = planAuthFrontend({
    projectName: 'TestApp',
    frontendStrategy: { library: 'react', framework: 'next' },
    manifest,
  });
  try {
    for (const file of plan.files) {
      assert.doesNotMatch(file.contents, /@reduxjs\/toolkit|react-redux/);
      assert.ok(!file.relativePath.replaceAll('\\', '/').includes('/slices/'));
    }
    assert.equal(plan.registryUpdates.length, 0);
  } finally {
    setModuleManifestContext(null);
  }
});

test('JavaScript frontend uses js/jsx extensions and skips TypeScript overlay files', () => {
  const profile = resolveReactOverlayProfile({ language: 'javascript' });
  assert.equal(profile.language, 'javascript');
  assert.equal(profile.ext, 'js');
  assert.equal(profile.jsxExt, 'jsx');

  const manifest = {
    backend: { enabled: true },
    frontend: {
      enabled: true,
      library: 'react',
      framework: 'next',
      language: 'javascript',
    },
    paths: { backend: 'Backend', frontend: 'Frontend' },
  };
  setModuleManifestContext(manifest);
  const plan = planAuthFrontend({
    projectName: 'TestApp',
    frontendStrategy: { library: 'react', framework: 'next' },
    manifest,
  });
  try {
    for (const file of plan.files) {
      const normalized = file.relativePath.replaceAll('\\', '/');
      assert.ok(
        !normalized.endsWith('.ts') && !normalized.endsWith('.tsx'),
        `Unexpected TypeScript path ${file.relativePath}`,
      );
    }
  } finally {
    setModuleManifestContext(null);
  }
});
