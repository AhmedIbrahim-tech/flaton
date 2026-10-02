import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { generateProject } from '../src/generators/project.generator.js';

const samples = [
  {
    id: 'A',
    name: 'Sample A: EF Core + SQL Server',
    folderName: 'SampleA',
    pascalName: 'SampleA',
    backend: {
      enabled: true,
      architecture: 'cqrs-mediatr',
      presentation: 'controllers',
      authentication: 'none',
      authMode: 'none',
      orm: 'efcore',
      database: 'sqlserver',
      mapping: 'manual',
      validation: 'fluentvalidation',
      logging: 'serilog',
      caching: 'none',
      backgroundJobs: 'none',
    },
    modules: {},
    expectedPackages: [
      'Microsoft.EntityFrameworkCore',
      'Microsoft.EntityFrameworkCore.Design',
      'Microsoft.EntityFrameworkCore.Tools',
      'Microsoft.EntityFrameworkCore.SqlServer',
    ],
    forbiddenPackages: [
      'Npgsql.EntityFrameworkCore.PostgreSQL',
      'Microsoft.EntityFrameworkCore.Sqlite',
      'Dapper',
    ],
  },
  {
    id: 'B',
    name: 'Sample B: EF Core + PostgreSQL',
    folderName: 'SampleB',
    pascalName: 'SampleB',
    backend: {
      enabled: true,
      architecture: 'cqrs-mediatr',
      presentation: 'controllers',
      authentication: 'none',
      authMode: 'none',
      orm: 'efcore',
      database: 'postgresql',
      mapping: 'manual',
      validation: 'fluentvalidation',
      logging: 'serilog',
      caching: 'none',
      backgroundJobs: 'none',
    },
    modules: {},
    expectedPackages: [
      'Microsoft.EntityFrameworkCore',
      'Microsoft.EntityFrameworkCore.Design',
      'Microsoft.EntityFrameworkCore.Tools',
      'Npgsql.EntityFrameworkCore.PostgreSQL',
    ],
    forbiddenPackages: [
      'Microsoft.EntityFrameworkCore.SqlServer',
      'Microsoft.EntityFrameworkCore.Sqlite',
      'Dapper',
    ],
  },
  {
    id: 'C',
    name: 'Sample C: EF Core + SQLite',
    folderName: 'SampleC',
    pascalName: 'SampleC',
    backend: {
      enabled: true,
      architecture: 'cqrs-mediatr',
      presentation: 'controllers',
      authentication: 'none',
      authMode: 'none',
      orm: 'efcore',
      database: 'sqlite',
      mapping: 'manual',
      validation: 'fluentvalidation',
      logging: 'serilog',
      caching: 'none',
      backgroundJobs: 'none',
    },
    modules: {},
    expectedPackages: [
      'Microsoft.EntityFrameworkCore',
      'Microsoft.EntityFrameworkCore.Design',
      'Microsoft.EntityFrameworkCore.Tools',
      'Microsoft.EntityFrameworkCore.Sqlite',
    ],
    forbiddenPackages: [
      'Microsoft.EntityFrameworkCore.SqlServer',
      'Npgsql.EntityFrameworkCore.PostgreSQL',
      'Dapper',
    ],
  },
  {
    id: 'D',
    name: 'Sample D: EF Core + Dapper + PostgreSQL',
    folderName: 'SampleD',
    pascalName: 'SampleD',
    backend: {
      enabled: true,
      architecture: 'cqrs-mediatr',
      presentation: 'controllers',
      authentication: 'none',
      authMode: 'none',
      orm: 'efcore-dapper',
      database: 'postgresql',
      mapping: 'manual',
      validation: 'fluentvalidation',
      logging: 'serilog',
      caching: 'none',
      backgroundJobs: 'none',
    },
    modules: {},
    expectedPackages: [
      'Microsoft.EntityFrameworkCore',
      'Microsoft.EntityFrameworkCore.Design',
      'Microsoft.EntityFrameworkCore.Tools',
      'Npgsql.EntityFrameworkCore.PostgreSQL',
      'Dapper',
      'Npgsql',
    ],
    forbiddenPackages: [
      'Microsoft.EntityFrameworkCore.SqlServer',
      'Microsoft.EntityFrameworkCore.Sqlite',
    ],
  },
  {
    id: 'E',
    name: 'Sample E: Dapper-only + PostgreSQL',
    folderName: 'SampleE',
    pascalName: 'SampleE',
    backend: {
      enabled: true,
      architecture: 'cqrs-mediatr',
      presentation: 'controllers',
      authentication: 'none',
      authMode: 'none',
      orm: 'dapper',
      database: 'postgresql',
      mapping: 'manual',
      validation: 'fluentvalidation',
      logging: 'serilog',
      caching: 'none',
      backgroundJobs: 'none',
    },
    modules: {},
    expectedPackages: [
      'Dapper',
      'Npgsql',
    ],
    forbiddenPackages: [
      'Microsoft.EntityFrameworkCore',
      'Microsoft.EntityFrameworkCore.Design',
      'Microsoft.EntityFrameworkCore.Tools',
      'Microsoft.EntityFrameworkCore.SqlServer',
      'Npgsql.EntityFrameworkCore.PostgreSQL',
      'Microsoft.EntityFrameworkCore.Sqlite',
    ],
  },
];

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfa-ef-verify-'));
  console.log(`Working in ${tmpDir}\n`);

  for (const sample of samples) {
    console.log(`============================================================`);
    console.log(`Generating: ${sample.name}`);
    console.log(`============================================================`);

    await generateProject({
      displayName: sample.folderName,
      folderName: sample.folderName,
      pascalName: sample.pascalName,
      output: tmpDir,
      mode: 'backend',
      backend: sample.backend,
      frontend: { enabled: false },
      modules: sample.modules,
    });

    const projectDir = path.join(tmpDir, sample.folderName);
    const infraCsprojPath = path.join(projectDir, 'Infrastructure', 'Infrastructure.csproj');
    const infraCsproj = fs.readFileSync(infraCsprojPath, 'utf8');

    console.log(`\nVerifying Infrastructure.csproj for ${sample.folderName}:`);
    for (const pkg of sample.expectedPackages) {
      if (!infraCsproj.includes(`Include="${pkg}"`)) {
        throw new Error(`FAIL: Expected package ${pkg} not found in ${infraCsprojPath}`);
      }
      console.log(`  ✓ Contains expected package: ${pkg}`);
    }

    for (const pkg of sample.forbiddenPackages) {
      if (infraCsproj.includes(`Include="${pkg}"`)) {
        throw new Error(`FAIL: Forbidden package ${pkg} found in ${infraCsprojPath}`);
      }
      console.log(`  ✓ Does NOT contain: ${pkg}`);
    }

    if (sample.expectedPackages.includes('Microsoft.EntityFrameworkCore.Design')) {
      if (!infraCsproj.includes('<PrivateAssets>all</PrivateAssets>')) {
        throw new Error(`FAIL: PrivateAssets not found for tooling packages in ${infraCsprojPath}`);
      }
      console.log(`  ✓ Tooling packages configured with PrivateAssets = all`);
    }

    console.log(`\nBuilding: ${sample.folderName}...`);
    try {
      execSync('dotnet build', { cwd: projectDir, encoding: 'utf8' });
      console.log(`✓ BUILD SUCCESS: ${sample.name}\n`);
    } catch (err) {
      console.error(`✗ BUILD FAILED: ${sample.name}`);
      console.error(err.stdout || err.message);
      process.exit(1);
    }
  }

  console.log(`\n============================================================`);
  console.log(`ALL 5 SAMPLES VERIFIED AND BUILT SUCCESSFULLY!`);
  console.log(`============================================================`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
