import {
  toCSharpType,
  csharpDefaultInitializer,
  groupFields,
} from '../fields/field-mappers.js';
import { pluralizePascal, toCamelCase } from '../utils/feature-naming.js';
import { planLookupFiles, canBeLookupTarget } from './lookup.generator.js';
import { getBackendFilePath } from '../../utils/project-paths.js';
import { isDapperOnly, isServicesArchitecture, usesDapper } from './architecture.js';
import { applicationFeatureBase, entityClrName } from './clean-architecture.js';
import { isAutoMapper } from '../feature-profile.js';
import {
  mappingCtorAssign,
  mappingCtorParam,
  mappingFields,
  mappingUsing,
  renderAutoMapperProfile,
  toDtoCall,
  toDtoListCall,
} from './mapping.js';
import {
  renderDapperCreateHandler,
  renderDapperDeleteHandler,
  renderDapperGetByIdHandler,
  renderDapperRestoreHandler,
  renderDapperSearchHandler,
  renderDapperUpdateHandler,
} from './dapper-application.generator.js';

/**
 * @param {object} config
 * @returns {{ relativePath: string, contents: string, writeMode?: string }[]}
 */
export function planApplicationFiles(config) {
  const { pluralName, singularName } = config.feature;
  const ops = config.operations;
  const base = (...segments) => applicationFeatureBase(config, ...segments);

  /** @type {{ relativePath: string, contents: string, writeMode?: string }[]} */
  const files = [
    {
      relativePath: base('DTOs', `${singularName}Dto.cs`),
      contents: renderDto(config),
    },
    {
      relativePath: base('Mapping', isAutoMapper(config) ? `${singularName}MappingProfile.cs` : `${singularName}Mappings.cs`),
      contents: isAutoMapper(config) ? renderAutoMapperProfile(config) : renderMappings(config),
    },
  ];

  if (ops.search) {
    files.push(
      {
        relativePath: base('Queries', 'Search', `Search${pluralName}Query.cs`),
        contents: renderSearchQuery(config),
      },
      {
        relativePath: base('Queries', 'Search', `Search${pluralName}QueryHandler.cs`),
        contents: renderSearchHandler(config),
      },
      {
        relativePath: base('Queries', 'Search', `Search${pluralName}QueryValidator.cs`),
        contents: renderSearchValidator(config),
      },
    );
  }

  if (ops.getById) {
    files.push(
      {
        relativePath: base('Queries', 'GetById', `Get${singularName}ByIdQuery.cs`),
        contents: renderGetByIdQuery(config),
      },
      {
        relativePath: base('Queries', 'GetById', `Get${singularName}ByIdQueryHandler.cs`),
        contents: renderGetByIdHandler(config),
      },
    );
  }

  if (ops.create) {
    files.push(
      {
        relativePath: base('Commands', 'Create', `Create${singularName}Command.cs`),
        contents: renderCreateCommand(config),
      },
      {
        relativePath: base('Commands', 'Create', `Create${singularName}CommandHandler.cs`),
        contents: renderCreateHandler(config),
      },
      {
        relativePath: base('Commands', 'Create', `Create${singularName}CommandValidator.cs`),
        contents: renderCreateValidator(config),
      },
    );
  }

  if (ops.update) {
    files.push(
      {
        relativePath: base('Commands', 'Update', `Update${singularName}Command.cs`),
        contents: renderUpdateCommand(config),
      },
      {
        relativePath: base('Commands', 'Update', `Update${singularName}CommandHandler.cs`),
        contents: renderUpdateHandler(config),
      },
      {
        relativePath: base('Commands', 'Update', `Update${singularName}CommandValidator.cs`),
        contents: renderUpdateValidator(config),
      },
    );
  }

  if (ops.delete) {
    files.push(
      {
        relativePath: base('Commands', 'Delete', `Delete${singularName}Command.cs`),
        contents: renderDeleteCommand(config),
      },
      {
        relativePath: base('Commands', 'Delete', `Delete${singularName}CommandHandler.cs`),
        contents: renderDeleteHandler(config),
      },
    );
  }

  if (ops.restore) {
    files.push(
      {
        relativePath: base('Commands', 'Restore', `Restore${singularName}Command.cs`),
        contents: renderRestoreCommand(config),
      },
      {
        relativePath: base('Commands', 'Restore', `Restore${singularName}CommandHandler.cs`),
        contents: renderRestoreHandler(config),
      },
    );
  }

  // Every searchable feature with a string display becomes a lookup target.
  if (canBeLookupTarget(config)) {
    files.push(...planLookupFiles(config));
  }

  return files;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {object} config
 */
export function usesLookupModels(config) {
  return groupFields(config.fields).toMany.length > 0;
}

export function usesEnums(config) {
  return groupFields(config.fields).enums.length > 0;
}

export function commonUsings(config) {
  const ns = config.projectName;
  /** @type {string[]} */
  const usings = [];
  if (usesEnums(config)) {
    usings.push(`using ${ns}.Domain.Enums;`);
  }
  if (usesLookupModels(config)) {
    usings.push(`using ${ns}.Application.Common.Models;`);
  }
  return usings;
}

export function fieldProperty(field) {
  const type = toCSharpType(field);
  const init = csharpDefaultInitializer(field);
  return `    public ${type} ${field.name} { get; init; }${init}`;
}

export function buildIncludes(groups) {
  /** @type {string[]} */
  const includes = [];
  for (const field of groups.toOne) {
    includes.push(`            .Include(entity => entity.${field.name})`);
  }
  for (const field of groups.toMany) {
    includes.push(`            .Include(entity => entity.${field.collectionName})`);
  }
  for (const field of groups.mediaMultiple) {
    includes.push(`            .Include(entity => entity.${field.collectionName})`);
  }
  return includes;
}

/* ------------------------------------------------------------------ */
/* DTO                                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {object} config
 */
export function renderDto(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const isServices = isServicesArchitecture(config.architecture);
  const dtoNs = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${singularName}.DTOs`;
  const groups = groupFields(config.fields);

  /** @type {string[]} */
  const lines = [];

  for (const field of groups.scalar) {
    lines.push(fieldProperty(field));
  }

  for (const field of groups.enums) {
    lines.push(`    public ${toCSharpType(field)} ${field.name} { get; init; }`);
  }

  for (const field of groups.toOne) {
    const idType = field.nullable ? 'Guid?' : 'Guid';
    lines.push(`    public ${idType} ${field.foreignKeyName} { get; init; }`);
    if (field.nullable) {
      lines.push(`    public string? ${field.displayName} { get; init; }`);
    } else {
      lines.push(
        `    public string ${field.displayName} { get; init; } = string.Empty;`,
      );
    }
  }

  for (const field of groups.toMany) {
    lines.push(
      `    public IReadOnlyList<Guid> ${field.commandIdsName} { get; init; } = Array.Empty<Guid>();`,
    );
    lines.push(
      `    public IReadOnlyList<LookupItemDto> ${field.collectionName} { get; init; } = Array.Empty<LookupItemDto>();`,
    );
  }

  for (const field of groups.mediaSingle) {
    lines.push(`    public Guid? ${field.foreignKeyName} { get; init; }`);
  }

  for (const field of groups.mediaMultiple) {
    lines.push(
      `    public IReadOnlyList<Guid> ${field.commandIdsName} { get; init; } = Array.Empty<Guid>();`,
    );
  }

  const usings = commonUsings(config);
  const usingBlock = usings.length > 0 ? `${usings.join('\n')}\n\n` : '';

  return `${usingBlock}namespace ${dtoNs};

public sealed record ${singularName}Dto
{
    public Guid Id { get; init; }

${lines.join('\n\n')}

    public DateTime CreatedAtUtc { get; init; }

    public DateTime? UpdatedAtUtc { get; init; }

    public string RowVersion { get; init; } = string.Empty;
}
`;
}

/* ------------------------------------------------------------------ */
/* Mappings                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {object} config
 */
export function renderMappings(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const isServices = isServicesArchitecture(config.architecture);
  const dtoNs = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${singularName}.DTOs`;
  const mappingNs = isServices
    ? `${ns}.Application.Modules.${pluralName}.Mapping`
    : `${ns}.Application.Features.${singularName}.Mapping`;
  const groups = groupFields(config.fields);

  /** @type {string[]} */
  const assignments = [];

  for (const field of [...groups.scalar, ...groups.enums]) {
    assignments.push(`            ${field.name} = entity.${field.name},`);
  }

  for (const field of groups.toOne) {
    assignments.push(`            ${field.foreignKeyName} = entity.${field.foreignKeyName},`);
    const fallback = field.nullable ? 'null' : 'string.Empty';
    assignments.push(
      `            ${field.displayName} = entity.${field.name} != null ? entity.${field.name}.${field.display} : ${fallback},`,
    );
  }

  for (const field of groups.toMany) {
    assignments.push(
      `            ${field.commandIdsName} = entity.${field.collectionName}.Select(item => item.Id).ToList(),`,
    );
    assignments.push(
      `            ${field.collectionName} = entity.${field.collectionName}
                .Select(item => new LookupItemDto { Id = item.Id, DisplayName = item.${field.display} })
                .ToList(),`,
    );
  }

  for (const field of groups.mediaSingle) {
    assignments.push(`            ${field.foreignKeyName} = entity.${field.foreignKeyName},`);
  }

  for (const field of groups.mediaMultiple) {
    assignments.push(
      `            ${field.commandIdsName} = entity.${field.collectionName}.Select(item => item.Id).ToList(),`,
    );
  }

  const usings = [
    `using ${ns}.Domain.Entities;`,
    `using ${dtoNs};`,
  ];
  if (usesLookupModels(config)) {
    usings.push(`using ${ns}.Application.Common.Models;`);
  }

  return `${usings.join('\n')}

namespace ${mappingNs};

public static class ${singularName}Mappings
{
    public static ${singularName}Dto ToDto(${entityClrName(config)} entity)
    {
        return new ${singularName}Dto
        {
            Id = entity.Id,
${assignments.join('\n')}
            CreatedAtUtc = entity.CreatedAtUtc,
            UpdatedAtUtc = entity.UpdatedAtUtc,
            RowVersion = Convert.ToBase64String(entity.RowVersion),
        };
    }
}
`;
}

/* ------------------------------------------------------------------ */
/* Search                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {object} config
 */
export function renderSearchQuery(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);

  /** @type {string[]} */
  const filters = [];

  for (const field of groups.toOne) {
    filters.push(`    public Guid? ${field.foreignKeyName} { get; init; }`);
  }

  for (const field of groups.enums) {
    filters.push(`    public ${field.enumName}? ${field.name} { get; init; }`);
  }

  for (const field of groups.toMany) {
    filters.push(`    public Guid? ${field.target}Id { get; init; }`);
  }

  const filterBlock = filters.length > 0 ? `\n${filters.join('\n\n')}\n` : '\n';

  const usings = usesEnums(config) ? `using ${ns}.Domain.Enums;\n` : '';

  return `using MediatR;
${usings}using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;

namespace ${ns}.Application.Features.${singularName}.Queries.Search;

public sealed class Search${pluralName}Query : SearchRequest, IRequest<Result<PaginationResult<${singularName}Dto>>>
{${filterBlock}}
`;
}

/**
 * @param {object} config
 */
export function renderSearchHandler(config) {
  if (usesDapper(config.orm)) {
    return renderDapperSearchHandler(config);
  }
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);

  const includes = buildIncludes(groups);
  const includeBlock = includes.length > 0 ? `\n${includes.join('\n')}` : '';
  // With Include(...) the inferred type is IIncludableQueryable, which cannot
  // hold the IQueryable returned by later Where(...) calls. Pin the type.
  const queryDecl = includes.length > 0 ? `IQueryable<${entityClrName(config)}>` : 'var';

  /** @type {string[]} */
  const filterBlocks = [];

  for (const field of groups.toOne) {
    filterBlocks.push(`        if (request.${field.foreignKeyName}.HasValue)
        {
            query = query.Where(entity => entity.${field.foreignKeyName} == request.${field.foreignKeyName}.Value);
        }`);
  }

  for (const field of groups.enums) {
    filterBlocks.push(`        if (request.${field.name}.HasValue)
        {
            query = query.Where(entity => entity.${field.name} == request.${field.name}.Value);
        }`);
  }

  for (const field of groups.toMany) {
    filterBlocks.push(`        if (request.${field.target}Id.HasValue)
        {
            query = query.Where(entity => entity.${field.collectionName}.Any(item => item.Id == request.${field.target}Id.Value));
        }`);
  }

  const searchable = groups.scalar.filter(
    (field) => field.type === 'string' && field.searchable,
  );

  let searchBlock = '';
  if (searchable.length > 0) {
    const predicates = searchable
      .map((field) => `                EF.Functions.Like(entity.${field.name}, pattern)`)
      .join(' ||\n');

    searchBlock = `
        if (!string.IsNullOrWhiteSpace(request.SearchTerm))
        {
            var pattern = $"%{request.SearchTerm.Trim()}%";
            query = query.Where(entity =>
${predicates});
        }
`;
  }

  const sortableFields = [...groups.scalar, ...groups.enums];
  const sortCases = sortableFields
    .map((field) => {
      const key = String(field.name).toLowerCase();
      return `            "${key}" => descending
                ? query.OrderByDescending(entity => entity.${field.name})
                : query.OrderBy(entity => entity.${field.name}),`;
    })
    .join('\n');

  const filterSection =
    filterBlocks.length > 0 ? `\n${filterBlocks.join('\n\n')}\n` : '';

  return `${mappingUsing(config)}using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;
using ${ns}.Domain.Entities;
${usesEnums(config) ? `using ${ns}.Domain.Enums;\n` : ''}
namespace ${ns}.Application.Features.${singularName}.Queries.Search;

public sealed class Search${pluralName}QueryHandler
    : IRequestHandler<Search${pluralName}Query, Result<PaginationResult<${singularName}Dto>>>
{
    private readonly IApplicationDbContext _dbContext;${mappingFields(config)}

    public Search${pluralName}QueryHandler(IApplicationDbContext dbContext${mappingCtorParam(config)})
    {
        _dbContext = dbContext;${mappingCtorAssign(config)}
    }

    public async Task<Result<PaginationResult<${singularName}Dto>>> Handle(
        Search${pluralName}Query request,
        CancellationToken cancellationToken)
    {
        ${queryDecl} query = _dbContext.${pluralName}
            .AsNoTracking()${includeBlock};
${filterSection}${searchBlock}
        var descending = string.Equals(
            request.SortDirection,
            "desc",
            StringComparison.OrdinalIgnoreCase);

        var sortBy = request.SortBy?.Trim().ToLowerInvariant();
        query = sortBy switch
        {
${sortCases}
            "createdatutc" => descending
                ? query.OrderByDescending(entity => entity.CreatedAtUtc)
                : query.OrderBy(entity => entity.CreatedAtUtc),
            "updatedatutc" => descending
                ? query.OrderByDescending(entity => entity.UpdatedAtUtc)
                : query.OrderBy(entity => entity.UpdatedAtUtc),
            _ => query.OrderByDescending(entity => entity.CreatedAtUtc),
        };

        var totalCount = await query.CountAsync(cancellationToken);

        var pageItems = await query
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .ToListAsync(cancellationToken);

        var data = ${toDtoListCall(config, 'pageItems')};

        var result = PaginationResult<${singularName}Dto>.Create(
            data,
            totalCount,
            request.Page,
            request.PageSize);

        return Result.Success(result);
    }
}
`;
}

/**
 * @param {object} config
 */
export function renderSearchValidator(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;

  return `using FluentValidation;
using ${ns}.Application.Common.Models;

namespace ${ns}.Application.Features.${singularName}.Queries.Search;

public sealed class Search${pluralName}QueryValidator : AbstractValidator<Search${pluralName}Query>
{
    public Search${pluralName}QueryValidator()
    {
        RuleFor(request => request.Page)
            .GreaterThanOrEqualTo(1);

        RuleFor(request => request.PageSize)
            .InclusiveBetween(1, PaginationRequest.MaxPageSize);
    }
}
`;
}

/* ------------------------------------------------------------------ */
/* GetById                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {object} config
 */
export function renderGetByIdQuery(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;

  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;

namespace ${ns}.Application.Features.${singularName}.Queries.GetById;

public sealed record Get${singularName}ByIdQuery(Guid Id) : IRequest<Result<${singularName}Dto>>;
`;
}

/**
 * @param {object} config
 */
export function renderGetByIdHandler(config) {
  if (usesDapper(config.orm)) {
    return renderDapperGetByIdHandler(config);
  }
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);

  const includes = buildIncludes(groups);
  const includeBlock = includes.length > 0 ? `\n${includes.join('\n')}` : '';

  return `${mappingUsing(config)}using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;
using ${ns}.Domain.Entities;

namespace ${ns}.Application.Features.${singularName}.Queries.GetById;

public sealed class Get${singularName}ByIdQueryHandler
    : IRequestHandler<Get${singularName}ByIdQuery, Result<${singularName}Dto>>
{
    private readonly IApplicationDbContext _dbContext;${mappingFields(config)}

    public Get${singularName}ByIdQueryHandler(IApplicationDbContext dbContext${mappingCtorParam(config)})
    {
        _dbContext = dbContext;${mappingCtorAssign(config)}
    }

    public async Task<Result<${singularName}Dto>> Handle(
        Get${singularName}ByIdQuery request,
        CancellationToken cancellationToken)
    {
        var entity = await _dbContext.${pluralName}
            .AsNoTracking()${includeBlock}
            .FirstOrDefaultAsync(item => item.Id == request.Id, cancellationToken);

        if (entity is null)
        {
            return Result.Failure<${singularName}Dto>(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{request.Id}' was not found."));
        }

        return Result.Success(${toDtoCall(config, 'entity')});
    }
}
`;
}

/* ------------------------------------------------------------------ */
/* Command property helpers                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {ReturnType<typeof groupFields>} groups
 */
export function commandPropertyLines(groups) {
  /** @type {string[]} */
  const lines = [];

  for (const field of groups.scalar) {
    lines.push(fieldProperty(field));
  }

  for (const field of groups.enums) {
    lines.push(`    public ${toCSharpType(field)} ${field.name} { get; init; }`);
  }

  for (const field of groups.toOne) {
    const idType = field.nullable ? 'Guid?' : 'Guid';
    lines.push(`    public ${idType} ${field.foreignKeyName} { get; init; }`);
  }

  for (const field of groups.toMany) {
    lines.push(
      `    public IReadOnlyList<Guid> ${field.commandIdsName} { get; init; } = Array.Empty<Guid>();`,
    );
  }

  for (const field of groups.mediaSingle) {
    lines.push(`    public Guid? ${field.foreignKeyName} { get; init; }`);
  }

  for (const field of groups.mediaMultiple) {
    lines.push(
      `    public IReadOnlyList<Guid> ${field.commandIdsName} { get; init; } = Array.Empty<Guid>();`,
    );
  }

  return lines;
}

export function fkValidationBlocks(config, groups, dtoType) {
  /** @type {string[]} */
  const blocks = [];

  for (const field of groups.toOne) {
    const targetPlural = pluralizePascal(field.target);
    if (field.nullable) {
      blocks.push(`        if (request.${field.foreignKeyName}.HasValue)
        {
            var ${toCamelCase(field.name)}Exists = await _dbContext.${targetPlural}
                .AnyAsync(item => item.Id == request.${field.foreignKeyName}.Value, cancellationToken);
            if (!${toCamelCase(field.name)}Exists)
            {
                return Result.Failure<${dtoType}>(
                    Error.NotFound(
                        "${field.target}.NotFound",
                        $"${field.target} '{request.${field.foreignKeyName}}' was not found."));
            }
        }`);
    } else {
      blocks.push(`        var ${toCamelCase(field.name)}Exists = await _dbContext.${targetPlural}
            .AnyAsync(item => item.Id == request.${field.foreignKeyName}, cancellationToken);
        if (!${toCamelCase(field.name)}Exists)
        {
            return Result.Failure<${dtoType}>(
                Error.NotFound(
                    "${field.target}.NotFound",
                    $"${field.target} '{request.${field.foreignKeyName}}' was not found."));
        }`);
    }
  }

  if (groups.mediaSingle.length > 0) {
    for (const field of groups.mediaSingle) {
      blocks.push(`        if (request.${field.foreignKeyName}.HasValue)
        {
            var ${toCamelCase(field.name)}Exists = await _dbContext.Files
                .AnyAsync(item => item.Id == request.${field.foreignKeyName}.Value, cancellationToken);
            if (!${toCamelCase(field.name)}Exists)
            {
                return Result.Failure<${dtoType}>(
                    Error.NotFound(
                        "File.NotFound",
                        $"File '{request.${field.foreignKeyName}}' was not found."));
            }
        }`);
    }
  }

  return blocks;
}

export function collectionLoadBlocks(groups, dtoType) {
  /** @type {string[]} */
  const blocks = [];
  /** @type {{ field: object, varName: string, kind: string }[]} */
  const vars = [];

  for (const field of groups.toMany) {
    const varName = `${toCamelCase(field.collectionName)}Items`;
    const targetPlural = pluralizePascal(field.target);
    blocks.push(`        var ${varName} = await _dbContext.${targetPlural}
            .Where(item => request.${field.commandIdsName}.Contains(item.Id))
            .ToListAsync(cancellationToken);
        if (${varName}.Count != request.${field.commandIdsName}.Distinct().Count())
        {
            return Result.Failure<${dtoType}>(
                Error.NotFound(
                    "${field.target}.NotFound",
                    "One or more ${field.collectionName} were not found."));
        }`);
    vars.push({ field, varName, kind: 'relationship' });
  }

  for (const field of groups.mediaMultiple) {
    const varName = `${toCamelCase(field.collectionName)}Files`;
    blocks.push(`        var ${varName} = await _dbContext.Files
            .Where(item => request.${field.commandIdsName}.Contains(item.Id))
            .ToListAsync(cancellationToken);
        if (${varName}.Count != request.${field.commandIdsName}.Distinct().Count())
        {
            return Result.Failure<${dtoType}>(
                Error.NotFound(
                    "File.NotFound",
                    "One or more ${field.collectionName} files were not found."));
        }`);
    vars.push({ field, varName, kind: 'media' });
  }

  return { blocks, vars };
}

/* ------------------------------------------------------------------ */
/* Create                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {object} config
 */
export function renderCreateCommand(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);
  const props = commandPropertyLines(groups).join('\n\n');

  const usings = commonUsings(config);
  const usingBlock = usings.length > 0 ? `${usings.join('\n')}\n` : '';

  return `using MediatR;
${usingBlock}using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;

namespace ${ns}.Application.Features.${singularName}.Commands.Create;

public sealed record Create${singularName}Command : IRequest<Result<${singularName}Dto>>
{
${props}
}
`;
}

/**
 * @param {object} config
 */
export function renderCreateHandler(config) {
  if (isDapperOnly(config.orm)) {
    return renderDapperCreateHandler(config);
  }
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);
  const dtoType = `${singularName}Dto`;

  const fkBlocks = fkValidationBlocks(config, groups, dtoType);
  const { blocks: collectionBlocks, vars } = collectionLoadBlocks(groups, dtoType);

  /** @type {string[]} */
  const initializerLines = [];
  for (const field of [...groups.scalar, ...groups.enums]) {
    initializerLines.push(`            ${field.name} = request.${field.name},`);
  }
  for (const field of groups.toOne) {
    initializerLines.push(`            ${field.foreignKeyName} = request.${field.foreignKeyName},`);
  }
  for (const field of groups.mediaSingle) {
    initializerLines.push(`            ${field.foreignKeyName} = request.${field.foreignKeyName},`);
  }

  /** @type {string[]} */
  const collectionAssignments = [];
  for (const entry of vars) {
    const collectionName = entry.field.collectionName;
    collectionAssignments.push(`        entity.${collectionName} = ${entry.varName};`);
  }

  const validationSection = joinSections([
    fkBlocks.join('\n\n'),
    collectionBlocks.join('\n\n'),
  ]);

  const preamble = validationSection ? `${validationSection}\n\n` : '';
  const assignmentTail =
    collectionAssignments.length > 0
      ? `\n\n${collectionAssignments.join('\n')}`
      : '';

  return `${mappingUsing(config)}using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;
using ${ns}.Domain.Entities;

namespace ${ns}.Application.Features.${singularName}.Commands.Create;

public sealed class Create${singularName}CommandHandler
    : IRequestHandler<Create${singularName}Command, Result<${singularName}Dto>>
{
    private readonly IApplicationDbContext _dbContext;${mappingFields(config)}

    public Create${singularName}CommandHandler(IApplicationDbContext dbContext${mappingCtorParam(config)})
    {
        _dbContext = dbContext;${mappingCtorAssign(config)}
    }

    public async Task<Result<${singularName}Dto>> Handle(
        Create${singularName}Command request,
        CancellationToken cancellationToken)
    {
${preamble}        var entity = new ${entityClrName(config)}
        {
${initializerLines.join('\n')}
        };${assignmentTail}

        _dbContext.${pluralName}.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success(${toDtoCall(config, 'entity')});
    }
}
`;
}

/* ------------------------------------------------------------------ */
/* Update                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {object} config
 */
export function renderUpdateCommand(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);
  const props = commandPropertyLines(groups).join('\n\n');

  const usings = commonUsings(config);
  const usingBlock = usings.length > 0 ? `${usings.join('\n')}\n` : '';

  return `using MediatR;
${usingBlock}using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;

namespace ${ns}.Application.Features.${singularName}.Commands.Update;

public sealed record Update${singularName}Command : IRequest<Result<${singularName}Dto>>
{
    public Guid Id { get; init; }

    public string RowVersion { get; init; } = string.Empty;

${props}
}
`;
}

/**
 * @param {object} config
 */
export function renderUpdateHandler(config) {
  if (isDapperOnly(config.orm)) {
    return renderDapperUpdateHandler(config);
  }
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);
  const dtoType = `${singularName}Dto`;

  const includes = buildIncludes(groups);
  const includeBlock = includes.length > 0 ? `\n${includes.join('\n')}` : '';

  const fkBlocks = fkValidationBlocks(config, groups, dtoType);
  const { blocks: collectionBlocks, vars } = collectionLoadBlocks(groups, dtoType);

  /** @type {string[]} */
  const scalarAssignments = [];
  for (const field of [...groups.scalar, ...groups.enums]) {
    scalarAssignments.push(`        entity.${field.name} = request.${field.name};`);
  }
  for (const field of groups.toOne) {
    scalarAssignments.push(`        entity.${field.foreignKeyName} = request.${field.foreignKeyName};`);
  }
  for (const field of groups.mediaSingle) {
    scalarAssignments.push(`        entity.${field.foreignKeyName} = request.${field.foreignKeyName};`);
  }

  /** @type {string[]} */
  const syncBlocks = [];
  for (const entry of vars) {
    const collectionName = entry.field.collectionName;
    syncBlocks.push(`        entity.${collectionName}.Clear();
        foreach (var item in ${entry.varName})
        {
            entity.${collectionName}.Add(item);
        }`);
  }

  const validationSection = joinSections([
    fkBlocks.join('\n\n'),
    collectionBlocks.join('\n\n'),
  ]);
  const validationPreamble = validationSection ? `\n${validationSection}\n` : '';

  const assignmentSection = joinSections([
    scalarAssignments.join('\n'),
    syncBlocks.join('\n\n'),
  ]);

  return `${mappingUsing(config)}using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;

namespace ${ns}.Application.Features.${singularName}.Commands.Update;

public sealed class Update${singularName}CommandHandler
    : IRequestHandler<Update${singularName}Command, Result<${singularName}Dto>>
{
    private readonly IApplicationDbContext _dbContext;${mappingFields(config)}

    public Update${singularName}CommandHandler(IApplicationDbContext dbContext${mappingCtorParam(config)})
    {
        _dbContext = dbContext;${mappingCtorAssign(config)}
    }

    public async Task<Result<${singularName}Dto>> Handle(
        Update${singularName}Command request,
        CancellationToken cancellationToken)
    {
        var entity = await _dbContext.${pluralName}${includeBlock}
            .FirstOrDefaultAsync(item => item.Id == request.Id, cancellationToken);

        if (entity is null)
        {
            return Result.Failure<${singularName}Dto>(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{request.Id}' was not found."));
        }
${validationPreamble}
        var incomingRowVersion = Convert.FromBase64String(request.RowVersion);
        _dbContext.Entry(entity).Property(item => item.RowVersion).OriginalValue = incomingRowVersion;

${assignmentSection}

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Result.Failure<${singularName}Dto>(
                Error.Conflict(
                    "${singularName}.ConcurrencyConflict",
                    $"${singularName} '{request.Id}' was modified by another user."));
        }

        return Result.Success(${toDtoCall(config, 'entity')});
    }
}
`;
}

/* ------------------------------------------------------------------ */
/* Validators                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {object} field
 * @param {string} requestParam
 */
export function validationRulesForField(field, requestParam = 'command') {
  const rules = [];

  if (field.kind === 'enum') {
    if (field.required && !field.nullable) {
      rules.push(`        RuleFor(${requestParam} => ${requestParam}.${field.name})
            .IsInEnum();`);
    }
    return rules.join('\n\n');
  }

  if (field.kind === 'relationship') {
    if (field.relationshipType === 'many-to-one' || field.relationshipType === 'one-to-one') {
      if (field.required && !field.nullable) {
        rules.push(`        RuleFor(${requestParam} => ${requestParam}.${field.foreignKeyName})
            .NotEmpty();`);
      }
    }
    return rules.join('\n\n');
  }

  if (field.kind === 'file' || field.kind === 'image') {
    if (field.cardinality === 'single' && field.required && !field.nullable) {
      rules.push(`        RuleFor(${requestParam} => ${requestParam}.${field.foreignKeyName})
            .NotNull();`);
    }
    return rules.join('\n\n');
  }

  const access = `${requestParam} => ${requestParam}.${field.name}`;

  if (field.type === 'string') {
    if (field.required && !field.nullable) {
      rules.push(`        RuleFor(${access})
            .NotEmpty();`);
    }

    if (field.minLength != null) {
      rules.push(`        RuleFor(${access})
            .MinimumLength(${field.minLength})
            .When(${requestParam} => !string.IsNullOrEmpty(${requestParam}.${field.name}));`);
    }

    if (field.maxLength != null) {
      rules.push(`        RuleFor(${access})
            .MaximumLength(${field.maxLength})
            .When(${requestParam} => ${requestParam}.${field.name} is not null);`);
    }

    return rules.join('\n\n');
  }

  if (field.type === 'Guid' && field.required && !field.nullable) {
    return `        RuleFor(${access})
            .NotEmpty();`;
  }

  if (
    field.type === 'int' ||
    field.type === 'long' ||
    field.type === 'decimal' ||
    field.type === 'double'
  ) {
    if (field.minimum != null) {
      rules.push(`        RuleFor(${access})
            .GreaterThanOrEqualTo(${formatNumericLiteral(field, field.minimum)});`);
    }

    if (field.maximum != null) {
      rules.push(`        RuleFor(${access})
            .LessThanOrEqualTo(${formatNumericLiteral(field, field.maximum)});`);
    }

    return rules.join('\n\n');
  }

  return '';
}

/**
 * @param {object} field
 * @param {unknown} value
 */
function formatNumericLiteral(field, value) {
  if (field.type === 'decimal') {
    return `${value}m`;
  }

  if (field.type === 'double') {
    return `${value}d`;
  }

  if (field.type === 'long') {
    return `${value}L`;
  }

  return String(value);
}

/**
 * @param {object} config
 */
export function renderFieldValidators(config) {
  return config.fields
    .map((field) => validationRulesForField(field))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * @param {object} config
 */
export function renderCreateValidator(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const rules = renderFieldValidators(config);
  const rulesBlock = rules ? `\n${rules}\n` : '\n';

  return `using FluentValidation;

namespace ${ns}.Application.Features.${singularName}.Commands.Create;

public sealed class Create${singularName}CommandValidator : AbstractValidator<Create${singularName}Command>
{
    public Create${singularName}CommandValidator()
    {${rulesBlock}    }
}
`;
}

/**
 * @param {object} config
 */
export function renderUpdateValidator(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const rules = renderFieldValidators(config);
  const rulesBlock = rules ? `\n\n${rules}` : '';

  return `using FluentValidation;

namespace ${ns}.Application.Features.${singularName}.Commands.Update;

public sealed class Update${singularName}CommandValidator : AbstractValidator<Update${singularName}Command>
{
    public Update${singularName}CommandValidator()
    {
        RuleFor(command => command.Id)
            .NotEmpty();

        RuleFor(command => command.RowVersion)
            .NotEmpty();${rulesBlock}
    }
}
`;
}

/* ------------------------------------------------------------------ */
/* Delete / Restore                                                   */
/* ------------------------------------------------------------------ */

/**
 * @param {object} config
 */
export function renderDeleteCommand(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;

  return `using MediatR;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.${singularName}.Commands.Delete;

public sealed record Delete${singularName}Command(Guid Id) : IRequest<Result>;
`;
}

/**
 * @param {object} config
 */
export function renderDeleteHandler(config) {
  if (isDapperOnly(config.orm)) {
    return renderDapperDeleteHandler(config);
  }
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;

  return `using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.${singularName}.Commands.Delete;

public sealed class Delete${singularName}CommandHandler
    : IRequestHandler<Delete${singularName}Command, Result>
{
    private readonly IApplicationDbContext _dbContext;

    public Delete${singularName}CommandHandler(IApplicationDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<Result> Handle(
        Delete${singularName}Command request,
        CancellationToken cancellationToken)
    {
        var entity = await _dbContext.${pluralName}
            .FirstOrDefaultAsync(item => item.Id == request.Id, cancellationToken);

        if (entity is null)
        {
            return Result.Failure(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{request.Id}' was not found."));
        }

        entity.IsDeleted = true;
        entity.DeletedAtUtc = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }
}
`;
}

/**
 * @param {object} config
 */
export function renderRestoreCommand(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;

  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;

namespace ${ns}.Application.Features.${singularName}.Commands.Restore;

public sealed record Restore${singularName}Command(Guid Id) : IRequest<Result<${singularName}Dto>>;
`;
}

/**
 * @param {object} config
 */
export function renderRestoreHandler(config) {
  if (isDapperOnly(config.orm)) {
    return renderDapperRestoreHandler(config);
  }
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;

  return `${mappingUsing(config)}using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.${singularName}.DTOs;
using ${ns}.Application.Features.${singularName}.Mapping;

namespace ${ns}.Application.Features.${singularName}.Commands.Restore;

public sealed class Restore${singularName}CommandHandler
    : IRequestHandler<Restore${singularName}Command, Result<${singularName}Dto>>
{
    private readonly IApplicationDbContext _dbContext;${mappingFields(config)}

    public Restore${singularName}CommandHandler(IApplicationDbContext dbContext${mappingCtorParam(config)})
    {
        _dbContext = dbContext;${mappingCtorAssign(config)}
    }

    public async Task<Result<${singularName}Dto>> Handle(
        Restore${singularName}Command request,
        CancellationToken cancellationToken)
    {
        var entity = await _dbContext.${pluralName}
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                item => item.Id == request.Id && item.IsDeleted,
                cancellationToken);

        if (entity is null)
        {
            return Result.Failure<${singularName}Dto>(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"Deleted ${singularName} '{request.Id}' was not found."));
        }

        entity.IsDeleted = false;
        entity.DeletedAtUtc = null;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success(${toDtoCall(config, 'entity')});
    }
}
`;
}

/**
 * Join non-empty sections with a blank line between them.
 * @param {string[]} sections
 */
export function joinSections(sections) {
  return sections.filter((section) => section && section.trim()).join('\n\n');
}
