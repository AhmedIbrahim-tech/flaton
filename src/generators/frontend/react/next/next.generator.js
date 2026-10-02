import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runCommand } from '../../../../utils/command.js';
import { add, getCreateNextAppPackageManagerFlag, packageManagerUserAgent } from '../../../../utils/package-manager.js';
import { copyTemplate, pathExists, templatesRoot, writeFile, writeFileIfMissing } from '../../../../utils/filesystem.js';
import { logger } from '../../../../utils/logger.js';
import { STAGING_DIR_NAME, promoteStagingClient } from '../../client-setup.js';
import { installReactCommonPackages, overlayReactCommon, writeReactProviders, finalizeReactLanguage } from '../react-common.generator.js';

/**
 * @param {object} options
 */
export async function generateNextFrontend(options) {
  const packageManagerFlag = getCreateNextAppPackageManagerFlag(options.packageManager);
  const frontend = options.frontend ?? {};
  const isTs = frontend.language !== 'javascript';
  const isTailwind = frontend.styling !== 'bootstrap';
  const frontendDir = options.frontendDirectory ?? (options.paths?.frontend
    ? (options.paths.frontend === '.' ? options.targetDirectory : path.join(options.targetDirectory, options.paths.frontend))
    : options.targetDirectory);

  const createNextAppArgs = [
    '--yes',
    'create-next-app@latest',
    STAGING_DIR_NAME,
    isTs ? '--ts' : '--js',
    isTailwind ? '--tailwind' : '--no-tailwind',
    '--eslint',
    '--app',
    '--src-dir',
    '--import-alias',
    '@/*',
    '--empty',
    '--yes',
    '--disable-git',
    packageManagerFlag,
  ];

  runCommand('npx', createNextAppArgs, {
    cwd: options.targetDirectory,
    step: 'Create Next.js client',
    env: {
      ...process.env,
      CI: '1',
      npm_config_user_agent: packageManagerUserAgent(options.packageManager),
    },
  });

  const clientDir = await promoteStagingClient(options.targetDirectory, frontendDir, options.folderName);
  logger.success('Frontend created');

  installReactCommonPackages({ clientDir, packageManager: options.packageManager, frontend });

  if (frontend.localization ?? options.localization) {
    add(options.packageManager, ['next-intl'], {
      cwd: clientDir,
      step: 'Install next-intl',
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
    path.join(templatesRoot(), 'frontend', 'react', 'next'),
    clientDir,
    options.replacements,
  );

  await writeReactProviders(clientDir, frontend);

  if (isTailwind) {
    await writeFileIfMissing(path.join(clientDir, 'src', 'app', 'globals.css'), '@import "tailwindcss";\n');
  } else {
    // Bootstrap styling import
    await writeFile(
      path.join(clientDir, 'src', 'app', 'globals.css'),
      '@import "bootstrap/dist/css/bootstrap.min.css";\n\nbody { margin: 0; padding: 0; }\n',
    );
  }

  const defaultPageTs = path.join(clientDir, 'src', 'app', 'page.tsx');
  const defaultPageJs = path.join(clientDir, 'src', 'app', 'page.jsx');
  if (await pathExists(defaultPageTs)) {
    await fs.unlink(defaultPageTs);
  }
  if (await pathExists(defaultPageJs)) {
    await fs.unlink(defaultPageJs);
  }

  if (frontend.localization ?? options.localization) {
    await writeNextIntlConfig(clientDir, frontend);
  } else {
    await fs.rm(path.join(clientDir, 'src', 'i18n'), { recursive: true, force: true });
    await writePlainLayout(clientDir, options.replacements);
    await writePlainHomePage(clientDir, options.replacements);
  }

  await finalizeReactLanguage(clientDir, frontend);
}

async function writeNextIntlConfig(clientDir, frontend = {}) {
  const isJs = frontend.language === 'javascript';
  const configPathTs = path.join(clientDir, 'next.config.ts');
  const configPathMjs = path.join(clientDir, 'next.config.mjs');
  const configPathJs = path.join(clientDir, 'next.config.js');
  const pluginPath = isJs ? './src/i18n/request.js' : './src/i18n/request.ts';
  const dest = isJs ? configPathMjs : configPathTs;

  await writeFile(
    dest,
    isJs
      ? `import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("${pluginPath}");

const nextConfig = {};

export default withNextIntl(nextConfig);
`
      : `import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("${pluginPath}");

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
`,
  );

  if (!isJs) {
    if (await pathExists(configPathMjs)) {
      await fs.unlink(configPathMjs);
    }
    if (await pathExists(configPathJs)) {
      await fs.unlink(configPathJs);
    }
  } else {
    if (await pathExists(configPathTs)) {
      await fs.unlink(configPathTs);
    }
    if (await pathExists(configPathJs)) {
      await fs.unlink(configPathJs);
    }
  }
}

async function writePlainLayout(clientDir, replacements) {
  await writeFile(
    path.join(clientDir, 'src', 'app', 'layout.tsx'),
    `import type { Metadata } from "next";
import "@/styles/app-shell.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "${replacements.__DISPLAY_NAME__}",
  description: "${replacements.__DISPLAY_NAME__} web application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
`,
  );
}

async function writePlainHomePage(clientDir, replacements) {
  await writeFile(
    path.join(clientDir, 'src', 'app', '(website)', 'page.tsx'),
    `import { HomeLanding } from "@/shared/components/marketing/HomeLanding";
import { AppLink } from "@/app/navigation/app-link";

export default function HomePage() {
  return <HomeLanding productName="${replacements.__DISPLAY_NAME__}" Link={AppLink} />;
}
`,
  );
}
