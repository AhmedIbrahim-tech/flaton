import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertBackendCompatibility,
  shouldGenerateIdentityArtifacts,
} from '../src/models/backend.js';
import { buildFeatureConfig } from '../src/feature-generator/feature.config.js';
import { planBackendFeature } from '../src/feature-generator/backend/backend-feature.generator.js';
import { renderInfrastructureDi } from '../src/generators/backend.generator.js';
import { planAuthBackend } from '../src/module-generator/auth/auth-backend.generator.js';
import { setModuleManifestContext } from '../src/module-generator/modules-orchestrator-helpers.js';

function featureConfig(overrides = {}) {
  const architecture = overrides.architecture ?? 'cqrs-mediatr';
  const orm = overrides.orm ?? 'efcore';
  const database = overrides.database ?? 'sqlserver';
  const authentication = overrides.authentication ?? 'none';

  return buildFeatureConfig({
    singularName: 'Product',
    fields: [{ name: 'Name', type: 'string' }],
    architecture,
    orm,
    database,
    manifest: {
      backend: { enabled: true, architecture, orm, database, authentication },
      frontend: { enabled: false },
      paths: { backend: 'Backend', frontend: null },
    },
    projectRoot: '/test',
    projectName: 'TestApp',
    frontendStrategy: { library: null },
  });
}

test('EF Core + Identity + JWT remains a supported combination', () => {
  assert.doesNotThrow(() =>
    assertBackendCompatibility({ orm: 'efcore', authentication: 'identity-jwt' }),
  );
  assert.equal(shouldGenerateIdentityArtifacts('identity-jwt'), true);

  const manifest = {
    backend: { enabled: true, orm: 'efcore', authentication: 'identity-jwt' },
    frontend: { enabled: false },
    paths: { backend: 'Backend', frontend: null },
  };
  setModuleManifestContext(manifest);
  try {
    const files = planAuthBackend({
      projectName: 'TestApp',
      manifest,
    });
    assert.ok(files.some((file) => file.relativePath.replaceAll('\\', '/').endsWith('RoleSeeder.cs')));
    assert.ok(files.some((file) => file.relativePath.replaceAll('\\', '/').endsWith('DatabaseSeeder.cs')));
    assert.ok(files.some((file) => /AddEntityFrameworkStores/.test(file.contents)));
    assert.ok(files.some((file) => file.relativePath.replaceAll('\\', '/').includes('Infrastructure/Identity/Entities/ApplicationUser.cs')));
    assert.ok(files.some((file) => file.relativePath.replaceAll('\\', '/').includes('Infrastructure/Authentication/Services/JwtTokenService.cs')));
    assert.ok(files.some((file) => file.relativePath.replaceAll('\\', '/').endsWith('AuthenticationServiceExtensions.cs')));
    assert.ok(files.some((file) => file.relativePath.replaceAll('\\', '/').endsWith('API/Controllers/AuthController.cs')));
    assert.ok(files.every((file) => !file.relativePath.includes('Endpoints')));
    const authController = files.find((file) =>
      file.relativePath.replaceAll('\\', '/').endsWith('API/Controllers/AuthController.cs'),
    );
    assert.match(authController.contents, /\[ApiController\]/);
    assert.match(authController.contents, /sealed class AuthController : ApiControllerBase/);
    assert.match(authController.contents, /\[HttpPost\(Router\.Authentication\.Login\)\]/);
    assert.doesNotMatch(authController.contents, /MapGet\(|MapPost\(|MapGroup\(/);
    assert.ok(files.every((file) => !file.relativePath.includes('.g.cs')));
  } finally {
    setModuleManifestContext(null);
  }

  const planned = planBackendFeature(featureConfig({ orm: 'efcore', architecture: 'cqrs-mediatr' }));
  assert.ok(planned.some((file) => file.contents.includes('IApplicationDbContext')));
  assert.ok(planned.some((file) => file.contents.includes('IEntityTypeConfiguration')));
});

test('Dapper-only without Identity generates repositories and no EF Core types', () => {
  assert.doesNotThrow(() =>
    assertBackendCompatibility({ orm: 'dapper', authentication: 'none' }),
  );
  assert.equal(shouldGenerateIdentityArtifacts('none'), false);

  const files = planBackendFeature(
    featureConfig({ orm: 'dapper', authentication: 'none', architecture: 'cqrs-mediatr' }),
  );
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotMatch(
      file.contents,
      /Microsoft\.EntityFrameworkCore|IApplicationDbContext|ApplicationDbContext|IEntityTypeConfiguration/,
      `Unexpected EF Core usage in ${file.relativePath}`,
    );
  }
  assert.ok(
    files.some((file) => file.relativePath.replaceAll('\\', '/').endsWith('IProductsRepository.cs')),
  );
  assert.ok(
    files.some((file) => file.relativePath.replaceAll('\\', '/').endsWith('ProductsRepository.cs')),
  );
  assert.ok(files.some((file) => file.contents.includes('IDbConnectionFactory')));
});

test('EF Core + Dapper hybrid keeps EF Core feature files and Dapper DI', () => {
  assert.doesNotThrow(() =>
    assertBackendCompatibility({ orm: 'efcore-dapper', authentication: 'identity-jwt' }),
  );

  const files = planBackendFeature(featureConfig({ orm: 'efcore-dapper' }));
  assert.ok(files.some((file) => file.contents.includes('IApplicationDbContext')));
  assert.ok(files.some((file) => file.relativePath.includes('Configuration.cs')));

  const di = renderInfrastructureDi('TestApp', {
    orm: 'efcore-dapper',
    database: 'sqlserver',
    backgroundJobs: 'none',
  });
  assert.match(di, /AddDbContext<ApplicationDbContext>/);
  assert.match(di, /IDbConnectionFactory/);
  assert.doesNotMatch(di, /AddHangfire/);
});

test('Dapper-only + Identity is rejected with a clear CLI message', () => {
  assert.throws(
    () => assertBackendCompatibility({ orm: 'dapper', authentication: 'identity-jwt' }),
    /Identity requires EF Core/,
  );
  assert.throws(
    () => assertBackendCompatibility({ orm: 'dapper', authentication: 'identity' }),
    /Identity requires EF Core/,
  );

  const manifest = {
    backend: { enabled: true, orm: 'dapper', authentication: 'none' },
    frontend: { enabled: false },
    paths: { backend: 'Backend', frontend: null },
  };
  setModuleManifestContext(manifest);
  try {
    assert.throws(
      () => planAuthBackend({ projectName: 'TestApp', manifest, orm: 'dapper' }),
      /Identity requires EF Core|Dapper-only/,
    );
  } finally {
    setModuleManifestContext(null);
  }
});

test('Hangfire storage is valid for Dapper-only SQL Server, PostgreSQL, and SQLite', () => {
  const sqlServer = renderInfrastructureDi('TestApp', {
    orm: 'dapper',
    database: 'sqlserver',
    backgroundJobs: 'hangfire',
  });
  assert.match(sqlServer, /var connectionString = configuration\.GetConnectionString/);
  assert.match(sqlServer, /UseSqlServerStorage\(connectionString\)/);
  assert.doesNotMatch(sqlServer, /AddDbContext/);
  assert.match(sqlServer, /IDbConnectionFactory/);

  const postgres = renderInfrastructureDi('TestApp', {
    orm: 'dapper',
    database: 'postgresql',
    backgroundJobs: 'hangfire',
  });
  assert.match(postgres, /var connectionString = configuration\.GetConnectionString/);
  assert.match(postgres, /UsePostgreSqlStorage\(connectionString\)/);

  const sqlite = renderInfrastructureDi('TestApp', {
    orm: 'dapper',
    database: 'sqlite',
    backgroundJobs: 'hangfire',
  });
  assert.match(sqlite, /UseMemoryStorage\(\)/);
  assert.doesNotMatch(sqlite, /UseSqlServerStorage\(connectionString\)/);
  assert.doesNotMatch(sqlite, /UsePostgreSqlStorage\(connectionString\)/);
});

test('Identity seeders are not planned when authentication is none', () => {
  assert.equal(shouldGenerateIdentityArtifacts('none'), false);
  assert.equal(shouldGenerateIdentityArtifacts(undefined), false);
  assert.equal(shouldGenerateIdentityArtifacts('identity-jwt'), true);
});
