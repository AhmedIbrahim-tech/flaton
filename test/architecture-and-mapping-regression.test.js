import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateBackend } from '../src/generators/backend.generator.js';
import { planBackendFeature, planBackendRegistryUpdates, backendConflictPaths } from '../src/feature-generator/backend/backend-feature.generator.js';
import { buildFeatureConfig } from '../src/feature-generator/feature.config.js';
import { resolveBackendMapping } from '../src/feature-generator/feature-profile.js';

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sampleFeatureConfig(overrides = {}) {
  return buildFeatureConfig({
    singularName: 'Product',
    pluralName: 'Products',
    fields: [
      { name: 'Name', type: 'string', required: true, searchable: true },
      { name: 'Price', type: 'decimal', required: true, minimum: 0 },
      { name: 'Sku', type: 'string', required: true },
    ],
    operations: {
      search: true,
      getById: true,
      create: true,
      update: true,
      delete: true,
      restore: false,
    },
    ...overrides,
  });
}

test('1. Services architecture project scaffolding: Application/Modules exists, Application/Features and Behaviors do not exist, no MediatR', async () => {
  const dir = createTempDir('services-scaffold-');
  try {
    await generateBackend({
      pascalName: 'ServicesApp',
      targetDirectory: dir,
      architecture: 'services',
      mapping: 'manual',
      orm: 'efcore',
      sqlServer: false,
      authMode: 'none',
    });

    const modulesDir = path.join(dir, 'Application', 'Modules');
    const featuresDir = path.join(dir, 'Application', 'Features');
    const behaviorsDir = path.join(dir, 'Application', 'Behaviors');

    assert.ok(fs.existsSync(modulesDir), 'Application/Modules directory must exist');
    assert.ok(!fs.existsSync(featuresDir), 'Application/Features directory must NOT exist');
    assert.ok(!fs.existsSync(behaviorsDir), 'Application/Behaviors directory must NOT exist');

    const appCsproj = fs.readFileSync(path.join(dir, 'Application', 'Application.csproj'), 'utf8');
    assert.doesNotMatch(appCsproj, /MediatR/, 'Application.csproj must not reference MediatR');

    const appDi = fs.readFileSync(
      path.join(dir, 'Application', 'DependencyInjection', 'ApplicationServiceExtensions.cs'),
      'utf8',
    );
    assert.doesNotMatch(appDi, /MediatR/, 'ApplicationServiceExtensions.cs must not reference MediatR');
    assert.match(appDi, /RegisterFeatureServices/, 'ApplicationServiceExtensions.cs should contain RegisterFeatureServices');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('2. CQRS architecture project scaffolding: Application/Features exists, Application/Modules does not exist, MediatR configured', async () => {
  const dir = createTempDir('cqrs-scaffold-');
  try {
    await generateBackend({
      pascalName: 'CqrsApp',
      targetDirectory: dir,
      architecture: 'cqrs-mediatr',
      mapping: 'manual',
      orm: 'efcore',
      sqlServer: false,
      authMode: 'none',
    });

    const featuresDir = path.join(dir, 'Application', 'Features');
    const modulesDir = path.join(dir, 'Application', 'Modules');

    assert.ok(fs.existsSync(featuresDir), 'Application/Features directory must exist');
    assert.ok(!fs.existsSync(modulesDir), 'Application/Modules directory must NOT exist');

    const appCsproj = fs.readFileSync(path.join(dir, 'Application', 'Application.csproj'), 'utf8');
    assert.match(appCsproj, /MediatR/, 'Application.csproj must reference MediatR');

    const appDi = fs.readFileSync(
      path.join(dir, 'Application', 'DependencyInjection', 'ApplicationServiceExtensions.cs'),
      'utf8',
    );
    assert.match(appDi, /AddMediatR/, 'ApplicationServiceExtensions.cs must configure AddMediatR');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('3. Manual Mapping scaffolding: no AutoMapper package, no AddAutoMapper, no IMapper, no Profile classes', async () => {
  const dir = createTempDir('manual-mapping-');
  try {
    await generateBackend({
      pascalName: 'ManualMapApp',
      targetDirectory: dir,
      architecture: 'services',
      mapping: 'manual',
      orm: 'efcore',
      sqlServer: false,
      authMode: 'none',
    });

    const appCsproj = fs.readFileSync(path.join(dir, 'Application', 'Application.csproj'), 'utf8');
    assert.doesNotMatch(appCsproj, /AutoMapper/, 'Application.csproj must NOT reference AutoMapper package');

    const appDi = fs.readFileSync(
      path.join(dir, 'Application', 'DependencyInjection', 'ApplicationServiceExtensions.cs'),
      'utf8',
    );
    assert.doesNotMatch(appDi, /AddAutoMapper/, 'ApplicationServiceExtensions.cs must NOT contain AddAutoMapper');
    assert.doesNotMatch(appDi, /using AutoMapper;/, 'ApplicationServiceExtensions.cs must NOT contain using AutoMapper');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('4. AutoMapper scaffolding: AutoMapper package and DI registration generated', async () => {
  const dir = createTempDir('automapper-scaffold-');
  try {
    await generateBackend({
      pascalName: 'AutoMapApp',
      targetDirectory: dir,
      architecture: 'services',
      mapping: 'automapper',
      orm: 'efcore',
      sqlServer: false,
      authMode: 'none',
    });

    const appCsproj = fs.readFileSync(path.join(dir, 'Application', 'Application.csproj'), 'utf8');
    assert.match(appCsproj, /AutoMapper/, 'Application.csproj must reference AutoMapper package');

    const appDi = fs.readFileSync(
      path.join(dir, 'Application', 'DependencyInjection', 'ApplicationServiceExtensions.cs'),
      'utf8',
    );
    assert.match(appDi, /AddAutoMapper/, 'ApplicationServiceExtensions.cs must contain AddAutoMapper');
    assert.match(appDi, /using AutoMapper;/, 'ApplicationServiceExtensions.cs must contain using AutoMapper');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('5. create-fullstack-feature respects Modules for Services and Features for CQRS', () => {
  // Services
  const servicesConfig = sampleFeatureConfig({
    architecture: 'services',
    mapping: 'manual',
  });
  const servicesFiles = planBackendFeature(servicesConfig);
  const servicesPaths = servicesFiles.map((f) => f.relativePath.replaceAll('\\', '/'));

  assert.ok(
    servicesPaths.some((p) => p.includes('Application/Modules/Products/DTOs/ProductDto.cs')),
    'Expected DTOs/ProductDto.cs in Modules',
  );
  assert.ok(
    servicesPaths.some((p) => p.includes('Application/Modules/Products/DTOs/CreateProductDto.cs')),
    'Expected DTOs/CreateProductDto.cs in Modules',
  );
  assert.ok(
    servicesPaths.some((p) => p.includes('Application/Modules/Products/DTOs/UpdateProductDto.cs')),
    'Expected DTOs/UpdateProductDto.cs in Modules',
  );
  assert.ok(
    servicesPaths.some((p) => p.includes('Application/Modules/Products/DTOs/SearchProductsDto.cs')),
    'Expected DTOs/SearchProductsDto.cs in Modules',
  );
  assert.ok(
    servicesPaths.some((p) => p.includes('Application/Modules/Products/Interfaces/IProductService.cs')),
    'Expected Interfaces/IProductService.cs in Modules',
  );
  assert.ok(
    servicesPaths.some((p) => p.includes('Application/Modules/Products/Services/ProductService.cs')),
    'Expected Services/ProductService.cs in Modules',
  );
  assert.ok(
    servicesPaths.some((p) => p.includes('Application/Modules/Products/Validators/CreateProductValidator.cs')),
    'Expected Validators/CreateProductValidator.cs in Modules',
  );
  assert.ok(
    servicesPaths.some((p) => p.includes('Application/Modules/Products/Validators/UpdateProductValidator.cs')),
    'Expected Validators/UpdateProductValidator.cs in Modules',
  );
  assert.ok(
    servicesPaths.some((p) => p.includes('Application/Modules/Products/Mapping/ProductMappings.cs')),
    'Expected Mapping/ProductMappings.cs in Modules',
  );

  // Must not have any file in Application/Features
  for (const p of servicesPaths) {
    assert.ok(!p.includes('Application/Features'), `Path should not be in Application/Features: ${p}`);
  }

  // Must not have any MediatR references
  for (const f of servicesFiles) {
    if (f.relativePath.includes('Application')) {
      assert.doesNotMatch(f.contents, /using MediatR;/, `MediatR using found in ${f.relativePath}`);
      assert.doesNotMatch(f.contents, /IRequest</, `IRequest found in ${f.relativePath}`);
      assert.doesNotMatch(f.contents, /IRequestHandler</, `IRequestHandler found in ${f.relativePath}`);
      assert.doesNotMatch(f.contents, /ISender/, `ISender found in ${f.relativePath}`);
    }
  }

  // Conflict paths for services
  const conflicts = backendConflictPaths(servicesConfig).map((p) => p.replaceAll('\\', '/'));
  assert.ok(
    conflicts.some((p) => p.includes('Application/Modules/Products')),
    'Conflict path should reference Application/Modules/Products',
  );

  // CQRS
  const cqrsConfig = sampleFeatureConfig({
    architecture: 'cqrs-mediatr',
    mapping: 'manual',
  });
  const cqrsFiles = planBackendFeature(cqrsConfig);
  const cqrsPaths = cqrsFiles.map((f) => f.relativePath.replaceAll('\\', '/'));

  assert.ok(
    cqrsPaths.some((p) => p.includes('Application/Features/Product/Commands/Create/CreateProductCommand.cs')),
    'Expected Commands in Features',
  );
  assert.ok(
    cqrsPaths.some((p) => p.includes('Application/Features/Product/Queries/Search/SearchProductsQuery.cs')),
    'Expected Queries in Features',
  );
  for (const p of cqrsPaths) {
    assert.ok(!p.includes('Application/Modules'), `Path should not be in Application/Modules: ${p}`);
  }

  const cqrsConflicts = backendConflictPaths(cqrsConfig).map((p) => p.replaceAll('\\', '/'));
  assert.ok(
    cqrsConflicts.some((p) => p.includes('Application/Features/Product')),
    'CQRS Conflict path should reference Application/Features/Product',
  );
});

test('5b. create-fullstack-feature respects selected mapping strategy', () => {
  // Manual mapping feature
  const manualConfig = sampleFeatureConfig({
    architecture: 'services',
    mapping: 'manual',
  });
  const manualFiles = planBackendFeature(manualConfig);
  const manualPaths = manualFiles.map((f) => f.relativePath.replaceAll('\\', '/'));

  assert.ok(
    manualPaths.some((p) => p.endsWith('ProductMappings.cs')),
    'Manual mapping should produce ProductMappings.cs',
  );
  assert.ok(
    !manualPaths.some((p) => p.endsWith('ProductMappingProfile.cs')),
    'Manual mapping must not produce ProductMappingProfile.cs',
  );
  for (const f of manualFiles) {
    assert.doesNotMatch(f.contents, /using AutoMapper;/, `AutoMapper using found in ${f.relativePath}`);
    assert.doesNotMatch(f.contents, /IMapper/, `IMapper found in ${f.relativePath}`);
  }

  // AutoMapper feature
  const autoMapConfig = sampleFeatureConfig({
    architecture: 'services',
    mapping: 'automapper',
  });
  const autoMapFiles = planBackendFeature(autoMapConfig);
  const autoMapPaths = autoMapFiles.map((f) => f.relativePath.replaceAll('\\', '/'));

  assert.ok(
    autoMapPaths.some((p) => p.endsWith('ProductMappingProfile.cs')),
    'AutoMapper should produce ProductMappingProfile.cs',
  );
  assert.ok(
    !autoMapPaths.some((p) => p.endsWith('ProductMappings.cs')),
    'AutoMapper must not produce ProductMappings.cs',
  );
  const profileFile = autoMapFiles.find((f) => f.relativePath.replaceAll('\\', '/').endsWith('ProductMappingProfile.cs'));
  assert.ok(profileFile, 'Profile file must exist');
  assert.match(profileFile.contents, /Profile/, 'Profile file should inherit from Profile');
  assert.match(profileFile.contents, /CreateMap/, 'Profile file should call CreateMap');

  // Verify registry update adds AutoMapper registration
  const registryUpdates = planBackendRegistryUpdates(autoMapConfig);
  const diUpdate = registryUpdates.find((u) => u.relativePath.includes('ApplicationServiceExtensions.cs'));
  assert.ok(diUpdate, 'DI update must exist');
});

test('5c. Manifest backend.mapping is single source of truth', () => {
  const fromManifestAuto = resolveBackendMapping({
    manifest: { backend: { mapping: 'automapper' } },
  });
  assert.equal(fromManifestAuto, 'automapper');

  const fromManifestManual = resolveBackendMapping({
    manifest: { backend: { mapping: 'manual' } },
    mapping: 'automapper', // Input option overridden by manifest
  });
  assert.equal(fromManifestManual, 'manual', 'Manifest must override CLI option');

  const fallback = resolveBackendMapping({});
  assert.equal(fallback, 'manual');
});

test('6. Default Domain structure (Services): contains Entities, Enums, Exceptions; does not contain ValueObjects, DomainEvents, Specifications', async () => {
  const dir = createTempDir('domain-structure-services-');
  try {
    await generateBackend({
      pascalName: 'DomainServicesApp',
      targetDirectory: dir,
      architecture: 'services',
      mapping: 'manual',
      orm: 'efcore',
      sqlServer: false,
      authMode: 'none',
    });

    const domainDir = path.join(dir, 'Domain');
    assert.ok(fs.existsSync(path.join(domainDir, 'Entities')), 'Domain/Entities must exist');
    assert.ok(fs.existsSync(path.join(domainDir, 'Enums')), 'Domain/Enums must exist');
    assert.ok(fs.existsSync(path.join(domainDir, 'Exceptions')), 'Domain/Exceptions must exist');

    assert.ok(!fs.existsSync(path.join(domainDir, 'ValueObjects')), 'Domain/ValueObjects must NOT exist by default');
    assert.ok(!fs.existsSync(path.join(domainDir, 'DomainEvents')), 'Domain/DomainEvents must NOT exist by default');
    assert.ok(!fs.existsSync(path.join(domainDir, 'Specifications')), 'Domain/Specifications must NOT exist by default');
    assert.ok(!fs.existsSync(path.join(domainDir, 'Aggregates')), 'Domain/Aggregates must NOT exist by default');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('7. Default Domain structure (CQRS): contains Entities, Enums, Exceptions; does not contain ValueObjects, DomainEvents, Specifications', async () => {
  const dir = createTempDir('domain-structure-cqrs-');
  try {
    await generateBackend({
      pascalName: 'DomainCqrsApp',
      targetDirectory: dir,
      architecture: 'cqrs-mediatr',
      mapping: 'manual',
      orm: 'efcore',
      sqlServer: false,
      authMode: 'none',
    });

    const domainDir = path.join(dir, 'Domain');
    assert.ok(fs.existsSync(path.join(domainDir, 'Entities')), 'Domain/Entities must exist');
    assert.ok(fs.existsSync(path.join(domainDir, 'Enums')), 'Domain/Enums must exist');
    assert.ok(fs.existsSync(path.join(domainDir, 'Exceptions')), 'Domain/Exceptions must exist');

    assert.ok(!fs.existsSync(path.join(domainDir, 'ValueObjects')), 'Domain/ValueObjects must NOT exist by default');
    assert.ok(!fs.existsSync(path.join(domainDir, 'DomainEvents')), 'Domain/DomainEvents must NOT exist by default');
    assert.ok(!fs.existsSync(path.join(domainDir, 'Specifications')), 'Domain/Specifications must NOT exist by default');
    assert.ok(!fs.existsSync(path.join(domainDir, 'Aggregates')), 'Domain/Aggregates must NOT exist by default');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('8. CLI Data Access prompt uses simplified labels', () => {
  const promptsContent = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'prompts.js'), 'utf8');
  assert.match(promptsContent, /name: 'Entity Framework Core', value: 'efcore'/);
  assert.match(promptsContent, /name: 'Dapper', value: 'dapper'/);
  assert.match(promptsContent, /name: 'EF Core \+ Dapper \(EF for writes, Dapper for reads\)', value: 'efcore-dapper'/);

  assert.doesNotMatch(promptsContent, /Full ORM with migrations & interceptors/);
  assert.doesNotMatch(promptsContent, /Lightweight micro-ORM with high-performance SQL/);
});
