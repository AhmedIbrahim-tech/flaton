import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runCommand } from '../../../../utils/command.js';
import { add, addDev, install, packageManagerUserAgent } from '../../../../utils/package-manager.js';
import { copyTemplate, pathExists, templatesRoot, writeFile } from '../../../../utils/filesystem.js';
import { logger } from '../../../../utils/logger.js';
import { STAGING_DIR_NAME, promoteStagingClient } from '../../client-setup.js';
import { installReactCommonPackages, overlayReactCommon, writeReactProviders, finalizeReactLanguage } from '../react-common.generator.js';

/**
 * @param {object} options
 */
export async function generateViteFrontend(options) {
  const frontend = options.frontend ?? {};
  const isTs = frontend.language !== 'javascript';
  const isTailwind = frontend.styling !== 'bootstrap';
  const templateName = isTs ? 'react-ts' : 'react';
  const frontendDir = options.frontendDirectory ?? (options.paths?.frontend
    ? (options.paths.frontend === '.' ? options.targetDirectory : path.join(options.targetDirectory, options.paths.frontend))
    : options.targetDirectory);

  runCommand(
    'npx',
    [
      '--yes',
      'create-vite@latest',
      STAGING_DIR_NAME,
      '--template',
      templateName,
      '--no-interactive',
      '--eslint',
    ],
    {
      cwd: options.targetDirectory,
      step: 'Create Vite client',
      env: {
        ...process.env,
        CI: '1',
        npm_config_user_agent: packageManagerUserAgent(options.packageManager),
      },
    },
  );

  const clientDir = await promoteStagingClient(options.targetDirectory, frontendDir, options.folderName);
  logger.success('Frontend created');

  if (!(await pathExists(path.join(clientDir, 'node_modules')))) {
    install(options.packageManager, {
      cwd: clientDir,
      step: 'Install Vite scaffolding dependencies',
    });
  }

  installReactCommonPackages({ clientDir, packageManager: options.packageManager, frontend });

  add(options.packageManager, ['react-router-dom'], {
    cwd: clientDir,
    step: 'Install React Router',
  });

  if (isTailwind) {
    addDev(options.packageManager, ['tailwindcss', '@tailwindcss/vite'], {
      cwd: clientDir,
      step: 'Install Tailwind for Vite',
    });
  }

  if (frontend.localization ?? options.localization) {
    add(options.packageManager, ['i18next', 'react-i18next'], {
      cwd: clientDir,
      step: 'Install react-i18next',
    });
  }

  logger.success('Frontend dependencies installed');

  await overlayReactCommon({
    clientDir,
    packageManager: options.packageManager,
    replacements: options.replacements,
    frontend,
  });

  await copyTemplate(
    path.join(templatesRoot(), 'frontend', 'react', 'vite'),
    clientDir,
    options.replacements,
  );

  await writeReactProviders(clientDir, frontend);

  if (isTailwind) {
    await ensureTailwindCss(clientDir);
  } else {
    await ensureBootstrapCss(clientDir);
  }

  if (isTs) {
    await ensureTsconfigPaths(clientDir);
  }

  const defaultAppTs = path.join(clientDir, 'src', 'App.tsx');
  const defaultAppJs = path.join(clientDir, 'src', 'App.jsx');
  if (await pathExists(defaultAppTs)) {
    await fs.unlink(defaultAppTs);
  }
  if (await pathExists(defaultAppJs)) {
    await fs.unlink(defaultAppJs);
  }
  const defaultAppCss = path.join(clientDir, 'src', 'App.css');
  if (await pathExists(defaultAppCss)) {
    await fs.unlink(defaultAppCss);
  }

  if (!(frontend.localization ?? options.localization)) {
    await fs.rm(path.join(clientDir, 'src', 'i18n'), { recursive: true, force: true });
    await writePlainViteHome(clientDir, options.replacements);
    await stripI18nImport(clientDir);
  }

  await finalizeReactLanguage(clientDir, frontend);
}

async function ensureTailwindCss(clientDir) {
  const cssPath = path.join(clientDir, 'src', 'index.css');
  const current = (await pathExists(cssPath)) ? await fs.readFile(cssPath, 'utf8') : '';
  if (!current.includes('tailwindcss')) {
    await writeFile(cssPath, `@import "tailwindcss";\n${current}`);
  }
}

async function ensureBootstrapCss(clientDir) {
  const cssPath = path.join(clientDir, 'src', 'index.css');
  await writeFile(cssPath, '@import "bootstrap/dist/css/bootstrap.min.css";\n\nbody { margin: 0; padding: 0; }\n');
}

async function ensureTsconfigPaths(clientDir) {
  for (const fileName of ['tsconfig.app.json', 'tsconfig.json']) {
    const filePath = path.join(clientDir, fileName);
    if (!(await pathExists(filePath))) {
      continue;
    }

    const raw = await fs.readFile(filePath, 'utf8');
    const tsconfig = JSON.parse(stripJsonc(raw));
    tsconfig.compilerOptions = tsconfig.compilerOptions ?? {};
    tsconfig.compilerOptions.baseUrl = tsconfig.compilerOptions.baseUrl ?? '.';
    tsconfig.compilerOptions.paths = {
      ...(tsconfig.compilerOptions.paths ?? {}),
      '@/*': ['./src/*'],
    };
    tsconfig.compilerOptions.resolveJsonModule = true;
    tsconfig.compilerOptions.ignoreDeprecations =
      tsconfig.compilerOptions.ignoreDeprecations ?? '6.0';
    await fs.writeFile(filePath, `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8');
  }
}

/**
 * Strip // comments and trailing commas so Vite/TS JSONC configs parse.
 * @param {string} text
 */
function stripJsonc(text) {
  return text
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1');
}

async function writePlainViteHome(clientDir, replacements) {
  await writeFile(
    path.join(clientDir, 'src', 'app', 'pages', 'HomePage.tsx'),
    `import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { HomeLanding } from "@/shared/components/marketing/HomeLanding";
import type { AppLinkProps } from "@/shared/navigation/app-link";

function AppLink({ href, className, children, onClick }: AppLinkProps): ReactElement {
  return (
    <Link to={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

export function HomePage() {
  return <HomeLanding productName="${replacements.__DISPLAY_NAME__}" Link={AppLink} />;
}
`,
  );
}

async function stripI18nImport(clientDir) {
  for (const name of ['main.tsx', 'main.jsx']) {
    const mainPath = path.join(clientDir, 'src', name);
    if (!(await pathExists(mainPath))) {
      continue;
    }

    const contents = await fs.readFile(mainPath, 'utf8');
    await fs.writeFile(mainPath, contents.replace('import "@/i18n";\n', ''), 'utf8');
  }
}
