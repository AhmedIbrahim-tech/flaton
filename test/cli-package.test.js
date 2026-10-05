import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  getBinCommandName,
  parseArguments,
  printHelp,
  readPackageMeta,
} from '../src/cli/arguments.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(repoRoot, 'bin', 'flatron.js');

test('package name is flatron', () => {
  const pkg = readPackageMeta();
  assert.equal(pkg.name, 'flatron');
});

test('CLI bin command is flatron', () => {
  const pkg = readPackageMeta();
  assert.equal(getBinCommandName(), 'flatron');
  assert.equal(pkg.bin['flatron'], './bin/flatron.js');
  assert.equal(pkg.bin['generate-fullstack-app'], undefined);
  assert.equal(pkg.bin['create-fullstack-app'], undefined);
  assert.equal(fs.existsSync(binPath), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'bin', 'generate-fullstack-app.js')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'bin', 'create-fullstack-app.js')), false);
});

test('flatron TestApp is accepted by the CLI', () => {
  const parsed = parseArguments(['node', 'flatron', 'TestApp', '--yes']);
  assert.equal(parsed.projectName, 'TestApp');
  assert.equal(parsed.yes, true);

  const helpRun = spawnSync(process.execPath, [binPath, 'TestApp', '--help'], {
    encoding: 'utf8',
  });
  assert.equal(helpRun.status, 0, helpRun.stderr);
  assert.match(helpRun.stdout, /flatron/);
  assert.doesNotMatch(helpRun.stdout, /generate-fullstack-app/);
  assert.doesNotMatch(helpRun.stdout, /create-fullstack-app/);

  const versionRun = spawnSync(process.execPath, [binPath, '--version'], {
    encoding: 'utf8',
  });
  assert.equal(versionRun.status, 0, versionRun.stderr);
  assert.match(versionRun.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('old generate-fullstack-app and create-fullstack-app commands are no longer documented', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /generate-fullstack-app/);
  assert.doesNotMatch(readme, /create-fullstack-app/);
  assert.match(readme, /npm install -g flatron/);
  assert.match(readme, /flatron MyApp/);

  let helpText = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    helpText += chunk;
    return true;
  };
  try {
    printHelp();
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(helpText, /flatron/);
  assert.doesNotMatch(helpText, /generate-fullstack-app/);
  assert.doesNotMatch(helpText, /create-fullstack-app/);
});
