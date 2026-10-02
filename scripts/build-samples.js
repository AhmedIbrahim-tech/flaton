import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { generateBackend } from '../src/generators/backend.generator.js';
import { generateSolution } from '../src/generators/solution.generator.js';
import { writeGenerationManifest } from '../src/generators/manifest.generator.js';
import { generateFeature } from '../src/feature-generator/feature.generator.js';
import { runCommand } from '../src/utils/command.js';

async function buildSample(name, architecture, mapping) {
  console.log(`\n========================================`);
  console.log(`Building Sample: ${name}`);
  console.log(`Architecture: ${architecture}`);
  console.log(`Mapping: ${mapping}`);
  console.log(`========================================`);

  const targetDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `sample-${name}-`));
  const pascalName = `${name}App`;

  try {
    const backendOptions = {
      enabled: true,
      architecture,
      mapping,
      orm: 'efcore',
      database: 'sqlite',
      authentication: 'none',
      realtime: 'none',
      logging: 'serilog',
      backgroundJobs: 'none',
    };

    // 1. Write manifest
    await writeGenerationManifest({
      pascalName,
      targetDirectory,
      backend: backendOptions,
      paths: { backend: 'Backend', frontend: null },
      packageManager: 'npm',
    });

    // 2. Generate backend
    const backendDirectory = path.join(targetDirectory, 'Backend');
    await generateBackend({
      pascalName,
      targetDirectory,
      backendDirectory,
      backend: backendOptions,
      architecture,
      mapping,
      orm: 'efcore',
      sqlServer: false,
      authMode: 'none',
      logging: 'serilog',
      backgroundJobs: 'none',
    });

    await generateSolution({
      pascalName,
      targetDirectory,
      backendDirectory,
      paths: { backend: 'Backend' },
    });

    // 3. Generate feature (Product)
    await generateFeature({
      projectRoot: targetDirectory,
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
      mode: 'backend',
    });

    // 4. Dotnet restore & build
    console.log(`Running dotnet restore in ${backendDirectory}...`);
    runCommand('dotnet', ['restore'], {
      cwd: backendDirectory,
      step: `dotnet restore ${name}`,
    });

    console.log(`Running dotnet build in ${backendDirectory}...`);
    const buildResult = runCommand('dotnet', ['build', '--no-restore'], {
      cwd: backendDirectory,
      step: `dotnet build ${name}`,
    });

    console.log(`SUCCESS: ${name} built cleanly!`);
    return { name, architecture, mapping, success: true };
  } catch (err) {
    console.error(`FAILED: ${name}:`, err);
    return { name, architecture, mapping, success: false, error: err.message };
  } finally {
    try {
      fs.rmSync(targetDirectory, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  const results = [];
  results.push(await buildSample('SampleA', 'services', 'manual'));
  results.push(await buildSample('SampleB', 'services', 'automapper'));
  results.push(await buildSample('SampleC', 'cqrs-mediatr', 'manual'));

  console.log('\n========================================');
  console.log('SUMMARY OF SAMPLE BUILDS');
  console.log('========================================');
  let allSuccess = true;
  for (const r of results) {
    console.log(`${r.name} (${r.architecture}, ${r.mapping}): ${r.success ? 'PASS' : 'FAIL'}`);
    if (!r.success) allSuccess = false;
  }

  if (!allSuccess) {
    process.exitCode = 1;
  }
}

await main();
