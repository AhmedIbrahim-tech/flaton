import { getBackendFilePath } from '../../utils/project-paths.js';
import {
  ensureTrailingNewline,
  upsertMethodStatement,
  upsertNestedStaticClass,
  upsertTypeMember,
  upsertUsing,
} from '../../utils/csharp-source.js';

/**
 * Canonical Clean Architecture file locations and registry updaters.
 * Features are business capabilities distributed across layers — never a
 * single feature-named folder that mixes Domain, Application, and API.
 */

export function applicationFeatureName(config) {
  return config.feature.singularName;
}

export function applicationFeatureBase(config, ...segments) {
  return getBackendFilePath(
    config,
    'Application',
    'Features',
    applicationFeatureName(config),
    ...segments,
  );
}

export function applicationFeatureNamespace(config, ...segments) {
  const parts = [
    config.projectName,
    'Application',
    'Features',
    applicationFeatureName(config),
    ...segments,
  ];
  return parts.join('.');
}

export function applicationModuleBase(config, ...segments) {
  return getBackendFilePath(
    config,
    'Application',
    'Modules',
    config.feature.pluralName,
    ...segments,
  );
}

export function applicationModuleNamespace(config, ...segments) {
  const parts = [
    config.projectName,
    'Application',
    'Modules',
    config.feature.pluralName,
    ...segments,
  ];
  return parts.join('.');
}

/** Fully-qualified domain entity type, safe inside Features.{Entity} namespaces. */
export function entityClrName(config) {
  return `${config.projectName}.Domain.Entities.${config.feature.singularName}`;
}

export function routerFilePath(configOrManifest) {
  return getBackendFilePath(configOrManifest, 'API', 'Contracts', 'Router.cs');
}

export function applicationDiPath(configOrManifest) {
  return getBackendFilePath(
    configOrManifest,
    'Application',
    'DependencyInjection',
    'ApplicationServiceExtensions.cs',
  );
}

export function infrastructureDiPath(configOrManifest) {
  return getBackendFilePath(
    configOrManifest,
    'Infrastructure',
    'DependencyInjection',
    'InfrastructureServiceExtensions.cs',
  );
}

export function apiDiPath(configOrManifest) {
  return getBackendFilePath(
    configOrManifest,
    'API',
    'DependencyInjection',
    'ApiServiceExtensions.cs',
  );
}

export function renderCentralRouter(ns) {
  return `namespace ${ns}.API.Contracts;

public static class Router
{
    private const string Root = "api";
    private const string Version = "v1";
    private const string Rule = Root + "/" + Version + "/";
}
`;
}

/**
 * @param {string} resourcePath URL segment after api/v1/, e.g. "Products" or "Auth"
 * @param {{ name: string, suffix?: string }[]} routes
 */
export function renderRouterNestedClassBody(resourcePath, routes) {
  const lines = [`        private const string Prefix = Rule + "${resourcePath}";`];
  for (const route of routes) {
    if (!route.suffix) {
      lines.push(`        public const string ${route.name} = Prefix;`);
    } else {
      lines.push(`        public const string ${route.name} = Prefix + "${route.suffix}";`);
    }
  }
  return lines.join('\n');
}

/**
 * @param {object} configOrManifest
 * @param {string} ns
 * @param {string} className
 * @param {string} resourcePath
 * @param {{ name: string, suffix?: string }[]} routes
 */
export function planRouterUpdate(configOrManifest, ns, className, resourcePath, routes) {
  return {
    relativePath: routerFilePath(configOrManifest),
    update: (existing) => {
      const source = existing?.trim() ? existing : renderCentralRouter(ns);
      const withNamespace = source.includes(`${ns}.API.Contracts`)
        ? source
        : source.replace(/namespace\s+[\w.]+\s*;/, `namespace ${ns}.API.Contracts;`);
      return upsertNestedStaticClass(
        withNamespace,
        'Router',
        className,
        renderRouterNestedClassBody(resourcePath, routes),
      );
    },
  };
}

/**
 * @param {object} configOrManifest
 * @param {string} ns
 * @param {string} entityName
 * @param {string} dbSetName
 */
export function planDbSetUpdates(configOrManifest, ns, entityName, dbSetName, entityNamespace) {
  return [
    {
      relativePath: getBackendFilePath(
        configOrManifest,
        'Application',
        'Abstractions',
        'Persistence',
        'IApplicationDbContext.cs',
      ),
      update: (existing) =>
        upsertInterfaceDbSet(existing, ns, entityName, dbSetName, entityNamespace),
    },
    {
      relativePath: getBackendFilePath(
        configOrManifest,
        'Infrastructure',
        'Persistence',
        'ApplicationDbContext.cs',
      ),
      update: (existing) => upsertContextDbSet(existing, ns, entityName, dbSetName, entityNamespace),
    },
  ];
}

/**
 * @param {string} existing
 * @param {string} ns
 * @param {string} entityName
 * @param {string} dbSetName
 */
export function upsertInterfaceDbSet(existing, ns, entityName, dbSetName, entityNamespace) {
  if (!existing?.trim()) {
    throw new Error('IApplicationDbContext.cs is missing; generate the backend project first.');
  }

  const entityNs = entityNamespace ?? `${ns}.Domain.Entities`;
  let source = upsertUsing(existing, `using ${entityNs};`);
  source = upsertUsing(source, 'using Microsoft.EntityFrameworkCore;');
  return upsertTypeMember(
    source,
    'IApplicationDbContext',
    `    DbSet<${entityName}> ${dbSetName} { get; }`,
  );
}

/**
 * @param {string} existing
 * @param {string} ns
 * @param {string} entityName
 * @param {string} dbSetName
 * @param {string} [entityNamespace]
 */
export function upsertContextDbSet(existing, ns, entityName, dbSetName, entityNamespace) {
  if (!existing?.trim()) {
    throw new Error('ApplicationDbContext.cs is missing; generate the backend project first.');
  }

  const entityNs = entityNamespace ?? `${ns}.Domain.Entities`;
  let source = upsertUsing(existing, `using ${entityNs};`);
  source = upsertUsing(source, 'using Microsoft.EntityFrameworkCore;');
  return upsertTypeMember(
    source,
    'ApplicationDbContext',
    `    public DbSet<${entityName}> ${dbSetName} => Set<${entityName}>();`,
  );
}

/**
 * @param {string} existing
 * @param {string} ns
 * @param {string[]} usingLines
 * @param {string} registration
 */
export function upsertInfrastructureRegistration(existing, ns, usingLines, registration) {
  let content = existing?.trim()
    ? existing
    : renderInfrastructureServiceExtensions(ns, { includeGeneratedHook: true });

  const usings = Array.isArray(usingLines) ? usingLines : [usingLines];
  for (const usingLine of usings) {
    if (usingLine) {
      content = upsertUsing(content, usingLine);
    }
  }

  const statement = registration.trim();
  const placeholder = '        // Feature generator appends optional infrastructure registrations here.';
  if (content.includes(placeholder) && !content.includes(statement)) {
    return ensureTrailingNewline(content.replace(placeholder, `        ${statement}`));
  }

  return upsertMethodStatement(content, 'RegisterFeatureInfrastructure', statement);
}

/**
 * @param {string} existing
 * @param {string} ns
 * @param {string} singularName Singular application feature name (e.g. Product)
 * @param {string} pluralName
 * @param {string} [mapping]
 */
export function upsertApplicationServiceRegistration(existing, ns, singularName, pluralName, mapping = 'manual') {
  const registration = `        services.AddScoped<I${singularName}Service, ${singularName}Service>();`;
  let content = existing?.trim()
    ? existing
    : renderApplicationServiceExtensions(ns, { servicesArchitecture: true, mapping });

  content = upsertUsing(content, `using ${ns}.Application.Modules.${pluralName}.Interfaces;`);
  content = upsertUsing(content, `using ${ns}.Application.Modules.${pluralName}.Services;`);
  const placeholder = '        // Feature generator appends service registrations here.';
  if (content.includes(placeholder) && !content.includes(registration.trim())) {
    return ensureTrailingNewline(content.replace(placeholder, registration));
  }

  return upsertMethodStatement(content, 'RegisterFeatureServices', registration);
}

/**
 * @param {string} existing
 * @param {string} ns
 */
export function upsertAutoMapperRegistration(existing, ns) {
  if (!existing?.trim()) {
    return renderApplicationServiceExtensions(ns, { mapping: 'automapper' });
  }
  let content = upsertUsing(existing, 'using AutoMapper;');
  const stmt = '        services.AddAutoMapper(cfg => cfg.AddMaps(typeof(ApplicationServiceExtensions).Assembly));';
  if (!content.includes('AddAutoMapper(')) {
    content = upsertMethodStatement(content, 'AddApplication', stmt);
  }
  return content;
}

export function renderApplicationServiceExtensions(ns, { servicesArchitecture = false, mapping = 'manual' } = {}) {
  const usings = ['using FluentValidation;', 'using Microsoft.Extensions.DependencyInjection;'];
  let body = '        services.AddValidatorsFromAssembly(typeof(ApplicationServiceExtensions).Assembly);\n';

  if (!servicesArchitecture) {
    usings.push('using MediatR;');
    usings.push(`using ${ns}.Application.Behaviors;`);
    body += `        services.AddMediatR(configuration =>
        {
            configuration.RegisterServicesFromAssembly(typeof(ApplicationServiceExtensions).Assembly);
            configuration.AddOpenBehavior(typeof(ValidationBehavior<,>));
            configuration.AddOpenBehavior(typeof(LoggingBehavior<,>));
        });
`;
  }

  if (mapping === 'automapper') {
    usings.push('using AutoMapper;');
    body += '        services.AddAutoMapper(cfg => cfg.AddMaps(typeof(ApplicationServiceExtensions).Assembly));\n';
  }

  if (servicesArchitecture) {
    body += '        RegisterFeatureServices(services);\n';
  }

  const hook = servicesArchitecture
    ? `
    static void RegisterFeatureServices(IServiceCollection services)
    {
        // Feature generator appends service registrations here.
    }
`
    : '';

  return `${[...new Set(usings)].join('\n')}

namespace ${ns}.Application.DependencyInjection;

public static class ApplicationServiceExtensions
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
${body}
        return services;
    }
${hook}}
`;
}

export function renderInfrastructureServiceExtensions(ns, config = {}) {
  const includeGeneratedHook = config.includeGeneratedHook !== false;
  const lines = [
    'using Microsoft.Extensions.Configuration;',
    'using Microsoft.Extensions.DependencyInjection;',
  ];

  return `${lines.join('\n')}

namespace ${ns}.Infrastructure.DependencyInjection;

public static class InfrastructureServiceExtensions
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
${config.body ?? '        RegisterFeatureInfrastructure(services, configuration);\n'}
        return services;
    }
${includeGeneratedHook ? `
    static void RegisterFeatureInfrastructure(
        IServiceCollection services,
        IConfiguration configuration)
    {
        // Feature generator appends optional infrastructure registrations here.
    }
` : ''}}
`;
}

export function renderApiServiceExtensions(ns, config = {}) {
  const usings = [
    `using ${ns}.API.Middleware;`,
    'using Microsoft.Extensions.Configuration;',
    'using Microsoft.Extensions.DependencyInjection;',
  ];

  const controllerRegistration = config.minimalApi
    ? ''
    : '        services.AddControllers();\n';

  return `${usings.join('\n')}

namespace ${ns}.API.DependencyInjection;

public static class ApiServiceExtensions
{
    public static IServiceCollection AddApiServices(
        this IServiceCollection services,
        IConfiguration configuration)
    {
${controllerRegistration}        services.AddExceptionHandler<GlobalExceptionHandler>();
        services.AddProblemDetails();
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen();
        services.AddHealthChecks();
${config.extraRegistrations ?? ''}
        var allowedOrigins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
            ?? ["http://localhost:3000", "http://localhost:5173", "http://localhost:4200"];
        services.AddCors(options =>
        {
            options.AddPolicy("Client", policy =>
            {
                policy
                    .WithOrigins(allowedOrigins)
                    .AllowAnyHeader()
                    .AllowAnyMethod()
                    .AllowCredentials();
            });
        });

        return services;
    }
}
`;
}

export function renderWebServiceExtensions(ns, config = {}) {
  const isRazorPages = config.presentation === 'razor-pages';
  const methodRegistration = isRazorPages
    ? '        services.AddRazorPages();'
    : '        services.AddControllersWithViews();';

  return `using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ${ns}.Web.DependencyInjection;

public static class WebServiceExtensions
{
    public static IServiceCollection AddWebServices(
        this IServiceCollection services,
        IConfiguration configuration)
    {
${methodRegistration}
${config.extraRegistrations ?? ''}
        return services;
    }
}
`;
}

export function renderDomainException(ns) {
  return `namespace ${ns}.Domain.Exceptions;

public abstract class DomainException : Exception
{
    protected DomainException(string message)
        : base(message)
    {
    }

    protected DomainException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
`;
}

export function renderDomainEvent(ns) {
  return `namespace ${ns}.Domain.DomainEvents;

public interface IDomainEvent
{
    DateTime OccurredOnUtc { get; }
}
`;
}

export function renderSpecification(ns) {
  return `namespace ${ns}.Domain.Specifications;

public interface ISpecification<in T>
{
    bool IsSatisfiedBy(T candidate);
}
`;
}

export function renderValueObject(ns) {
  return `namespace ${ns}.Domain.ValueObjects;

public abstract class ValueObject : IEquatable<ValueObject>
{
    protected abstract IEnumerable<object?> GetAtomicValues();

    public override bool Equals(object? obj) => obj is ValueObject other && Equals(other);

    public bool Equals(ValueObject? other)
    {
        if (other is null || other.GetType() != GetType())
        {
            return false;
        }

        return GetAtomicValues().SequenceEqual(other.GetAtomicValues());
    }

    public override int GetHashCode()
    {
        return GetAtomicValues()
            .Aggregate(0, (hash, value) => HashCode.Combine(hash, value));
    }
}
`;
}
