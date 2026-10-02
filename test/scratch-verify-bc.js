import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

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
    let sentFinalCtrlC = false;

    child.stdout.on('data', (d) => {
      const text = d.toString();
      output += text;

      if (output.includes('Generate project?') && !sentFinalCtrlC) {
        sentFinalCtrlC = true;
        setTimeout(() => {
          child.stdin.write('\x03');
        }, 100);
      } else if (!sentFinalCtrlC) {
        if (text.includes('Select frontend:') ||
            text.includes('Select React framework:') ||
            text.includes('Continue with these settings?') ||
            text.includes('Package manager:')) {
          child.stdin.write('\r\n');
        }
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
    let sentFinalNo = false;

    child.stdout.on('data', (d) => {
      const text = d.toString();
      output += text;

      if (output.includes('Generate project?') && !sentFinalNo) {
        sentFinalNo = true;
        setTimeout(() => {
          child.stdin.write('n\r\n');
        }, 100);
      } else if (!sentFinalNo) {
        if (text.includes('Select frontend:') ||
            text.includes('Select React framework:') ||
            text.includes('Continue with these settings?') ||
            text.includes('Package manager:')) {
          child.stdin.write('\r\n');
        }
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

await testScenarioB();
await testScenarioC();
