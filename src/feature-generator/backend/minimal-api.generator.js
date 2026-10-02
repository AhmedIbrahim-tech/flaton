import { canBeLookupTarget } from './lookup.generator.js';
import { getBackendFilePath } from '../../utils/project-paths.js';
import { isServicesArchitecture } from './architecture.js';
import { applicationFeatureName, planRouterUpdate } from './clean-architecture.js';

/**
 * @param {object} config
 * @returns {{ relativePath: string, contents: string }[]}
 */
export function planMinimalApiFiles(config) {
  const { singularName, pluralName } = config.feature;
  const isServices = isServicesArchitecture(config.architecture);

  const base = (...segments) =>
    getBackendFilePath(config, 'API', 'Endpoints', pluralName, ...segments);

  return [
    {
      relativePath: base(`Create${singularName}Endpoint.cs`),
      contents: renderCreateEndpoint(config, isServices),
    },
    {
      relativePath: base(`Update${singularName}Endpoint.cs`),
      contents: renderUpdateEndpoint(config, isServices),
    },
    {
      relativePath: base(`Delete${singularName}Endpoint.cs`),
      contents: renderDeleteEndpoint(config, isServices),
    },
    {
      relativePath: base(`Get${singularName}ByIdEndpoint.cs`),
      contents: renderGetByIdEndpoint(config, isServices),
    },
    {
      relativePath: base(`Get${pluralName}Endpoint.cs`),
      contents: renderGetListEndpoint(config, isServices),
    },
    {
      relativePath: base(`${singularName}Endpoints.cs`),
      contents: renderEndpointsRoot(config),
    },
  ];
}

/**
 * @param {object} config
 */
export function planMinimalApiRegistryUpdates(config) {
  const { singularName, pluralName } = config.feature;
  const ops = config.operations;
  const ns = config.projectName;

  /** @type {{ name: string, suffix?: string }[]} */
  const routes = [{ name: 'Root' }];
  if (ops.search) routes.push({ name: 'Search', suffix: '/Search' });
  if (canBeLookupTarget(config)) routes.push({ name: 'Lookup', suffix: '/Lookup' });
  if (ops.getById) routes.push({ name: 'ById', suffix: '/{id:guid}' });
  if (ops.create) routes.push({ name: 'Create' });
  if (ops.update) routes.push({ name: 'Update', suffix: '/{id:guid}' });
  if (ops.delete) routes.push({ name: 'Delete', suffix: '/{id:guid}' });
  if (ops.restore) routes.push({ name: 'Restore', suffix: '/{id:guid}/Restore' });

  const programCsPath = getBackendFilePath(config, 'API', 'Program.cs');

  return [
    planRouterUpdate(config, ns, pluralName, pluralName, routes),
    {
      relativePath: programCsPath,
      update: (existing) => {
        let content = existing;
        const usingLine = `using ${ns}.API.Endpoints.${pluralName};`;
        if (!content.includes(usingLine)) {
          content = `${usingLine}\n${content}`;
        }
        const mapLine = `app.Map${singularName}Endpoints();`;
        if (!content.includes(mapLine)) {
          const runAnchor = /app\.Run\(\);/;
          if (runAnchor.test(content)) {
            content = content.replace(runAnchor, `${mapLine}\napp.Run();`);
          }
        }
        return content;
      },
    },
  ];
}

function renderGetListEndpoint(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);

  const usings = [
    'using Microsoft.AspNetCore.Builder;',
    'using Microsoft.AspNetCore.Http;',
    'using Microsoft.AspNetCore.Routing;',
    `using ${ns}.API.Contracts;`,
  ];

  if (isServices) {
    usings.push(
      `using ${ns}.Application.Modules.${pluralName}.DTOs;`,
      `using ${ns}.Application.Modules.${pluralName}.Interfaces;`,
    );
  } else {
    usings.push(
      'using MediatR;',
      `using ${ns}.Application.Features.${featureName}.Queries.Search;`,
    );
  }

  const handlerCall = isServices
    ? 'var result = await service.SearchAsync(request, cancellationToken);'
    : 'var result = await sender.Send(request, cancellationToken);';

  const params = isServices
    ? `Search${pluralName}Dto request, I${singularName}Service service, CancellationToken cancellationToken`
    : `Search${pluralName}Query request, ISender sender, CancellationToken cancellationToken`;

  return `${usings.join('\n')}

namespace ${ns}.API.Endpoints.${pluralName};

public static class Get${pluralName}Endpoint
{
    public static void MapGet${pluralName}Endpoint(this IEndpointRouteBuilder app)
    {
        app.MapPost(Router.${pluralName}.Search, async (${params}) =>
        {
            ${handlerCall}
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(result.Error);
        })
        .WithName("Search${pluralName}")
        .WithTags("${pluralName}");
    }
}
`;
}

function renderGetByIdEndpoint(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);

  const usings = [
    'using Microsoft.AspNetCore.Builder;',
    'using Microsoft.AspNetCore.Http;',
    'using Microsoft.AspNetCore.Routing;',
    `using ${ns}.API.Contracts;`,
  ];

  if (isServices) {
    usings.push(`using ${ns}.Application.Modules.${pluralName}.Interfaces;`);
  } else {
    usings.push(
      'using MediatR;',
      `using ${ns}.Application.Features.${featureName}.Queries.GetById;`,
    );
  }

  const handlerCall = isServices
    ? 'var result = await service.GetByIdAsync(id, cancellationToken);'
    : `var result = await sender.Send(new Get${singularName}ByIdQuery(id), cancellationToken);`;

  const params = isServices
    ? `Guid id, I${singularName}Service service, CancellationToken cancellationToken`
    : `Guid id, ISender sender, CancellationToken cancellationToken`;

  return `${usings.join('\n')}

namespace ${ns}.API.Endpoints.${pluralName};

public static class Get${singularName}ByIdEndpoint
{
    public static void MapGet${singularName}ByIdEndpoint(this IEndpointRouteBuilder app)
    {
        app.MapGet(Router.${pluralName}.ById, async (${params}) =>
        {
            ${handlerCall}
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.NotFound(result.Error);
        })
        .WithName("Get${singularName}ById")
        .WithTags("${pluralName}");
    }
}
`;
}

function renderCreateEndpoint(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);

  const usings = [
    'using Microsoft.AspNetCore.Builder;',
    'using Microsoft.AspNetCore.Http;',
    'using Microsoft.AspNetCore.Routing;',
    `using ${ns}.API.Contracts;`,
  ];

  if (isServices) {
    usings.push(
      `using ${ns}.Application.Modules.${pluralName}.DTOs;`,
      `using ${ns}.Application.Modules.${pluralName}.Interfaces;`,
    );
  } else {
    usings.push(
      'using MediatR;',
      `using ${ns}.Application.Features.${featureName}.Commands.Create;`,
    );
  }

  const handlerCall = isServices
    ? 'var result = await service.CreateAsync(request, cancellationToken);'
    : 'var result = await sender.Send(request, cancellationToken);';

  const params = isServices
    ? `Create${singularName}Dto request, I${singularName}Service service, CancellationToken cancellationToken`
    : `Create${singularName}Command request, ISender sender, CancellationToken cancellationToken`;

  return `${usings.join('\n')}

namespace ${ns}.API.Endpoints.${pluralName};

public static class Create${singularName}Endpoint
{
    public static void MapCreate${singularName}Endpoint(this IEndpointRouteBuilder app)
    {
        app.MapPost(Router.${pluralName}.Create, async (${params}) =>
        {
            ${handlerCall}
            return result.IsSuccess
                ? Results.Created($"{Router.${pluralName}.Root}/{result.Value.Id}", result.Value)
                : Results.BadRequest(result.Error);
        })
        .WithName("Create${singularName}")
        .WithTags("${pluralName}");
    }
}
`;
}

function renderUpdateEndpoint(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);

  const usings = [
    'using Microsoft.AspNetCore.Builder;',
    'using Microsoft.AspNetCore.Http;',
    'using Microsoft.AspNetCore.Routing;',
    `using ${ns}.API.Contracts;`,
  ];

  if (isServices) {
    usings.push(
      `using ${ns}.Application.Modules.${pluralName}.DTOs;`,
      `using ${ns}.Application.Modules.${pluralName}.Interfaces;`,
    );
  } else {
    usings.push(
      'using MediatR;',
      `using ${ns}.Application.Features.${featureName}.Commands.Update;`,
    );
  }

  const handlerCall = isServices
    ? 'var result = await service.UpdateAsync(id, request, cancellationToken);'
    : 'var result = await sender.Send(request, cancellationToken);';

  const params = isServices
    ? `Guid id, Update${singularName}Dto request, I${singularName}Service service, CancellationToken cancellationToken`
    : `Guid id, Update${singularName}Command request, ISender sender, CancellationToken cancellationToken`;

  return `${usings.join('\n')}

namespace ${ns}.API.Endpoints.${pluralName};

public static class Update${singularName}Endpoint
{
    public static void MapUpdate${singularName}Endpoint(this IEndpointRouteBuilder app)
    {
        app.MapPut(Router.${pluralName}.Update, async (${params}) =>
        {
            ${handlerCall}
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(result.Error);
        })
        .WithName("Update${singularName}")
        .WithTags("${pluralName}");
    }
}
`;
}

function renderDeleteEndpoint(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);

  const usings = [
    'using Microsoft.AspNetCore.Builder;',
    'using Microsoft.AspNetCore.Http;',
    'using Microsoft.AspNetCore.Routing;',
    `using ${ns}.API.Contracts;`,
  ];

  if (isServices) {
    usings.push(`using ${ns}.Application.Modules.${pluralName}.Interfaces;`);
  } else {
    usings.push(
      'using MediatR;',
      `using ${ns}.Application.Features.${featureName}.Commands.Delete;`,
    );
  }

  const handlerCall = isServices
    ? 'var result = await service.DeleteAsync(id, cancellationToken);'
    : `var result = await sender.Send(new Delete${singularName}Command(id), cancellationToken);`;

  const params = isServices
    ? `Guid id, I${singularName}Service service, CancellationToken cancellationToken`
    : `Guid id, ISender sender, CancellationToken cancellationToken`;

  return `${usings.join('\n')}

namespace ${ns}.API.Endpoints.${pluralName};

public static class Delete${singularName}Endpoint
{
    public static void MapDelete${singularName}Endpoint(this IEndpointRouteBuilder app)
    {
        app.MapDelete(Router.${pluralName}.Delete, async (${params}) =>
        {
            ${handlerCall}
            return result.IsSuccess
                ? Results.NoContent()
                : Results.BadRequest(result.Error);
        })
        .WithName("Delete${singularName}")
        .WithTags("${pluralName}");
    }
}
`;
}

function renderEndpointsRoot(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;

  return `using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;

namespace ${ns}.API.Endpoints.${pluralName};

public static class ${singularName}Endpoints
{
    public static IEndpointRouteBuilder Map${singularName}Endpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet${pluralName}Endpoint();
        app.MapGet${singularName}ByIdEndpoint();
        app.MapCreate${singularName}Endpoint();
        app.MapUpdate${singularName}Endpoint();
        app.MapDelete${singularName}Endpoint();
        return app;
    }
}
`;
}
