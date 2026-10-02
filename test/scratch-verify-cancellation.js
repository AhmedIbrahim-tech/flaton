import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function testScenarioA() {
  console.log('\n--- Scenario A: generate-fullstack-app Ctrl+C on first prompt ---');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'bin', 'generate-fullstack-app.js')], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      output += d.toString();
      if (output.includes('Project name') || output.includes('?')) {
        setTimeout(() => {
          child.stdin.write('\x03');
        }, 100);
      }
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      console.log('Exit code:', code);
      console.log('Output has friendly cancellation message:', output.includes('Project generation cancelled.'));
      console.log('No raw ExitPromptError or stack trace:', !output.includes('ExitPromptError') && !stderr.includes('ExitPromptError'));
      resolve({ code, output, stderr });
    });
  });
}

async function testScenarioB() {
  console.log('\n--- Scenario B: generate-fullstack-app reach "Generate project?" and press Ctrl+C ---');
  return new Promise((resolve) => {
    const testAppName = `test-cancel-app-${Date.now()}`;
    const child = spawn(process.execPath, [
      path.join(repoRoot, 'bin', 'generate-fullstack-app.js'),
      testAppName,
      '--fullstack',
      '--recommended',
    ], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let stderr = '';
    let sentAnswers = false;

    child.stdout.on('data', (d) => {
      output += d.toString();
      if (output.includes('Generate project?') && !sentAnswers) {
        sentAnswers = true;
        setTimeout(() => {
          child.stdin.write('\x03');
        }, 100);
      } else if (!sentAnswers) {
        // Press Enter to accept defaults through prompts if needed
        child.stdin.write('\r\n');
      }
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      console.log('Exit code:', code);
      console.log('Output has friendly cancellation message:', output.includes('Project generation cancelled.'));
      console.log('No raw ExitPromptError or stack trace:', !output.includes('ExitPromptError') && !stderr.includes('ExitPromptError'));
      const dirExists = fs.existsSync(path.join(repoRoot, testAppName));
      console.log('Project directory was not created:', !dirExists);
      if (dirExists) {
        fs.rmSync(path.join(repoRoot, testAppName), { recursive: true, force: true });
      }
      resolve({ code, output, stderr });
    });
  });
}

async function testScenarioC() {
  console.log('\n--- Scenario C: generate-fullstack-app reach "Generate project?" and choose No ---');
  return new Promise((resolve) => {
    const testAppName = `test-no-app-${Date.now()}`;
    const child = spawn(process.execPath, [
      path.join(repoRoot, 'bin', 'generate-fullstack-app.js'),
      testAppName,
      '--fullstack',
      '--recommended',
    ], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let stderr = '';
    let sentAnswers = false;

    child.stdout.on('data', (d) => {
      output += d.toString();
      if (output.includes('Generate project?') && !sentAnswers) {
        sentAnswers = true;
        setTimeout(() => {
          child.stdin.write('n\r\n');
        }, 100);
      } else if (!sentAnswers) {
        child.stdin.write('\r\n');
      }
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      console.log('Exit code:', code);
      console.log('Clean exit (code 0):', code === 0);
      console.log('Output has cancellation info message:', output.includes('Project generation cancelled.'));
      console.log('No error styling/stack trace:', !output.includes('Generation failed') && !stderr.includes('GenerationError'));
      const dirExists = fs.existsSync(path.join(repoRoot, testAppName));
      console.log('Project directory was not created:', !dirExists);
      if (dirExists) {
        fs.rmSync(path.join(repoRoot, testAppName), { recursive: true, force: true });
      }
      resolve({ code, output, stderr });
    });
  });
}

async function testScenarioD() {
  console.log('\n--- Scenario D: create-fullstack-feature Ctrl+C during wizard ---');
  const mockProjectDir = path.join(os.tmpdir(), `test-mock-project-${Date.now()}`);
  fs.mkdirSync(mockProjectDir, { recursive: true });
  fs.writeFileSync(path.join(mockProjectDir, '.fullstack-app.json'), JSON.stringify({
    name: 'MockApp',
    projectType: 'fullstack',
    backend: { enabled: true, architecture: 'cqrs', presentation: 'controllers' },
    frontend: { enabled: true, framework: 'react' },
    features: {},
    modules: {}
  }, null, 2));

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(repoRoot, 'bin', 'create-fullstack-feature.js'),
      'Product'
    ], {
      cwd: mockProjectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      output += d.toString();
      // On the first wizard prompt, send Ctrl+C
      if (output.includes('?') || output.includes('Field') || output.includes('plural')) {
        setTimeout(() => {
          child.stdin.write('\x03');
        }, 100);
      }
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      console.log('Exit code:', code);
      console.log('Output has friendly feature cancellation message:', output.includes('Feature generation cancelled.'));
      console.log('No raw ExitPromptError or stack trace:', !output.includes('ExitPromptError') && !stderr.includes('ExitPromptError'));
      const files = fs.readdirSync(mockProjectDir);
      console.log('No partial feature files generated:', files.length === 1 && files[0] === '.fullstack-app.json');
      fs.rmSync(mockProjectDir, { recursive: true, force: true });
      resolve({ code, output, stderr });
    });
  });
}

await testScenarioA();
await testScenarioB();
await testScenarioC();
await testScenarioD();
