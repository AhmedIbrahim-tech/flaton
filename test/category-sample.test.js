import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFeatureConfig } from '../src/feature-generator/feature.config.js';
import { planBackendFeature } from '../src/feature-generator/backend/backend-feature.generator.js';
import { planFrontendFeature } from '../src/feature-generator/frontend/frontend-feature.generator.js';
import { resolveReactOverlayProfile } from '../src/generators/frontend/react/react-common.generator.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walkFiles(dir) {
  /** @type {string[]} */
  const files = [];
  if (!fs.existsSync(dir)) {
    return files;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function posix(relativePath) {
  return relativePath.replaceAll('\\', '/');
}

function categoryBackendConfig(overrides = {}) {
  const backend = {
    enabled: true,
    architecture: 'cqrs-mediatr',
    orm: 'efcore',
    database: 'sqlserver',
    authentication: 'none',
    mapping: 'manual',
    ...overrides.backend,
  };
  return buildFeatureConfig({
    singularName: 'Category',
    fields: [
      { name: 'Name', type: 'string', required: true },
      { name: 'Description', type: 'string' },
    ],
    architecture: backend.architecture,
    orm: backend.orm,
    database: backend.database,
    authentication: backend.authentication,
    mapping: backend.mapping,
    manifest: {
      projectName: 'TestApp',
      backend,
      frontend: { enabled: false },
      paths: { backend: 'Backend', frontend: null },
    },
    projectRoot: '/test',
    projectName: 'TestApp',
    frontendStrategy: { library: null },
    mode: 'backend',
  });
}

test('starter templates no longer include an Example feature', () => {
  const templatesRoot = path.join(repoRoot, 'src', 'templates');
  const leftover = walkFiles(templatesRoot)
    .map((file) => posix(path.relative(templatesRoot, file)))
    .filter((relative) => {
      if (relative.endsWith('env.example') || relative.includes('/env.example')) {
        return false;
      }
      return (
        relative.includes('/example/') ||
        relative.includes('/examples/') ||
        /(^|\/)example\./i.test(path.basename(relative)) ||
        /ExamplesPage|ExampleCard|useExamplesController/.test(
          fs.readFileSync(path.join(templatesRoot, relative), 'utf8'),
        )
      );
    });

  assert.deepEqual(leftover, []);
  assert.equal(
    fs.existsSync(path.join(templatesRoot, 'frontend', 'react', 'common', 'src', 'modules', 'example')),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(templatesRoot, 'frontend', 'angular', 'src', 'app', 'features', 'example')),
    false,
  );
});

test('starter Category feature files exist for React and Angular', () => {
  const reactModule = path.join(
    repoRoot,
    'src',
    'templates',
    'frontend',
    'react',
    'common',
    'src',
    'modules',
    'category',
  );
  const angularFeature = path.join(
    repoRoot,
    'src',
    'templates',
    'frontend',
    'angular',
    'src',
    'app',
    'features',
    'category',
  );

  for (const file of [
    path.join(reactModule, 'pages', 'CategoriesPage.tsx'),
    path.join(reactModule, 'pages', 'CreateCategoryPage.tsx'),
    path.join(reactModule, 'pages', 'EditCategoryPage.tsx'),
    path.join(reactModule, 'pages', 'CategoryDetailsPage.tsx'),
    path.join(reactModule, 'services', 'category.service.ts'),
    path.join(angularFeature, 'pages', 'categories.page.ts'),
    path.join(angularFeature, 'pages', 'create-category.page.ts'),
    path.join(angularFeature, 'pages', 'edit-category.page.ts'),
    path.join(angularFeature, 'pages', 'category-details.page.ts'),
    path.join(angularFeature, 'services', 'category.service.ts'),
  ]) {
    assert.equal(fs.existsSync(file), true, file);
  }

  const service = fs.readFileSync(path.join(reactModule, 'services', 'category.service.ts'), 'utf8');
  assert.match(service, /\/api\/v1\/categories/);
  assert.doesNotMatch(service, /\/api\/v1\/examples/);
});

test('Zustand overlay skips Category Redux slices', () => {
  const skipped = resolveReactOverlayProfile({ state: 'zustand' }).skipPaths.map((item) =>
    posix(item),
  );
  assert.ok(skipped.some((item) => item.includes('modules/category/slices')));
});

test('feature generator plans a CQRS Category feature', () => {
  const files = planBackendFeature(categoryBackendConfig());
  const paths = files.map((file) => posix(file.relativePath));
  const joined = files.map((file) => file.contents).join('\n');

  assert.ok(paths.some((item) => item.endsWith('Domain/Entities/Category.cs')));
  assert.ok(paths.some((item) => item.endsWith('CategoryDto.cs')));
  assert.ok(paths.some((item) => item.endsWith('CreateCategoryCommand.cs')));
  assert.ok(paths.some((item) => item.endsWith('UpdateCategoryCommand.cs')));
  assert.ok(paths.some((item) => item.endsWith('DeleteCategoryCommand.cs')));
  assert.ok(paths.some((item) => item.endsWith('GetCategoryByIdQuery.cs')));
  assert.ok(paths.some((item) => item.endsWith('API/Controllers/CategoriesController.cs')));
  assert.ok(paths.every((item) => !item.includes('/Endpoints/')));
  assert.ok(paths.some((item) => item.includes('Features/Category/Commands/Create/')));
  assert.ok(paths.every((item) => !item.includes('.g.cs')));
  assert.ok(paths.some((item) => item.endsWith('CategoryConfiguration.cs')));
  assert.match(joined, /CreateCategoryCommandHandler/);
  assert.match(joined, /IRequestHandler/);
  assert.match(joined, /\[ApiController\]/);
  assert.match(joined, /sealed class CategoriesController : ApiControllerBase/);
  assert.match(joined, /\[HttpPost\(Router\.Categories\.Create\)\]/);
  assert.match(joined, /\[HttpGet\(Router\.Categories\.ById\)\]/);
  assert.match(joined, /\[HttpPut\(Router\.Categories\.Update\)\]/);
  assert.match(joined, /\[HttpDelete\(Router\.Categories\.Delete\)\]/);
  assert.doesNotMatch(joined, /MapGet\(|MapPost\(|MapGroup\(/);
  assert.doesNotMatch(joined, /\bExample\b/);
});

test('feature generator plans Application Services Category types', () => {
  const files = planBackendFeature(
    categoryBackendConfig({ backend: { architecture: 'services' } }),
  );
  const paths = files.map((file) => posix(file.relativePath));
  const joined = files.map((file) => file.contents).join('\n');

  assert.ok(paths.some((item) => item.endsWith('ICategoryService.cs')));
  assert.ok(paths.some((item) => item.endsWith('CategoryService.cs')));
  assert.ok(paths.some((item) => item.endsWith('CategoriesController.cs')));
  assert.match(joined, /ICategoryService/);
  assert.doesNotMatch(joined, /IRequestHandler/);
});

test('feature generator plans a Dapper Category repository', () => {
  const files = planBackendFeature(categoryBackendConfig({ backend: { orm: 'dapper' } }));
  const paths = files.map((file) => posix(file.relativePath));
  assert.ok(paths.some((item) => item.includes('Persistence/Repositories/')));
  assert.ok(paths.some((item) => item.includes('ICategories') && item.endsWith('Repository.cs')));
});

test('feature generator plans Category frontend list, create, and edit pages', async () => {
  const config = buildFeatureConfig({
    singularName: 'Category',
    fields: [
      { name: 'Name', type: 'string', required: true },
      { name: 'Description', type: 'string' },
    ],
    surface: 'dashboard',
    manifest: {
      projectName: 'TestApp',
      backend: { enabled: false, authentication: 'none' },
      frontend: {
        enabled: true,
        library: 'react',
        framework: 'next',
        language: 'typescript',
        state: 'redux',
        httpClient: 'axios',
        forms: 'react-hook-form-zod',
      },
      paths: { backend: null, frontend: 'Frontend' },
    },
    projectRoot: '/test',
    projectName: 'TestApp',
    frontendStrategy: { library: 'react', framework: 'next' },
    mode: 'frontend',
  });

  const { files } = await planFrontendFeature(config);
  const paths = files.map((file) => posix(file.relativePath));
  assert.ok(paths.some((item) => item.endsWith('CategoriesPage.tsx')));
  assert.ok(paths.some((item) => item.endsWith('CreateCategoryPage.tsx')));
  assert.ok(paths.some((item) => item.endsWith('EditCategoryPage.tsx')));
  assert.doesNotMatch(files.map((file) => file.contents).join('\n'), /\bExample\b/);
});
