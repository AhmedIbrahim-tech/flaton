import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../src/utils/command.js';
import { run } from '../src/utils/package-manager.js';
import { pathExists } from '../src/utils/filesystem.js';
import { loadProjectLayout, backendFile, frontendFile } from './smoke-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatorRoot = path.resolve(__dirname, '..');
const SMOKE_PREFIX = 'cfa-v3-smoke-';

function pass(message) {
  process.stdout.write(`✓ ${message}\n`);
}

function fail(message) {
  process.stderr.write(`✗ ${message}\n`);
  process.exitCode = 1;
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

function createProject(projectName, frontendArgs, outputDir) {
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
    ],
    {
      cwd: generatorRoot,
      step: `Create ${projectName}`,
    },
  );
}

function generateFeature(projectDir, featureName, fieldArgs, extraArgs = []) {
  runCommand(
    process.execPath,
    [
      path.join(generatorRoot, 'bin', 'create-fullstack-feature.js'),
      featureName,
      '--yes',
      '--fullstack',
      '--surface',
      'both',
      ...fieldArgs.flatMap((field) => ['--field', field]),
      ...extraArgs,
    ],
    {
      cwd: projectDir,
      step: `Generate feature ${featureName}`,
    },
  );
}

async function ensureBackendBuild(layout) {
  runCommand('dotnet', ['restore'], { cwd: layout.backendDir, step: 'dotnet restore' });
  runCommand('dotnet', ['build'], { cwd: layout.backendDir, step: 'dotnet build' });
}

async function buildFrontend(layout, framework) {
  run('npm', 'build', { cwd: layout.frontendDir, step: `${framework} build` });
}

async function verifyProductArchitecture(layout, framework) {
  await assertExists(
    backendFile(layout, 'Domain', 'Entities', 'Product.cs'),
    'Domain Product entity',
  );
  await assertExists(
    backendFile(layout, 'Domain', 'Enums', 'ProductStatus.cs'),
    'ProductStatus enum',
  );
  await assertExists(
    backendFile(layout, 'Domain', 'Entities', 'StoredFile.cs'),
    'StoredFile entity',
  );
  await assertExists(
    backendFile(layout, 'Application', 'Features', 'Product'),
    'Product application feature',
  );
  await assertExists(
    backendFile(layout, 'API', 'Controllers', 'ProductsController.cs'),
    'Products controller',
  );
  await assertExists(
    backendFile(layout, 'API', 'Contracts', 'Router.cs'),
    'Central Router.cs',
  );

  const productCs = await fs.readFile(
    backendFile(layout, 'Domain', 'Entities', 'Product.cs'),
    'utf8',
  );
  if (!productCs.includes('CategoryId')) {
    throw new Error('Product entity missing CategoryId');
  }
  if (!productCs.includes('ICollection<Tag>')) {
    throw new Error('Product entity missing Tags collection');
  }
  pass('Product FK + Tags navigation');

  if (framework === 'angular') {
    await assertExists(
      frontendFile(layout, 'src', 'app', 'features', 'products'),
      'Angular products feature',
    );
    const featureRoot = frontendFile(layout, 'src', 'app', 'features', 'products');
    await assertExists(path.join(featureRoot, 'store', 'product.actions.ts'), 'NgRx actions');
    await assertExists(path.join(featureRoot, 'store', 'product.effects.ts'), 'NgRx effects');
    const pkg = await fs.readFile(frontendFile(layout, 'package.json'), 'utf8');
    if (pkg.includes('@reduxjs/toolkit') || pkg.includes('react-redux')) {
      throw new Error('Angular client leaked React Redux packages');
    }
    pass('Angular isolation');
  } else {
    const thunks = frontendFile(
      layout,
      'src',
      'modules',
      'products',
      'slices',
      'thunks',
    );
    await assertExists(thunks, 'React slices/thunks');
    await assertMissing(
      frontendFile(layout, 'src', 'modules', 'products', 'thunks'),
      'Incorrect modules/products/thunks must not exist',
    );
    await assertExists(
      frontendFile(layout, 'src', 'shared', 'components', 'forms', 'LookupSelect.tsx'),
      'LookupSelect shared control',
    );
    await assertExists(
      frontendFile(layout, 'src', 'store', 'generated-reducers.ts'),
      'generated reducers registry',
    );

    const reducers = await fs.readFile(
      frontendFile(layout, 'src', 'store', 'generated-reducers.ts'),
      'utf8',
    );
    if (!reducers.includes('products')) {
      throw new Error('products reducer not registered');
    }
    pass('Redux products registration');

    if (framework === 'vite') {
      const routes = await fs.readFile(
        frontendFile(layout, 'src', 'app', 'router', 'generated-routes.tsx'),
        'utf8',
      );
      if (!routes.includes('products')) {
        throw new Error('Vite routes missing products');
      }
      pass('Vite route registration');
      const serverService = frontendFile(
        layout,
        'src',
        'modules',
        'products',
        'services',
        'product.server.service.ts',
      );
      await assertMissing(serverService, 'Vite must not have server.service');
    }

    if (framework === 'next') {
      await assertExists(
        frontendFile(
          layout,
          'src',
          'app',
          '(dashboard)',
          'dashboard',
          'products',
          'page.tsx',
        ),
        'Next dashboard products page',
      );
      await assertExists(
        frontendFile(layout, 'src', 'app', '(website)', 'products', 'page.tsx'),
        'Next public products page',
      );
    }
  }
}

async function generateAdvancedModel(projectDir) {
  generateFeature(projectDir, 'Category', ['Name:string:required:max=150']);
  generateFeature(projectDir, 'Tag', ['Name:string:required:max=100']);
  generateFeature(projectDir, 'Product', [
    'Name:string:required:max=200',
    'Price:decimal:required:min=0:precision=18:scale=2',
    'Category:relationship:target=Category:type=many-to-one:required:display=Name',
    'Tags:relationship:target=Tag:type=many-to-many:display=Name',
    'Status:enum:name=ProductStatus:values=Draft|Active|Archived:required',
    'CoverImage:image:single',
    'Gallery:image:multiple:max-files=8',
  ]);
}

async function runMatrixEntry({ name, frontendArgs, framework }) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), SMOKE_PREFIX));
  process.stdout.write(`\n=== ${name} (${outputDir}) ===\n`);

  createProject(name, frontendArgs, outputDir);
  const projectDir = path.join(outputDir, name);
  const layout = await loadProjectLayout(projectDir);

  // Dry-run must not mutate
  const before = await snapshotFiles(projectDir);
  generateFeature(
    projectDir,
    'Category',
    ['Name:string:required:max=150'],
    ['--dry-run'],
  );
  const after = await snapshotFiles(projectDir);
  if (before !== after) {
    throw new Error('Dry-run mutated the filesystem');
  }
  pass('Dry-run zero mutation');

  await generateAdvancedModel(projectDir);
  await verifyProductArchitecture(layout, framework);

  // Duplicate protection
  let refused = false;
  try {
    generateFeature(projectDir, 'Product', [
      'Name:string:required:max=200',
    ]);
  } catch {
    refused = true;
  }
  if (!refused) {
    throw new Error('Duplicate Product generation should have been refused');
  }
  pass('Duplicate protection');

  await ensureBackendBuild(layout);
  pass(`${name} backend build`);

  await buildFrontend(layout, framework);
  pass(`${name} frontend build`);

  return projectDir;
}

async function snapshotFiles(dir) {
  const entries = [];
  async function walk(current) {
    const list = await fs.readdir(current, { withFileTypes: true });
    for (const entry of list) {
      if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        entries.push(path.relative(dir, full).replaceAll('\\', '/'));
      }
    }
  }
  await walk(dir);
  return entries.sort().join('\n');
}

async function main() {
  const results = [];

  results.push(
    await runMatrixEntry({
      name: 'V3NextSmoke',
      frontendArgs: ['--frontend', 'react', '--react-framework', 'next'],
      framework: 'next',
    }),
  );

  results.push(
    await runMatrixEntry({
      name: 'V3ViteSmoke',
      frontendArgs: ['--frontend', 'react', '--react-framework', 'vite'],
      framework: 'vite',
    }),
  );

  results.push(
    await runMatrixEntry({
      name: 'V3AngularSmoke',
      frontendArgs: ['--frontend', 'angular'],
      framework: 'angular',
    }),
  );

  process.stdout.write('\nV3 smoke matrix complete.\n');
  for (const dir of results) {
    process.stdout.write(`  ${dir}\n`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
