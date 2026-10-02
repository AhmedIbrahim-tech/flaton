import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runCommand } from '../utils/command.js';
import { copyTemplate, ensureDir, pathExists, removeFilesMatching, templatesRoot, upsertCsprojProperties, writeFile } from '../utils/filesystem.js';
import { assertDotnetAvailable, detectTargetFramework } from '../utils/dotnet.js';
import { logger } from '../utils/logger.js';
import { assertBackendCompatibility, shouldGenerateIdentityArtifacts } from '../models/backend.js';
import {
  renderApplicationServiceExtensions,
  renderApiServiceExtensions,
  renderWebServiceExtensions,
} from '../feature-generator/backend/clean-architecture.js';

/**
 * @param {object} options
 */
export async function generateBackend(options) {
  assertDotnetAvailable();
  const targetFramework = detectTargetFramework();
  const backend = typeof options.backend === 'object' ? options.backend : {};
  const backendDir = options.backendDirectory ?? (options.paths?.backend
    ? (options.paths.backend === '.' ? options.targetDirectory : path.join(options.targetDirectory, options.paths.backend))
    : options.targetDirectory);

  await ensureDir(backendDir);

  const architecture = backend.architecture ?? options.architecture ?? 'cqrs-mediatr';
  const presentation = backend.presentation ?? options.presentation ?? 'controllers';
  const mapping = backend.mapping ?? options.mapping ?? 'manual';
  const orm = backend.orm ?? options.orm ?? 'efcore';
  const database = backend.database ?? options.database ?? (options.sqlServer === false ? 'sqlite' : 'sqlserver');
  const logging = backend.logging ?? options.logging ?? 'serilog';
  const backgroundJobs = backend.backgroundJobs ?? options.backgroundJobs ?? 'none';
  const realtime = backend.realtime ?? options.realtime ?? 'none';
  const authMode = backend.authentication ?? options.authMode ?? (options.auth ? 'identity-jwt' : 'none');

  const isWebProject = presentation === 'mvc' || presentation === 'razor-pages';
  const presentationFolder = isWebProject ? 'Web' : 'API';
  let presentationTemplate = 'webapi';
  if (presentation === 'mvc') presentationTemplate = 'mvc';
  else if (presentation === 'razor-pages') presentationTemplate = 'webapp';

  const backendConfig = {
    architecture,
    presentation,
    mapping,
    orm,
    database,
    logging,
    backgroundJobs,
    realtime,
    authMode,
  };

  assertBackendCompatibility({ orm, authentication: authMode, presentation });

  const projects = [
    { folder: 'Domain', template: 'classlib', log: 'Domain created' },
    { folder: 'Application', template: 'classlib', log: 'Application created' },
    { folder: 'Infrastructure', template: 'classlib', log: 'Infrastructure created' },
    { folder: presentationFolder, template: presentationTemplate, log: `${presentationFolder} created` },
  ];

  for (const project of projects) {
    const args = [
      'new',
      project.template,
      '--name',
      project.folder,
      '--output',
      project.folder,
      '--framework',
      targetFramework,
      '--force',
    ];

    if (project.template === 'webapi') {
      if (presentation === 'controllers') {
        args.push('--use-controllers');
      }
      args.push('--no-openapi', '--auth', 'None');
    } else if (project.template === 'mvc' || project.template === 'webapp') {
      args.push('--auth', 'None');
    }

    args.push('--no-restore');

    runCommand('dotnet', args, {
      cwd: backendDir,
      step: `Create ${project.folder} project`,
    });

    await upsertCsprojProperties(path.join(backendDir, project.folder, `${project.folder}.csproj`), {
      RootNamespace: `${options.pascalName}.${project.folder}`,
      AssemblyName: `${options.pascalName}.${project.folder}`,
    });

    await removeFilesMatching(path.join(backendDir, project.folder), (filePath) => {
      const base = path.basename(filePath);
      return base === 'WeatherForecast.cs' || base === 'WeatherForecastController.cs' || base === 'Class1.cs';
    });

    logger.success(project.log);
  }

  addProjectReferences(backendDir, presentationFolder);
  addBackendPackages(backendDir, backendConfig, presentationFolder);
  await overlayBackendTemplates(options, backendConfig, backendDir);
}

/**
 * @param {string} cwd
 * @param {string} presentationFolder
 */
function addProjectReferences(cwd, presentationFolder) {
  runCommand(
    'dotnet',
    ['add', path.join('Application', 'Application.csproj'), 'reference', path.join('Domain', 'Domain.csproj')],
    { cwd, step: 'Reference Application → Domain' },
  );

  runCommand(
    'dotnet',
    [
      'add',
      path.join('Infrastructure', 'Infrastructure.csproj'),
      'reference',
      path.join('Application', 'Application.csproj'),
      path.join('Domain', 'Domain.csproj'),
    ],
    { cwd, step: 'Reference Infrastructure → Application, Domain' },
  );

  runCommand(
    'dotnet',
    [
      'add',
      path.join(presentationFolder, `${presentationFolder}.csproj`),
      'reference',
      path.join('Application', 'Application.csproj'),
      path.join('Infrastructure', 'Infrastructure.csproj'),
    ],
    { cwd, step: `Reference ${presentationFolder} → Application, Infrastructure` },
  );
}

/**
 * @param {string} cwd
 * @param {object} config
 */
function addBackendPackages(cwd, config, presentationFolder = 'API') {
  // 1. Application Layer Packages
  const applicationPackages = [
    'FluentValidation',
    'FluentValidation.DependencyInjectionExtensions',
    'Microsoft.Extensions.Logging.Abstractions',
    'Microsoft.Extensions.DependencyInjection.Abstractions',
  ];

  if (config.architecture === 'cqrs-mediatr') {
    applicationPackages.push('MediatR');
  }

  if (config.mapping === 'automapper') {
    applicationPackages.push('AutoMapper');
  }

  if (config.orm === 'efcore' || config.orm === 'efcore-dapper') {
    applicationPackages.push('Microsoft.EntityFrameworkCore');
  }

  if (shouldGenerateIdentityArtifacts(config.authMode)) {
    applicationPackages.push('Microsoft.AspNetCore.Authorization');
  }

  addPackages(cwd, path.join('Application', 'Application.csproj'), applicationPackages);

  // 2. Infrastructure Layer Packages
  const infrastructurePackages = [
    'Microsoft.Extensions.Configuration.Abstractions',
    'Microsoft.Extensions.DependencyInjection.Abstractions',
  ];

  if (config.orm === 'efcore' || config.orm === 'efcore-dapper') {
    infrastructurePackages.push('Microsoft.EntityFrameworkCore.Design');

    if (config.database === 'sqlserver') {
      infrastructurePackages.push('Microsoft.EntityFrameworkCore.SqlServer');
    } else if (config.database === 'postgresql') {
      infrastructurePackages.push('Npgsql.EntityFrameworkCore.PostgreSQL');
    } else if (config.database === 'sqlite') {
      infrastructurePackages.push('Microsoft.EntityFrameworkCore.Sqlite');
    }
  }

  if (config.orm === 'dapper' || config.orm === 'efcore-dapper') {
    infrastructurePackages.push('Dapper');

    if (config.database === 'sqlserver') {
      infrastructurePackages.push('Microsoft.Data.SqlClient');
    } else if (config.database === 'postgresql') {
      infrastructurePackages.push('Npgsql');
    } else if (config.database === 'sqlite') {
      infrastructurePackages.push('Microsoft.Data.Sqlite');
    }
  }

  if (shouldGenerateIdentityArtifacts(config.authMode) && config.orm !== 'dapper') {
    infrastructurePackages.push('Microsoft.AspNetCore.Identity.EntityFrameworkCore');
  }

  if (config.backgroundJobs === 'hangfire') {
    infrastructurePackages.push('Hangfire.Core', 'Hangfire.AspNetCore');
    if (config.database === 'sqlserver') {
      infrastructurePackages.push('Hangfire.SqlServer');
    } else if (config.database === 'postgresql') {
      infrastructurePackages.push('Hangfire.PostgreSql');
    } else {
      infrastructurePackages.push('Hangfire.MemoryStorage');
    }
  }

  addPackages(cwd, path.join('Infrastructure', 'Infrastructure.csproj'), infrastructurePackages);

  // 3. Presentation Layer Packages
  const presentationPackages = [];

  if (presentationFolder === 'API') {
    presentationPackages.push('Swashbuckle.AspNetCore');
    if (config.authMode === 'identity-jwt') {
      presentationPackages.push('Microsoft.AspNetCore.Authentication.JwtBearer', 'System.IdentityModel.Tokens.Jwt');
    }
  }

  if (config.logging === 'serilog') {
    presentationPackages.push('Serilog.AspNetCore');
  }

  if (config.backgroundJobs === 'hangfire') {
    presentationPackages.push('Hangfire.AspNetCore');
  }

  if (presentationPackages.length > 0) {
    addPackages(cwd, path.join(presentationFolder, `${presentationFolder}.csproj`), presentationPackages);
  }
}

/**
 * @param {string} cwd
 * @param {string} csproj
 * @param {string[]} packages
 */
function addPackages(cwd, csproj, packages) {
  for (const packageName of packages) {
    runCommand('dotnet', ['add', csproj, 'package', packageName, '--no-restore'], {
      cwd,
      step: `Add package ${packageName}`,
    });
  }
}

async function removeObsoleteArchitectureFiles(backendDir) {
  const obsolete = [
    path.join('API', 'Routing', 'Router.cs'),
    path.join('API', 'ExceptionHandling', 'GlobalExceptionHandler.cs'),
    path.join('API', 'Endpoints', 'ApiControllerBase.cs'),
    path.join('API', 'Controllers', 'WeatherForecastController.cs'),
    path.join('Application', 'DependencyInjection.cs'),
    path.join('Infrastructure', 'DependencyInjection.cs'),
    path.join('Infrastructure', 'DependencyInjection.Generated.g.cs'),
    path.join('Infrastructure', 'DependencyInjection.Modules.g.cs'),
    path.join('Domain', 'ValueObjects', 'ValueObject.cs'),
    path.join('Domain', 'DomainEvents', 'IDomainEvent.cs'),
    path.join('Domain', 'Specifications', 'ISpecification.cs'),
  ];

  for (const relative of obsolete) {
    const absolute = path.join(backendDir, relative);
    if (await pathExists(absolute)) {
      await fs.unlink(absolute);
    }
  }

  for (const relativeDir of [
    path.join('API', 'Endpoints'),
    path.join('API', 'Routing'),
    path.join('API', 'ExceptionHandling'),
    path.join('Domain', 'ValueObjects'),
    path.join('Domain', 'DomainEvents'),
    path.join('Domain', 'Specifications'),
  ]) {
    const absolute = path.join(backendDir, relativeDir);
    try {
      const entries = await fs.readdir(absolute);
      if (entries.length === 0) {
        await fs.rmdir(absolute);
      }
    } catch {
      // Folder absent or not empty.
    }
  }
}

/**
 * @param {object} options
 * @param {object} config
 * @param {string} backendDir
 */
async function overlayBackendTemplates(options, config, backendDir) {
  const pascalName = options.pascalName;
  const presentation = config.presentation ?? 'controllers';
  const isWebProject = presentation === 'mvc' || presentation === 'razor-pages';
  const presentationFolder = isWebProject ? 'Web' : 'API';

  // Connection strings based on database
  let connectionString = `Server=localhost;Database=${pascalName};Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True`;
  if (config.database === 'sqlserver') {
    connectionString = `Server=(localdb)\\\\mssqllocaldb;Database=${pascalName}Db;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True`;
  } else if (config.database === 'postgresql') {
    connectionString = `Host=localhost;Port=5432;Database=${pascalName}Db;Username=postgres;Password=postgres`;
  } else if (config.database === 'sqlite') {
    connectionString = `Data Source=${pascalName}.db`;
  }

  const replacements = {
    __PASCAL_NAME__: pascalName,
    ...options.replacements,
    __CONNECTION_STRING__: connectionString,
  };

  await copyTemplate(path.join(templatesRoot(), 'backend'), backendDir, replacements);

  if (isWebProject) {
    await fs.rm(path.join(backendDir, 'API'), { recursive: true, force: true });
    await ensureDir(path.join(backendDir, 'Web', 'DependencyInjection'));
    if (presentation === 'mvc') {
      await ensureDir(path.join(backendDir, 'Web', 'ViewModels'));
      await ensureDir(path.join(backendDir, 'Web', 'Controllers'));
      await ensureDir(path.join(backendDir, 'Web', 'Views'));
    } else {
      await ensureDir(path.join(backendDir, 'Web', 'Models'));
      await ensureDir(path.join(backendDir, 'Web', 'Pages'));
    }
  } else {
    if (presentation === 'minimal-api') {
      await fs.rm(path.join(backendDir, 'API', 'Controllers'), { recursive: true, force: true });
      await ensureDir(path.join(backendDir, 'API', 'Endpoints'));
      await writeFile(path.join(backendDir, 'API', 'Endpoints', '.gitkeep'), '\n');
    } else {
      await removeFilesMatching(path.join(backendDir, 'API', 'Endpoints'), () => true);
      await ensureDir(path.join(backendDir, 'API', 'Controllers'));
    }
    await ensureDir(path.join(backendDir, 'API', 'Filters'));
    await ensureDir(path.join(backendDir, 'API', 'Attributes'));
  }

  await removeObsoleteArchitectureFiles(backendDir);
  await ensureDir(path.join(backendDir, 'Domain', 'Entities'));

  if (config.architecture === 'services') {
    await fs.rm(path.join(backendDir, 'Application', 'Behaviors'), { recursive: true, force: true });
    await fs.rm(path.join(backendDir, 'Application', 'Features'), { recursive: true, force: true });
    await ensureDir(path.join(backendDir, 'Application', 'Modules'));
    await writeFile(path.join(backendDir, 'Application', 'Modules', '.gitkeep'), '\n');
  }

  if (config.orm === 'dapper') {
    await removeFilesMatching(path.join(backendDir, 'Infrastructure', 'Persistence'), (filePath) => {
      const base = path.basename(filePath);
      return base === 'ApplicationDbContext.cs' || base.startsWith('ApplicationDbContext.');
    });
    await removeFilesMatching(
      path.join(backendDir, 'Application', 'Abstractions', 'Persistence'),
      (filePath) => path.basename(filePath).startsWith('IApplicationDbContext'),
    );
  }

  if (!shouldGenerateIdentityArtifacts(config.authMode)) {
    await removeFilesMatching(path.join(backendDir, 'Infrastructure', 'Authentication'), () => true);
  }

  // Ensure FrameworkReference in Infrastructure.csproj if identity is enabled
  if (shouldGenerateIdentityArtifacts(config.authMode) && config.orm !== 'dapper') {
    const infraCsprojPath = path.join(backendDir, 'Infrastructure', 'Infrastructure.csproj');
    if (await pathExists(infraCsprojPath)) {
      let contents = await fs.readFile(infraCsprojPath, 'utf8');
      if (!contents.includes('Microsoft.AspNetCore.App')) {
        contents = contents.replace(
          /<\/Project>/,
          `  <ItemGroup>\n    <FrameworkReference Include="Microsoft.AspNetCore.App" />\n  </ItemGroup>\n</Project>`,
        );
        await writeFile(infraCsprojPath, contents);
      }
    }
  }

  // Write tailored appsettings.json
  await writeAppSettings(backendDir, pascalName, connectionString, config, presentationFolder);

  await writeInfrastructureDi(backendDir, pascalName, config);
  await writeApplicationDi(backendDir, pascalName, config);
  await writePresentationDi(backendDir, pascalName, config, presentationFolder);
  await writePresentationProgramCs(backendDir, pascalName, config, presentationFolder);

  // If Dapper is selected, write IDbConnectionFactory
  if (config.orm === 'dapper' || config.orm === 'efcore-dapper') {
    await writeDapperConnectionFactory(backendDir, pascalName, config);
  }

  // If SignalR is selected and API project, write AppHub
  if (config.realtime === 'signalr' && presentationFolder === 'API') {
    await writeSignalRHub(backendDir, pascalName);
  }
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 * @param {string} connectionString
 * @param {object} config
 * @param {string} presentationFolder
 */
async function writeAppSettings(targetDir, pascalName, connectionString, config, presentationFolder) {
  const isWeb = presentationFolder === 'Web';
  const appSettings = {
    ConnectionStrings: {
      DefaultConnection: connectionString.replace(/\\\\/g, '\\'),
    },
    AllowedHosts: '*',
  };

  if (!isWeb) {
    appSettings.Cors = {
      AllowedOrigins: [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:4200',
      ],
    };
  }

  if (config.logging === 'serilog') {
    appSettings.Serilog = {
      MinimumLevel: {
        Default: 'Information',
        Override: {
          Microsoft: 'Warning',
          'Microsoft.AspNetCore': 'Warning',
        },
      },
    };
  }

  if (shouldGenerateIdentityArtifacts(config.authMode)) {
    appSettings.Auth = {
      SeedAdmin: {
        Enabled: false,
        Email: 'admin@example.com',
        Password: '',
      },
    };
  }

  await writeFile(
    path.join(targetDir, presentationFolder, 'appsettings.json'),
    `${JSON.stringify(appSettings, null, 2)}\n`,
  );

  const devSettings = {
    ConnectionStrings: {
      DefaultConnection: connectionString.replace(/\\\\/g, '\\'),
    },
  };

  if (config.logging === 'serilog') {
    devSettings.Serilog = {
      MinimumLevel: {
        Default: 'Debug',
        Override: {
          Microsoft: 'Information',
          'Microsoft.AspNetCore': 'Information',
        },
      },
    };
  }

  await writeFile(
    path.join(targetDir, presentationFolder, 'appsettings.Development.json'),
    `${JSON.stringify(devSettings, null, 2)}\n`,
  );
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 * @param {object} config
 */
/**
 * @param {string} pascalName
 * @param {object} config
 */
export function renderInfrastructureDi(pascalName, config) {
  let dbRegistration = '';
  let usings = ['using Microsoft.Extensions.Configuration;', 'using Microsoft.Extensions.DependencyInjection;'];

  const needsConnectionString =
    config.orm === 'efcore' ||
    config.orm === 'efcore-dapper' ||
    (config.backgroundJobs === 'hangfire' && config.database !== 'sqlite');

  if (needsConnectionString) {
    dbRegistration += `
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("Connection string 'DefaultConnection' was not found.");
`;
  }

  if (config.orm === 'efcore' || config.orm === 'efcore-dapper') {
    usings.push('using Microsoft.EntityFrameworkCore;');
    usings.push(`using ${pascalName}.Application.Abstractions.Persistence;`);
    usings.push(`using ${pascalName}.Infrastructure.Persistence;`);

    let efMethod = 'UseSqlServer';
    if (config.database === 'postgresql') efMethod = 'UseNpgsql';
    if (config.database === 'sqlite') efMethod = 'UseSqlite';

    dbRegistration += `
        services.AddDbContext<ApplicationDbContext>((serviceProvider, options) =>
        {
            options.${efMethod}(connectionString);
            options.AddInterceptors(serviceProvider.GetServices<Microsoft.EntityFrameworkCore.Diagnostics.ISaveChangesInterceptor>());
        });

        services.AddScoped<IApplicationDbContext>(provider =>
            provider.GetRequiredService<ApplicationDbContext>());
`;
  }

  if (config.orm === 'dapper' || config.orm === 'efcore-dapper') {
    usings.push(`using ${pascalName}.Application.Abstractions.Persistence;`);
    usings.push(`using ${pascalName}.Infrastructure.Persistence;`);
    dbRegistration += `
        services.AddScoped<IDbConnectionFactory, DbConnectionFactory>();
`;
  }

  if (config.backgroundJobs === 'hangfire') {
    usings.push('using Hangfire;');
    let storageMethod = 'UseSqlServerStorage(connectionString)';
    if (config.database === 'postgresql') {
      usings.push('using Hangfire.PostgreSql;');
      storageMethod = 'UsePostgreSqlStorage(connectionString)';
    }
    if (config.database === 'sqlite') {
      usings.push('using Hangfire.MemoryStorage;');
      storageMethod = 'UseMemoryStorage()';
    }

    dbRegistration += `
        services.AddHangfire(hangfire =>
        {
            hangfire.SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
                  .UseSimpleAssemblyNameTypeSerializer()
                  .UseRecommendedSerializerSettings()
                  .${storageMethod};
        });
        services.AddHangfireServer();
`;
  }

  dbRegistration += `
        RegisterFeatureInfrastructure(services, configuration);
`;

  const distinctUsings = [...new Set(usings)].join('\n');

  return `${distinctUsings}

namespace ${pascalName}.Infrastructure.DependencyInjection;

public static class InfrastructureServiceExtensions
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
${dbRegistration}
        return services;
    }

    static void RegisterFeatureInfrastructure(
        IServiceCollection services,
        IConfiguration configuration)
    {
        // Feature generator appends optional infrastructure registrations here.
    }
}
`;
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 * @param {object} config
 */
async function writeInfrastructureDi(targetDir, pascalName, config) {
  await writeFile(
    path.join(targetDir, 'Infrastructure', 'DependencyInjection', 'InfrastructureServiceExtensions.cs'),
    renderInfrastructureDi(pascalName, config),
  );
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 * @param {object} config
 */
async function writeApplicationDi(targetDir, pascalName, config) {
  const content = renderApplicationServiceExtensions(pascalName, {
    servicesArchitecture: config.architecture === 'services',
    mapping: config.mapping,
  });
  await writeFile(
    path.join(targetDir, 'Application', 'DependencyInjection', 'ApplicationServiceExtensions.cs'),
    content,
  );
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 * @param {object} config
 * @param {string} presentationFolder
 */
async function writePresentationDi(targetDir, pascalName, config, presentationFolder) {
  if (presentationFolder === 'Web') {
    await writeFile(
      path.join(targetDir, 'Web', 'DependencyInjection', 'WebServiceExtensions.cs'),
      renderWebServiceExtensions(pascalName, { presentation: config.presentation }),
    );
  } else {
    let extra = '';
    if (config.realtime === 'signalr') {
      extra = '        services.AddSignalR();\n';
    }
    await writeFile(
      path.join(targetDir, 'API', 'DependencyInjection', 'ApiServiceExtensions.cs'),
      renderApiServiceExtensions(pascalName, {
        minimalApi: config.presentation === 'minimal-api',
        extraRegistrations: extra,
      }),
    );
  }
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 * @param {object} config
 * @param {string} presentationFolder
 */
async function writePresentationProgramCs(targetDir, pascalName, config, presentationFolder) {
  if (presentationFolder === 'Web') {
    await writeWebProgramCs(targetDir, pascalName, config);
  } else {
    await writeApiProgramCs(targetDir, pascalName, config);
  }
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 * @param {object} config
 */
async function writeApiProgramCs(targetDir, pascalName, config) {
  const usings = [
    `using ${pascalName}.API.DependencyInjection;`,
    `using ${pascalName}.Application.DependencyInjection;`,
    `using ${pascalName}.Infrastructure.DependencyInjection;`,
  ];

  if (config.logging === 'serilog') {
    usings.push('using Serilog;');
  }

  let serilogBuilder = '';
  let serilogMiddleware = '';
  if (config.logging === 'serilog') {
    serilogBuilder = `
builder.Host.UseSerilog((context, services, configuration) =>
{
    configuration
        .ReadFrom.Configuration(context.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .WriteTo.Console();
});
`;
    serilogMiddleware = 'app.UseSerilogRequestLogging();\n';
  }

  let signalrEndpoint = '';
  if (config.realtime === 'signalr') {
    signalrEndpoint = `app.MapHub<${pascalName}.API.Hubs.AppHub>("/hubs/app");\n`;
  }

  let hangfireEndpoint = '';
  if (config.backgroundJobs === 'hangfire') {
    usings.push('using Hangfire;');
    hangfireEndpoint = 'app.UseHangfireDashboard("/hangfire");\n';
  }

  const distinctUsings = [...new Set(usings)].join('\n');
  const controllerMapping = config.presentation === 'controllers'
    ? 'app.MapControllers();\n'
    : '';

  const content = `${distinctUsings}

var builder = WebApplication.CreateBuilder(args);
${serilogBuilder}
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddApiServices(builder.Configuration);

var app = builder.Build();

app.UseExceptionHandler();
${serilogMiddleware}
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.UseCors("Client");
app.MapHealthChecks("/health");
${hangfireEndpoint}${signalrEndpoint}${controllerMapping}app.Run();
`;

  await writeFile(path.join(targetDir, 'API', 'Program.cs'), content);
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 * @param {object} config
 */
async function writeWebProgramCs(targetDir, pascalName, config) {
  const usings = [
    `using ${pascalName}.Application.DependencyInjection;`,
    `using ${pascalName}.Infrastructure.DependencyInjection;`,
    `using ${pascalName}.Web.DependencyInjection;`,
  ];

  if (config.logging === 'serilog') {
    usings.push('using Serilog;');
  }

  let serilogBuilder = '';
  let serilogMiddleware = '';
  if (config.logging === 'serilog') {
    serilogBuilder = `
builder.Host.UseSerilog((context, services, configuration) =>
{
    configuration
        .ReadFrom.Configuration(context.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .WriteTo.Console();
});
`;
    serilogMiddleware = 'app.UseSerilogRequestLogging();\n';
  }

  let hangfireEndpoint = '';
  if (config.backgroundJobs === 'hangfire') {
    usings.push('using Hangfire;');
    hangfireEndpoint = 'app.UseHangfireDashboard("/hangfire");\n';
  }

  const isRazor = config.presentation === 'razor-pages';
  const routingEndpoint = isRazor
    ? 'app.MapRazorPages();\n'
    : `app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");\n`;

  const exceptionPath = isRazor ? '/Error' : '/Home/Error';

  const distinctUsings = [...new Set(usings)].join('\n');

  const content = `${distinctUsings}

var builder = WebApplication.CreateBuilder(args);
${serilogBuilder}
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddWebServices(builder.Configuration);

var app = builder.Build();

${serilogMiddleware}
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("${exceptionPath}");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();

app.UseAuthorization();
${hangfireEndpoint}
${routingEndpoint}app.Run();
`;

  await writeFile(path.join(targetDir, 'Web', 'Program.cs'), content);
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 * @param {object} config
 */
async function writeDapperConnectionFactory(targetDir, pascalName, config) {
  // Interface in Application
  const iface = `using System.Data;

namespace ${pascalName}.Application.Abstractions.Persistence;

public interface IDbConnectionFactory
{
    IDbConnection CreateConnection();
}
`;
  await writeFile(path.join(targetDir, 'Application', 'Abstractions', 'Persistence', 'IDbConnectionFactory.cs'), iface);

  // Implementation in Infrastructure
  let connectionClass = 'SqlConnection';
  let connectionUsing = 'using Microsoft.Data.SqlClient;';
  if (config.database === 'postgresql') {
    connectionClass = 'NpgsqlConnection';
    connectionUsing = 'using Npgsql;';
  } else if (config.database === 'sqlite') {
    connectionClass = 'SqliteConnection';
    connectionUsing = 'using Microsoft.Data.Sqlite;';
  }

  const impl = `using System.Data;
using Microsoft.Extensions.Configuration;
using ${pascalName}.Application.Abstractions.Persistence;
${connectionUsing}

namespace ${pascalName}.Infrastructure.Persistence;

public class DbConnectionFactory : IDbConnectionFactory
{
    private readonly string _connectionString;

    public DbConnectionFactory(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("Connection string 'DefaultConnection' was not found.");
    }

    public IDbConnection CreateConnection()
    {
        return new ${connectionClass}(_connectionString);
    }
}
`;
  await writeFile(path.join(targetDir, 'Infrastructure', 'Persistence', 'DbConnectionFactory.cs'), impl);
}

/**
 * @param {string} targetDir
 * @param {string} pascalName
 */
async function writeSignalRHub(targetDir, pascalName) {
  const hub = `using Microsoft.AspNetCore.SignalR;

namespace ${pascalName}.API.Hubs;

public class AppHub : Hub
{
    public async Task SendMessage(string user, string message)
    {
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }
}
`;
  await writeFile(path.join(targetDir, 'API', 'Hubs', 'AppHub.cs'), hub);
}
