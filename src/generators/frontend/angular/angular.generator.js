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

  const isTailwind = options.frontend?.styling !== 'bootstrap';
  const isNgRx = options.frontend?.state !== 'none';

  if (isNgRx) {
    add(options.packageManager, ['@ngrx/store@20', '@ngrx/effects@20', '@ngrx/store-devtools@20'], {
      cwd: clientDir,
      step: 'Install NgRx',
    });
  }

  if (isTailwind) {
    addDev(options.packageManager, ['tailwindcss', '@tailwindcss/postcss', 'postcss'], {
      cwd: clientDir,
      step: 'Install Tailwind for Angular',
    });
  } else {
    add(options.packageManager, ['bootstrap'], {
      cwd: clientDir,
      step: 'Install Bootstrap for Angular',
    });
  }

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
  if (isTailwind) {
    if (await pathExists(postcssConfig) && !(await pathExists(postcssRc))) {
      await fs.copyFile(postcssConfig, postcssRc);
    }
  } else {
    if (await pathExists(postcssRc)) await fs.unlink(postcssRc);
    if (await pathExists(postcssConfig)) await fs.unlink(postcssConfig);
  }

  await writeAngularAppConfig(clientDir, isNgRx);
  await ensureAngularStyles(clientDir, isTailwind);
  await removeAngularCliBoilerplate(clientDir);

  if (!isNgRx) {
    await fs.rm(path.join(clientDir, 'src', 'app', 'features', 'category', 'store'), { recursive: true, force: true });
    await writeAngularNoneStateCategoryPages(clientDir);
  }

  logger.success('Angular starter architecture generated');
}

async function writeAngularAppConfig(clientDir, isNgRx = true) {
  const packageJsonPath = path.join(clientDir, 'package.json');
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const hasZone = Boolean(pkg.dependencies?.['zone.js'] || pkg.devDependencies?.['zone.js']);
  const changeDetectionImport = hasZone
    ? 'provideZoneChangeDetection'
    : 'provideZonelessChangeDetection';
  const changeDetectionProvider = hasZone
    ? 'provideZoneChangeDetection({ eventCoalescing: true })'
    : 'provideZonelessChangeDetection()';

  if (isNgRx) {
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
  } else {
    await writeFile(
      path.join(clientDir, 'src', 'app', 'app.config.ts'),
      `import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { ApplicationConfig, ${changeDetectionImport} } from "@angular/core";
import { provideRouter } from "@angular/router";
import { routes } from "./app.routes";
import { apiInterceptor } from "./core/interceptors/api.interceptor";

export const appConfig: ApplicationConfig = {
  providers: [
    ${changeDetectionProvider},
    provideRouter(routes),
    provideHttpClient(withInterceptors([apiInterceptor])),
  ],
};
`,
    );
  }
}

async function writeAngularNoneStateCategoryPages(clientDir) {
  const catPagesDir = path.join(clientDir, 'src', 'app', 'features', 'category', 'pages');

  await writeFile(
    path.join(catPagesDir, 'categories.page.ts'),
    `import { Component, inject, OnInit, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { CategoryService } from "../services/category.service";
import type { Category } from "../models/category.model";
import { CategoryCardComponent } from "../components/category-card.component";
import { PageHeaderComponent } from "../../../shared/components/page-header.component";
import { EmptyStateComponent } from "../../../shared/components/empty-state.component";
import { ErrorStateComponent } from "../../../shared/components/error-state.component";

@Component({
  selector: "app-categories-page",
  standalone: true,
  imports: [
    RouterLink,
    CategoryCardComponent,
    PageHeaderComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  template: \`
    <div class="ui-page">
      <app-page-header
        title="Categories"
        description="Group products into named categories. Load the API, then create, inspect, or edit a category."
      >
        <button type="button" class="ui-btn ui-btn-ghost" (click)="load()">Load categories</button>
        <a routerLink="/dashboard/category/create" class="ui-btn ui-btn-primary">Create category</a>
      </app-page-header>

      @if (error(); as message) {
        <app-error-state [description]="message" />
      }

      @if (items().length === 0) {
        <app-empty-state
          title="No categories yet"
          description="Create a category to organize products. The API is /api/v1/categories."
        />
      } @else {
        <ul class="ui-list">
          @for (item of items(); track item.id) {
            <li>
              <app-category-card [category]="item">
                <div style="display:flex;gap:0.6rem;margin-top:0.85rem">
                  <a [routerLink]="['/dashboard/category', item.id]" class="ui-btn ui-btn-ghost">Details</a>
                  <a [routerLink]="['/dashboard/category', item.id, 'edit']" class="ui-btn ui-btn-ghost">Edit</a>
                </div>
              </app-category-card>
            </li>
          }
        </ul>
      }
    </div>
  \`,
})
export class CategoriesPageComponent implements OnInit {
  private readonly categoryService = inject(CategoryService);

  readonly items = signal<Category[]>([]);
  readonly error = signal<string | null>(null);

  ngOnInit() {
    this.load();
  }

  load() {
    this.categoryService.search({ page: 1, pageSize: 10 }).subscribe({
      next: (result) => this.items.set(result.data ?? []),
      error: (err) => this.error.set(err instanceof Error ? err.message : "Unable to load categories"),
    });
  }
}
`,
  );

  await writeFile(
    path.join(catPagesDir, 'create-category.page.ts'),
    `import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { CategoryService } from "../services/category.service";
import { PageHeaderComponent } from "../../../shared/components/page-header.component";
import { ErrorStateComponent } from "../../../shared/components/error-state.component";

@Component({
  selector: "app-create-category-page",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PageHeaderComponent, ErrorStateComponent],
  template: \`
    <div class="ui-page">
      <app-page-header
        title="Create category"
        description="Add a category name and optional description."
      >
        <a routerLink="/dashboard/category" class="ui-btn ui-btn-ghost">Back to list</a>
      </app-page-header>

      @if (error(); as message) {
        <app-error-state [description]="message" />
      }

      <form class="ui-card" style="margin: 1.2rem 0" [formGroup]="form" (ngSubmit)="create()">
        <label class="ui-field">
          Name
          <input class="ui-input" formControlName="name" />
        </label>
        <label class="ui-field">
          Description
          <textarea class="ui-input" rows="3" formControlName="description"></textarea>
        </label>
        <button type="submit" class="ui-btn ui-btn-primary">Save category</button>
      </form>
    </div>
  \`,
})
export class CreateCategoryPageComponent {
  private readonly categoryService = inject(CategoryService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  readonly error = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    name: ["", [Validators.required, Validators.maxLength(200)]],
    description: ["", [Validators.maxLength(2000)]],
  });

  create() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.categoryService.create(this.form.getRawValue()).subscribe({
      next: () => void this.router.navigate(["/dashboard/category"]),
      error: (err) => this.error.set(err instanceof Error ? err.message : "Unable to create category"),
    });
  }
}
`,
  );

  await writeFile(
    path.join(catPagesDir, 'category-details.page.ts'),
    `import { Component, inject, OnInit, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { CategoryService } from "../services/category.service";
import type { Category } from "../models/category.model";
import { PageHeaderComponent } from "../../../shared/components/page-header.component";
import { EmptyStateComponent } from "../../../shared/components/empty-state.component";
import { ErrorStateComponent } from "../../../shared/components/error-state.component";

@Component({
  selector: "app-category-details-page",
  standalone: true,
  imports: [RouterLink, PageHeaderComponent, EmptyStateComponent, ErrorStateComponent],
  template: \`
    <div class="ui-page">
      <app-page-header
        [title]="selected()?.name ?? 'Category details'"
        description="Inspect a single category returned by GET /api/v1/categories/{id}."
      >
        <a routerLink="/dashboard/category" class="ui-btn ui-btn-ghost">Back to list</a>
        @if (id) {
          <a [routerLink]="['/dashboard/category', id, 'edit']" class="ui-btn ui-btn-primary">Edit category</a>
        }
      </app-page-header>

      @if (error(); as message) {
        <app-error-state [description]="message" />
      }

      @if (!selected()) {
        <app-empty-state
          title="Category not loaded"
          description="Load the list and open a category, or check the id in the URL."
        />
      } @else {
        <article class="ui-card">
          <p class="ui-note">Name</p>
          <p>{{ selected()!.name }}</p>
          <p class="ui-note" style="margin-top: 0.9rem">Description</p>
          <p>{{ selected()!.description || "—" }}</p>
          <p class="ui-note" style="margin-top: 0.9rem">Created</p>
          <p>{{ selected()!.createdAtUtc || "—" }}</p>
        </article>
      }
    </div>
  \`,
})
export class CategoryDetailsPageComponent implements OnInit {
  private readonly categoryService = inject(CategoryService);
  private readonly route = inject(ActivatedRoute);

  readonly id = this.route.snapshot.paramMap.get("id") ?? "";
  readonly selected = signal<Category | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit() {
    if (this.id) {
      this.categoryService.getById(this.id).subscribe({
        next: (cat) => this.selected.set(cat),
        error: (err) => this.error.set(err instanceof Error ? err.message : "Unable to load category"),
      });
    }
  }
}
`,
  );

  await writeFile(
    path.join(catPagesDir, 'edit-category.page.ts'),
    `import { Component, inject, OnInit, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { CategoryService } from "../services/category.service";
import type { Category } from "../models/category.model";
import { PageHeaderComponent } from "../../../shared/components/page-header.component";
import { EmptyStateComponent } from "../../../shared/components/empty-state.component";
import { ErrorStateComponent } from "../../../shared/components/error-state.component";

@Component({
  selector: "app-edit-category-page",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PageHeaderComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  template: \`
    <div class="ui-page">
      <app-page-header
        title="Edit category"
        description="Update the category name or description."
      >
        <a routerLink="/dashboard/category" class="ui-btn ui-btn-ghost">Back to list</a>
      </app-page-header>

      @if (error(); as message) {
        <app-error-state [description]="message" />
      }

      @if (!selected()) {
        <app-empty-state
          title="Category not loaded"
          description="Open a category from the list to edit it."
        />
      } @else {
        <form class="ui-card" style="margin: 1.2rem 0" [formGroup]="form" (ngSubmit)="save()">
          <label class="ui-field">
            Name
            <input class="ui-input" formControlName="name" />
          </label>
          <label class="ui-field">
            Description
            <textarea class="ui-input" rows="3" formControlName="description"></textarea>
          </label>
          <button type="submit" class="ui-btn ui-btn-primary">Save changes</button>
        </form>
      }
    </div>
  \`,
})
export class EditCategoryPageComponent implements OnInit {
  private readonly categoryService = inject(CategoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  readonly id = this.route.snapshot.paramMap.get("id") ?? "";
  readonly selected = signal<Category | null>(null);
  readonly error = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    name: ["", [Validators.required, Validators.maxLength(200)]],
    description: ["", [Validators.maxLength(2000)]],
  });

  ngOnInit() {
    if (this.id) {
      this.categoryService.getById(this.id).subscribe({
        next: (category) => {
          this.selected.set(category);
          this.form.reset({
            name: category.name,
            description: category.description,
          });
        },
        error: (err) => this.error.set(err instanceof Error ? err.message : "Unable to load category"),
      });
    }
  }

  save() {
    if (this.form.invalid || !this.id) {
      this.form.markAllAsTouched();
      return;
    }

    this.categoryService.update({ id: this.id, ...this.form.getRawValue() }).subscribe({
      next: () => void this.router.navigate(["/dashboard/category"]),
      error: (err) => this.error.set(err instanceof Error ? err.message : "Unable to update category"),
    });
  }
}
`,
  );
}

async function ensureAngularStyles(clientDir, isTailwind = true) {
  const cssPath = path.join(clientDir, 'src', 'styles.css');
  const importStatement = isTailwind
    ? '@import "tailwindcss";\n@import "./styles/app-shell.css";\n'
    : '@import "bootstrap/dist/css/bootstrap.min.css";\n@import "./styles/app-shell.css";\n';
  await writeFile(cssPath, importStatement);

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
