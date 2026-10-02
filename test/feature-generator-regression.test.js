import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeatureConfig } from '../src/feature-generator/feature.config.js';
import { planBackendFeature } from '../src/feature-generator/backend/backend-feature.generator.js';
import { planFrontendFeature } from '../src/feature-generator/frontend/frontend-feature.generator.js';
import { renderApiClientSource } from '../src/generators/frontend/react/react-common.generator.js';

function backendConfig(overrides = {}) {
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
    singularName: 'Product',
    fields: [{ name: 'Name', type: 'string' }],
    generatePermissions: Boolean(overrides.permissions),
    permissions: Boolean(overrides.permissions),
    architecture: backend.architecture,
    orm: backend.orm,
    database: backend.database,
    authentication: backend.authentication,
    mapping: backend.mapping,
    manifest: {
      projectName: 'TestApp',
      backend,
      frontend: { enabled: false },
      modules: {
        permissions: { enabled: Boolean(overrides.permissions) },
      },
      paths: { backend: 'Backend', frontend: null },
    },
    projectRoot: '/test',
    projectName: 'TestApp',
    frontendStrategy: { library: null },
    mode: 'backend',
  });
}

function frontendConfig(frontendOverrides = {}, surface = 'dashboard') {
  const frontend = {
    enabled: true,
    library: 'react',
    framework: 'next',
    language: 'typescript',
    styling: 'tailwind',
    state: 'redux',
    httpClient: 'axios',
    forms: 'react-hook-form-zod',
    componentSystem: 'none',
    ...frontendOverrides,
  };
  return buildFeatureConfig({
    singularName: 'Product',
    fields: [{ name: 'Name', type: 'string' }],
    surface,
    manifest: {
      projectName: 'TestApp',
      backend: { enabled: false, authentication: 'none' },
      frontend,
      paths: { backend: null, frontend: 'Frontend' },
    },
    projectRoot: '/test',
    projectName: 'TestApp',
    frontendStrategy: { library: frontend.library, framework: frontend.framework },
    mode: 'frontend',
  });
}

function joined(files) {
  return files.map((file) => file.contents).join('\n');
}

function paths(files) {
  return files.map((file) => file.relativePath.replaceAll('\\', '/'));
}

test('CQRS + EF Core + Identity JWT protects controllers and uses EF types', () => {
  const config = backendConfig({
    backend: { architecture: 'cqrs-mediatr', orm: 'efcore', authentication: 'identity-jwt' },
    permissions: true,
  });
  const files = planBackendFeature(config);
  const source = joined(files);
  assert.match(source, /IRequest/);
  assert.match(source, /namespace TestApp\./);
  assert.match(source, /IApplicationDbContext/);
  assert.match(source, /IEntityTypeConfiguration/);
  assert.match(source, /\[Authorize\]/);
  assert.match(source, /HasPermission\(PermissionConstants\.ProductsView\)/);
  assert.doesNotMatch(source, /IProductsRepository/);
});

test('CQRS + Dapper + no auth has no EF types and no Authorize', () => {
  const config = backendConfig({
    backend: { architecture: 'cqrs-mediatr', orm: 'dapper', authentication: 'none' },
  });
  const files = planBackendFeature(config);
  const source = joined(files);
  for (const file of files) {
    assert.doesNotMatch(
      file.contents,
      /Microsoft\.EntityFrameworkCore|IApplicationDbContext|IEntityTypeConfiguration/,
      `Unexpected EF Core usage in ${file.relativePath}`,
    );
    assert.doesNotMatch(file.contents, /\[Authorize\]|HasPermission/);
  }
  assert.match(source, /IProductsRepository/);
  assert.match(source, /IDbConnectionFactory/);
});

test('Services + EF Core still has no MediatR types', () => {
  const config = backendConfig({
    backend: { architecture: 'services', orm: 'efcore', authentication: 'none' },
  });
  const files = planBackendFeature(config);
  for (const file of files) {
    assert.doesNotMatch(file.contents, /MediatR|IRequest\b|IRequestHandler|ISender/);
  }
  assert.ok(paths(files).some((item) => item.endsWith('Interfaces/IProductService.cs')));
});

test('EF Core + Dapper hybrid uses EF writes and Dapper query repository', () => {
  const config = backendConfig({
    backend: { architecture: 'cqrs-mediatr', orm: 'efcore-dapper', authentication: 'none' },
  });
  const files = planBackendFeature(config);
  const source = joined(files);
  assert.match(source, /IApplicationDbContext/);
  assert.match(source, /IEntityTypeConfiguration/);
  assert.match(source, /IProductsQueryRepository/);
  const searchHandler = files.find((file) =>
    file.relativePath.replaceAll('\\', '/').endsWith('SearchProductsQueryHandler.cs'),
  );
  assert.ok(searchHandler);
  assert.match(searchHandler.contents, /IProductsQueryRepository/);
  assert.doesNotMatch(searchHandler.contents, /IApplicationDbContext/);
  const createHandler = files.find((file) =>
    file.relativePath.replaceAll('\\', '/').endsWith('CreateProductCommandHandler.cs'),
  );
  assert.ok(createHandler);
  assert.match(createHandler.contents, /IApplicationDbContext/);
});

test('React Redux Axios TypeScript keeps slices and response.data', async () => {
  const config = frontendConfig();
  const { files, registryUpdates } = await planFrontendFeature(config);
  const source = joined(files);
  assert.ok(paths(files).some((item) => item.includes('/slices/')));
  assert.match(source, /@reduxjs\/toolkit/);
  assert.match(source, /response\.data/);
  assert.match(source, /react-hook-form/);
  assert.ok(registryUpdates.some((entry) => entry.relativePath.replaceAll('\\', '/').includes('generated-reducers.ts')));
  assert.ok(paths(files).every((item) => !item.endsWith('.js') && !item.endsWith('.jsx')));
});

test('React Zustand Fetch TypeScript does not generate Redux or axios', async () => {
  const config = frontendConfig({ state: 'zustand', httpClient: 'fetch' });
  const { files, registryUpdates } = await planFrontendFeature(config);
  const source = joined(files);
  assert.doesNotMatch(source, /@reduxjs\/toolkit|useAppDispatch|useAppSelector|createAsyncThunk/);
  assert.doesNotMatch(source, /from ["']axios["']/);
  assert.match(source, /from "zustand"/);
  assert.match(source, /const \{ data \} = await apiClient/);
  assert.ok(paths(files).some((item) => item.includes('/store/useProductsStore.ts')));
  assert.ok(!paths(files).some((item) => item.includes('/slices/')));
  assert.ok(!registryUpdates.some((entry) => entry.relativePath.includes('generated-reducers')));
});

test('React none + JavaScript emits js/jsx and no store libraries', async () => {
  const config = frontendConfig({ state: 'none', language: 'javascript' });
  const { files, registryUpdates } = await planFrontendFeature(config);
  const source = joined(files);
  for (const file of files) {
    const normalized = file.relativePath.replaceAll('\\', '/');
    assert.ok(
      !normalized.endsWith('.ts') && !normalized.endsWith('.tsx'),
      `Unexpected TypeScript path ${file.relativePath}`,
    );
  }
  assert.doesNotMatch(source, /@reduxjs\/toolkit|from "zustand"|useAppDispatch/);
  assert.ok(!registryUpdates.some((entry) => entry.relativePath.includes('generated-reducers')));
});

test('React forms none does not generate Zod or react-hook-form', async () => {
  const config = frontendConfig({ forms: 'none' });
  const { files } = await planFrontendFeature(config);
  const source = joined(files);
  assert.doesNotMatch(source, /from "zod"|react-hook-form|zodResolver/);
  assert.ok(!paths(files).some((item) => item.includes('/schemas/')));
  assert.match(source, /onChange/);
});

test('Website surface does not register create/edit Vite routes', async () => {
  const config = frontendConfig({ framework: 'vite' }, 'both');
  const { files, registryUpdates } = await planFrontendFeature(config);
  const routeUpdate = registryUpdates.find((entry) =>
    entry.relativePath.replaceAll('\\', '/').includes('generated-routes'),
  );
  assert.ok(routeUpdate);
  const contents = routeUpdate.update('');
  assert.match(contents, /ProductsPublicPage/);
  const websiteBlock = contents.match(
    /export const generatedWebsiteRoutes: RouteObject\[\] = \[([\s\S]*?)\];/,
  );
  assert.ok(websiteBlock);
  assert.match(websiteBlock[1], /ProductsPublicPage/);
  assert.doesNotMatch(websiteBlock[1], /CreateProductPage|EditProductPage|ProductsPage/);
  const dashboardBlock = contents.match(
    /export const generatedDashboardRoutes: RouteObject\[\] = \[([\s\S]*?)\];/,
  );
  assert.ok(dashboardBlock);
  assert.match(dashboardBlock[1], /CreateProductPage/);
  assert.ok(paths(files).some((item) => item.endsWith('ProductsPublicPage.tsx')));
});

test('Fetch api client supports generics, FormData, and interceptors', () => {
  const source = renderApiClientSource({ httpClient: 'fetch' });
  assert.doesNotMatch(source, /axios/);
  assert.match(source, /instanceof FormData/);
  assert.match(source, /send<T>/);
  assert.match(source, /interceptors/);
  assert.match(source, /headers\.set/);
  assert.match(source, /headers\["Content-Type"\] = "application\/json"/);
});

test('AutoMapper mapping generates a profile instead of a manual ToDto class', () => {
  const config = backendConfig({
    backend: { mapping: 'automapper', authentication: 'none' },
  });
  const files = planBackendFeature(config);
  assert.ok(paths(files).some((item) => item.endsWith('ProductMappingProfile.cs')));
  assert.ok(!paths(files).some((item) => item.endsWith('ProductMappings.cs')));
  const source = joined(files);
  assert.match(source, /: Profile/);
  assert.match(source, /_mapper\.Map<ProductDto>/);
});

test('hasBackend is false when backend.enabled is false', () => {
  const config = frontendConfig();
  assert.equal(config.backend.enabled, false);
  assert.equal(config.authentication, 'none');
});
