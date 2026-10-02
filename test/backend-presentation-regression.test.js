import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import {
  BACKEND_PRESENTATIONS,
  assertBackendCompatibility,
  defaultBackendSelection,
  describeBackend,
} from '../src/models/backend.js';
import { parseArguments, DEFAULT_OPTIONS } from '../src/cli/arguments.js';
import { writeGenerationManifest } from '../src/generators/manifest.generator.js';
import { buildFeatureConfig } from '../src/feature-generator/feature.config.js';
import { planBackendFeature } from '../src/feature-generator/backend/backend-feature.generator.js';
import {
  planAuthBackend,
  authBackendConflictPaths,
} from '../src/module-generator/auth/auth-backend.generator.js';
import { setModuleManifestContext } from '../src/module-generator/modules-orchestrator-helpers.js';

function makeProductConfig(presentation, architecture) {
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  return buildFeatureConfig({
    singularName: 'Product',
    fields: [
      { name: 'Name', type: 'string' },
      { name: 'Price', type: 'decimal' },
    ],
    manifest: {
      backend: {
        enabled: true,
        presentation,
        architecture,
        orm: 'efcore',
      },
      frontend: { enabled: false },
      paths: { backend: 'Backend' },
    },
    projectRoot: '/test',
    projectName: 'TestApp',
  });
}

test('CLI arguments: supports --presentation and --backend-type flags with default controllers', () => {
  assert.equal(DEFAULT_OPTIONS.presentation, 'controllers');

  const parsed1 = parseArguments(['node', 'cli', 'TestApp', '--presentation', 'minimal-api']);
  assert.equal(parsed1.presentation, 'minimal-api');

  const parsed2 = parseArguments(['node', 'cli', 'TestApp', '--backend-type', 'mvc']);
  assert.equal(parsed2.presentation, 'mvc');

  const parsed3 = parseArguments(['node', 'cli', 'TestApp', '--presentation', 'razor-pages']);
  assert.equal(parsed3.presentation, 'razor-pages');
});

test('Backend presentation model: definitions and defaults', () => {
  assert.ok(BACKEND_PRESENTATIONS.includes('controllers'));
  assert.ok(BACKEND_PRESENTATIONS.includes('minimal-api'));
  assert.ok(BACKEND_PRESENTATIONS.includes('mvc'));
  assert.ok(BACKEND_PRESENTATIONS.includes('razor-pages'));

  const def = defaultBackendSelection();
  assert.equal(def.presentation, 'controllers');
});

test('Backward compatibility: manifest without backend.presentation defaults to controllers', () => {
  const config = buildFeatureConfig({
    singularName: 'Product',
    fields: [{ name: 'Name', type: 'string' }],
    manifest: {
      backend: {
        enabled: true,
        architecture: 'cqrs-mediatr',
      },
      paths: { backend: 'Backend' },
    },
    projectRoot: '/test',
    projectName: 'LegacyApp',
  });

  assert.equal(config.presentation, 'controllers');
  assert.equal(config.backend.presentation, 'controllers');

  const files = planBackendFeature(config);
  assert.ok(files.some((f) => f.relativePath.includes('API/Controllers/ProductsController.cs') || f.relativePath.includes('API\\Controllers\\ProductsController.cs')));
});

test('Manifest generator: writes backend.presentation for Full Stack and Backend Only', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-pres-'));

  // Full Stack
  await writeGenerationManifest({
    targetDirectory: tempDir,
    pascalName: 'FullApp',
    backend: { enabled: true, architecture: 'cqrs-mediatr' },
    frontend: { enabled: true, library: 'react', framework: 'next' },
    presentation: 'controllers',
    modules: {},
  });
  let manifest = JSON.parse(fs.readFileSync(path.join(tempDir, '.fullstack-app.json'), 'utf8'));
  assert.equal(manifest.backend.presentation, 'controllers');

  // Backend Only with minimal-api
  await writeGenerationManifest({
    targetDirectory: tempDir,
    pascalName: 'ApiApp',
    backend: { enabled: true, architecture: 'services', presentation: 'minimal-api' },
    frontend: { enabled: false },
    presentation: 'minimal-api',
    modules: {},
  });
  manifest = JSON.parse(fs.readFileSync(path.join(tempDir, '.fullstack-app.json'), 'utf8'));
  assert.equal(manifest.backend.presentation, 'minimal-api');

  // Backend Only with mvc
  await writeGenerationManifest({
    targetDirectory: tempDir,
    pascalName: 'MvcApp',
    backend: { enabled: true, architecture: 'cqrs-mediatr', presentation: 'mvc' },
    frontend: { enabled: false },
    presentation: 'mvc',
    modules: {},
  });
  manifest = JSON.parse(fs.readFileSync(path.join(tempDir, '.fullstack-app.json'), 'utf8'));
  assert.equal(manifest.backend.presentation, 'mvc');

  // Backend Only with razor-pages
  await writeGenerationManifest({
    targetDirectory: tempDir,
    pascalName: 'RazorApp',
    backend: { enabled: true, architecture: 'services', presentation: 'razor-pages' },
    frontend: { enabled: false },
    presentation: 'razor-pages',
    modules: {},
  });
  manifest = JSON.parse(fs.readFileSync(path.join(tempDir, '.fullstack-app.json'), 'utf8'));
  assert.equal(manifest.backend.presentation, 'razor-pages');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Controllers: plans API/Controllers, centralized Router.cs, and no Minimal API or Web files', () => {
  const config = makeProductConfig('controllers', 'cqrs-mediatr');
  const files = planBackendFeature(config);

  const paths = files.map((f) => f.relativePath.replace(/\\/g, '/'));
  assert.ok(paths.some((p) => p.endsWith('API/Controllers/ProductsController.cs')));
  assert.ok(!paths.some((p) => p.includes('API/Endpoints')));
  assert.ok(!paths.some((p) => p.startsWith('Backend/Web')));

  const controllerFile = files.find((f) => f.relativePath.replace(/\\/g, '/').endsWith('API/Controllers/ProductsController.cs'));
  assert.match(controllerFile.contents, /\[ApiController\]/);
  assert.match(controllerFile.contents, /ApiControllerBase/);
  assert.match(controllerFile.contents, /Router\.Products\./);
});

test('Minimal API: plans API/Endpoints, no Controllers, and clean endpoint extensions', () => {
  const configCqrs = makeProductConfig('minimal-api', 'cqrs-mediatr');
  const filesCqrs = planBackendFeature(configCqrs);
  const pathsCqrs = filesCqrs.map((f) => f.relativePath.replace(/\\/g, '/'));

  assert.ok(pathsCqrs.some((p) => p.endsWith('API/Endpoints/Products/CreateProductEndpoint.cs')));
  assert.ok(pathsCqrs.some((p) => p.endsWith('API/Endpoints/Products/UpdateProductEndpoint.cs')));
  assert.ok(pathsCqrs.some((p) => p.endsWith('API/Endpoints/Products/DeleteProductEndpoint.cs')));
  assert.ok(pathsCqrs.some((p) => p.endsWith('API/Endpoints/Products/GetProductByIdEndpoint.cs')));
  assert.ok(pathsCqrs.some((p) => p.endsWith('API/Endpoints/Products/GetProductsEndpoint.cs')));
  assert.ok(pathsCqrs.some((p) => p.endsWith('API/Endpoints/Products/ProductEndpoints.cs')));
  assert.ok(!pathsCqrs.some((p) => p.includes('API/Controllers')));
  assert.ok(!pathsCqrs.some((p) => p.startsWith('Backend/Web')));

  for (const file of filesCqrs.filter((f) => f.relativePath.includes('Endpoints'))) {
    assert.doesNotMatch(file.contents, /ControllerBase/);
    assert.doesNotMatch(file.contents, /\[ApiController\]/);
  }

  // Application Services Minimal API
  const configServices = makeProductConfig('minimal-api', 'services');
  const filesServices = planBackendFeature(configServices);
  const createEndpoint = filesServices.find((f) => f.relativePath.replace(/\\/g, '/').endsWith('CreateProductEndpoint.cs'));
  assert.match(createEndpoint.contents, /IProductService service/);
  assert.doesNotMatch(createEndpoint.contents, /ISender/);
});

test('MVC: plans Web/Controllers, Web/Views, Web/ViewModels, and no API folder', () => {
  const config = makeProductConfig('mvc', 'services');
  const files = planBackendFeature(config);
  const paths = files.map((f) => f.relativePath.replace(/\\/g, '/'));

  assert.ok(paths.some((p) => p.endsWith('Web/Controllers/ProductsController.cs')));
  assert.ok(paths.some((p) => p.endsWith('Web/Views/Products/Index.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/Views/Products/Create.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/Views/Products/Edit.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/Views/Products/Details.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/Views/Products/Delete.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/ViewModels/Products/ProductViewModel.cs')));
  assert.ok(!paths.some((p) => p.includes('API/')));

  const controller = files.find((f) => f.relativePath.replace(/\\/g, '/').endsWith('ProductsController.cs'));
  assert.match(controller.contents, /public class ProductsController : Controller/);
  assert.match(controller.contents, /return View\(/);
});

test('Razor Pages: plans Web/Pages, PageModels, and no MVC Controllers for CRUD', () => {
  const config = makeProductConfig('razor-pages', 'cqrs-mediatr');
  const files = planBackendFeature(config);
  const paths = files.map((f) => f.relativePath.replace(/\\/g, '/'));

  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Index.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Index.cshtml.cs')));
  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Create.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Create.cshtml.cs')));
  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Edit.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Edit.cshtml.cs')));
  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Details.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Details.cshtml.cs')));
  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Delete.cshtml')));
  assert.ok(paths.some((p) => p.endsWith('Web/Pages/Products/Delete.cshtml.cs')));
  assert.ok(!paths.some((p) => p.includes('Web/Controllers')));
  assert.ok(!paths.some((p) => p.includes('API/')));

  const pageModel = files.find((f) => f.relativePath.replace(/\\/g, '/').endsWith('Create.cshtml.cs'));
  assert.match(pageModel.contents, /public class CreateModel : PageModel/);
  assert.match(pageModel.contents, /ISender _sender/);
});

test('Application Architecture independence across all 4 presentations', () => {
  const presentations = ['controllers', 'minimal-api', 'mvc', 'razor-pages'];

  for (const pres of presentations) {
    // CQRS
    const cqrsConfig = makeProductConfig(pres, 'cqrs-mediatr');
    const cqrsFiles = planBackendFeature(cqrsConfig);
    const cqrsPaths = cqrsFiles.map((f) => f.relativePath.replace(/\\/g, '/'));
    assert.ok(
      cqrsPaths.some((p) => p.includes('Application/Features/Product/')),
      `Expected Application/Features in ${pres} CQRS`,
    );
    assert.ok(
      !cqrsPaths.some((p) => p.includes('Application/Modules/')),
      `Did not expect Application/Modules in ${pres} CQRS`,
    );

    // Services
    const srvConfig = makeProductConfig(pres, 'services');
    const srvFiles = planBackendFeature(srvConfig);
    const srvPaths = srvFiles.map((f) => f.relativePath.replace(/\\/g, '/'));
    assert.ok(
      srvPaths.some((p) => p.includes('Application/Modules/Products/')),
      `Expected Application/Modules in ${pres} Services`,
    );
    assert.ok(
      !srvPaths.some((p) => p.includes('Application/Features/')),
      `Did not expect Application/Features in ${pres} Services`,
    );
    for (const f of srvFiles) {
      assert.doesNotMatch(f.contents, /MediatR|IRequest\b|IRequestHandler|ISender/);
    }
  }
});

test('Authentication compatibility: Dapper rejects Identity, MVC/Razor rejects JWT-only', () => {
  // Dapper only + Identity JWT
  assert.throws(
    () =>
      assertBackendCompatibility({
        orm: 'dapper',
        authentication: 'identity-jwt',
        presentation: 'controllers',
      }),
    /Identity requires EF Core/,
  );

  // Dapper only + Identity Cookies
  assert.throws(
    () =>
      assertBackendCompatibility({
        orm: 'dapper',
        authentication: 'identity-cookies',
        presentation: 'controllers',
      }),
    /Identity requires EF Core/,
  );

  // MVC + Identity JWT
  assert.throws(
    () =>
      assertBackendCompatibility({
        orm: 'efcore',
        authentication: 'identity-jwt',
        presentation: 'mvc',
      }),
    /MVC and Razor Pages support cookie authentication/,
  );

  // Razor Pages + Identity JWT
  assert.throws(
    () =>
      assertBackendCompatibility({
        orm: 'efcore',
        authentication: 'identity-jwt',
        presentation: 'razor-pages',
      }),
    /MVC and Razor Pages support cookie authentication/,
  );

  // Valid combinations
  assert.doesNotThrow(() =>
    assertBackendCompatibility({
      orm: 'efcore',
      authentication: 'identity-jwt',
      presentation: 'controllers',
    }),
  );
  assert.doesNotThrow(() =>
    assertBackendCompatibility({
      orm: 'efcore',
      authentication: 'identity-cookies',
      presentation: 'controllers',
    }),
  );
  assert.doesNotThrow(() =>
    assertBackendCompatibility({
      orm: 'efcore',
      authentication: 'identity-cookies',
      presentation: 'minimal-api',
    }),
  );
  assert.doesNotThrow(() =>
    assertBackendCompatibility({
      orm: 'efcore',
      authentication: 'identity-cookies',
      presentation: 'mvc',
    }),
  );
  assert.doesNotThrow(() =>
    assertBackendCompatibility({
      orm: 'efcore',
      authentication: 'identity-cookies',
      presentation: 'razor-pages',
    }),
  );
});

test('Auth backend planning: Cookies mode emits no JWT services; Minimal API maps endpoints without AuthController', () => {
  setModuleManifestContext({
    paths: { backend: 'Backend' },
    backend: { presentation: 'controllers', architecture: 'cqrs-mediatr' },
  });

  // Cookies Auth on Controllers
  const cookieFiles = planAuthBackend({
    projectName: 'CookieApp',
    authMode: 'identity-cookies',
    presentation: 'controllers',
    architecture: 'cqrs-mediatr',
  });
  const cookiePaths = cookieFiles.map((f) => f.relativePath.replace(/\\/g, '/'));

  assert.ok(cookiePaths.some((p) => p.includes('ApplicationUser.cs')));
  assert.ok(cookiePaths.some((p) => p.includes('AuthController.cs')));
  assert.ok(!cookiePaths.some((p) => p.includes('JwtOptions.cs')));
  assert.ok(!cookiePaths.some((p) => p.includes('IJwtTokenService.cs')));
  assert.ok(!cookiePaths.some((p) => p.includes('RefreshTokenService.cs')));
  assert.ok(!cookiePaths.some((p) => p.includes('AuthTokens.cs')));

  // Minimal API Auth
  const minimalFiles = planAuthBackend({
    projectName: 'MinimalApp',
    authMode: 'identity-jwt',
    presentation: 'minimal-api',
    architecture: 'services',
  });
  const minimalPaths = minimalFiles.map((f) => f.relativePath.replace(/\\/g, '/'));

  assert.ok(minimalPaths.some((p) => p.includes('API/Endpoints/Authentication/AuthEndpoints.cs')));
  assert.ok(!minimalPaths.some((p) => p.includes('API/Controllers')));
  assert.ok(minimalPaths.some((p) => p.includes('Application/Modules/Authentication/Interfaces/IAuthService.cs')));

  // MVC Auth
  const mvcFiles = planAuthBackend({
    projectName: 'MvcApp',
    authMode: 'identity-cookies',
    presentation: 'mvc',
    architecture: 'services',
  });
  const mvcPaths = mvcFiles.map((f) => f.relativePath.replace(/\\/g, '/'));

  assert.ok(mvcPaths.some((p) => p.includes('Web/Controllers/AccountController.cs')));
  assert.ok(mvcPaths.some((p) => p.includes('Web/Views/Account/Login.cshtml')));
  assert.ok(!mvcPaths.some((p) => p.includes('API/')));

  // Razor Pages Auth
  const razorFiles = planAuthBackend({
    projectName: 'RazorApp',
    authMode: 'identity-cookies',
    presentation: 'razor-pages',
    architecture: 'cqrs-mediatr',
  });
  const razorPaths = razorFiles.map((f) => f.relativePath.replace(/\\/g, '/'));

  assert.ok(razorPaths.some((p) => p.includes('Web/Pages/Account/Login.cshtml')));
  assert.ok(razorPaths.some((p) => p.includes('Web/Pages/Account/Login.cshtml.cs')));
  assert.ok(!razorPaths.some((p) => p.includes('Web/Controllers')));
  assert.ok(!razorPaths.some((p) => p.includes('API/')));
});
