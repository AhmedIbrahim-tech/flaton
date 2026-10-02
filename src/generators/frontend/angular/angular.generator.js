import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runCommand } from '../../../utils/command.js';
import { add, addDev } from '../../../utils/package-manager.js';
import { copyTemplate, pathExists, templatesRoot, writeFile } from '../../../utils/filesystem.js';
import { logger } from '../../../utils/logger.js';
import { STAGING_DIR_NAME, promoteStagingClient } from '../client-setup.js';

/**
 * @param {object} options
 */
export async function generateAngularFrontend(options) {
  const frontendDir = options.frontendDirectory ?? (options.paths?.frontend
    ? (options.paths.frontend === '.' ? options.targetDirectory : path.join(options.targetDirectory, options.paths.frontend))
    : options.targetDirectory);

  runCommand(
    'npx',
    [
      '--yes',
      '-p',
      '@angular/cli@20',
      'ng',
      'new',
      STAGING_DIR_NAME,
      '--routing',
      '--style',
      'css',
      '--ssr=false',
      '--skip-git',
      '--skip-tests',
      '--strict',
      '--defaults',
      '--package-manager',
      options.packageManager,
    ],
    {
      cwd: options.targetDirectory,
      step: 'Create Angular client',
      env: {
        ...process.env,
        CI: '1',
        NG_CLI_ANALYTICS: 'false',
      },
    },
  );

  const clientDir = await promoteStagingClient(options.targetDirectory, frontendDir, options.folderName);
  logger.success('Frontend created');

  add(options.packageManager, ['@ngrx/store@20', '@ngrx/effects@20', '@ngrx/store-devtools@20'], {
    cwd: clientDir,
    step: 'Install NgRx',
  });
  addDev(options.packageManager, ['tailwindcss', '@tailwindcss/postcss', 'postcss'], {
    cwd: clientDir,
    step: 'Install Tailwind for Angular',
  });

  if (options.frontend?.realtime === 'signalr' || options.realtime === 'signalr') {
    add(options.packageManager, ['@microsoft/signalr'], {
      cwd: clientDir,
      step: 'Install SignalR client for Angular',
    });
    await writeAngularSignalRService(clientDir);
  }

  logger.success('Frontend dependencies installed');

  await copyTemplate(
    path.join(templatesRoot(), 'frontend', 'angular'),
    clientDir,
    options.replacements,
  );

  const postcssRc = path.join(clientDir, '.postcssrc.json');
  const postcssConfig = path.join(clientDir, 'postcss.config.json');
  if (await pathExists(postcssConfig) && !(await pathExists(postcssRc))) {
    await fs.copyFile(postcssConfig, postcssRc);
  }

  await writeAngularAppConfig(clientDir);
  await ensureAngularStyles(clientDir);
  await removeAngularCliBoilerplate(clientDir);

  logger.success('Angular starter architecture generated');
}

async function writeAngularAppConfig(clientDir) {
  const packageJsonPath = path.join(clientDir, 'package.json');
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const hasZone = Boolean(pkg.dependencies?.['zone.js'] || pkg.devDependencies?.['zone.js']);
  const changeDetectionImport = hasZone
    ? 'provideZoneChangeDetection'
    : 'provideZonelessChangeDetection';
  const changeDetectionProvider = hasZone
    ? 'provideZoneChangeDetection({ eventCoalescing: true })'
    : 'provideZonelessChangeDetection()';

  await writeFile(
    path.join(clientDir, 'src', 'app', 'app.config.ts'),
    `import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { ApplicationConfig, ${changeDetectionImport} } from "@angular/core";
import { provideRouter } from "@angular/router";
import { provideEffects } from "@ngrx/effects";
import { provideStore } from "@ngrx/store";
import { provideStoreDevtools } from "@ngrx/store-devtools";
import { routes } from "./app.routes";
import { apiInterceptor } from "./core/interceptors/api.interceptor";
import { CategoryEffects } from "./features/category/store/category.effects";
import { categoryReducer } from "./features/category/store/category.reducer";

export const appConfig: ApplicationConfig = {
  providers: [
    ${changeDetectionProvider},
    provideRouter(routes),
    provideHttpClient(withInterceptors([apiInterceptor])),
    provideStore({ category: categoryReducer }),
    provideEffects([CategoryEffects]),
    provideStoreDevtools({ maxAge: 25 }),
  ],
};
`,
  );
}

async function ensureAngularStyles(clientDir) {
  const angularJsonPath = path.join(clientDir, 'angular.json');
  if (!(await pathExists(angularJsonPath))) {
    return;
  }

  const angularJson = JSON.parse(await fs.readFile(angularJsonPath, 'utf8'));
  const projectName = Object.keys(angularJson.projects ?? {})[0];
  if (!projectName) {
    return;
  }

  const buildOptions = angularJson.projects[projectName]?.architect?.build?.options;
  if (!buildOptions) {
    return;
  }

  const styles = Array.isArray(buildOptions.styles) ? buildOptions.styles : [];
  if (!styles.includes('src/styles.css')) {
    buildOptions.styles = ['src/styles.css', ...styles];
    await fs.writeFile(angularJsonPath, `${JSON.stringify(angularJson, null, 2)}\n`, 'utf8');
  }
}

async function removeAngularCliBoilerplate(clientDir) {
  const appDir = path.join(clientDir, 'src', 'app');
  const leftovers = [
    'app.ts',
    'app.html',
    'app.css',
    'app.spec.ts',
    'app.component.spec.ts',
    'ng-welcome-component.ts',
  ];
  for (const name of leftovers) {
    const fullPath = path.join(appDir, name);
    if (await pathExists(fullPath)) {
      await fs.unlink(fullPath);
    }
  }
}

async function writeAngularSignalRService(clientDir) {
  const content = `import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class SignalRService {
  private hubConnection: signalR.HubConnection | null = null;
  private isConnectedSubject = new BehaviorSubject<boolean>(false);
  public isConnected$: Observable<boolean> = this.isConnectedSubject.asObservable();

  public startConnection(hubUrl: string = '/hubs/app'): void {
    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => localStorage.getItem('access_token') ?? '',
      })
      .withAutomaticReconnect()
      .build();

    this.hubConnection
      .start()
      .then(() => {
        this.isConnectedSubject.next(true);
      })
      .catch((err) => {
        console.warn('SignalR connection error:', err);
      });
  }

  public stopConnection(): void {
    if (this.hubConnection) {
      this.hubConnection.stop();
      this.isConnectedSubject.next(false);
    }
  }
}
`;
  await writeFile(
    path.join(clientDir, 'src', 'app', 'core', 'services', 'signalr.service.ts'),
    content,
  );
}
