import {
  applicationDiPath,
  applicationModuleBase,
  entityClrName,
  upsertApplicationServiceRegistration,
} from './clean-architecture.js';
import { canBeLookupTarget, lookupDisplayMember, renderLookupItemDto } from './lookup.generator.js';
import { getBackendFilePath } from '../../utils/project-paths.js';
import {
  dapperReadRepositoryName,
  isDapperOnly,
  usesDapper,
  usesEfCore,
} from './architecture.js';
import { isAutoMapper } from '../feature-profile.js';
import { groupFields } from '../fields/field-mappers.js';
import { pluralizePascal, toCamelCase } from '../utils/feature-naming.js';
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
  buildIncludes,
  collectionLoadBlocks,
  commandPropertyLines,
  commonUsings,
  fkValidationBlocks,
  joinSections,
  renderDto,
  renderFieldValidators,
  renderMappings,
  usesEnums,
  usesLookupModels,
} from './application.generator.js';

/**
 * Plan Application-layer files for architecture = "services".
 * Scaffolds under Application/Modules/{PluralName}/
 *
 * @param {object} config
 */
export function planServiceApplicationFiles(config) {
  const { pluralName, singularName } = config.feature;
  const ops = config.operations;
  const base = (...segments) => applicationModuleBase(config, ...segments);

  /** @type {{ relativePath: string, contents: string, writeMode?: string }[]} */
  const files = [
    {
      relativePath: base('DTOs', `${singularName}Dto.cs`),
      contents: renderDto(config),
    },
    {
      relativePath: base('DTOs', `Create${singularName}Dto.cs`),
      contents: renderServiceCreateDto(config),
    },
    {
      relativePath: base('DTOs', `Update${singularName}Dto.cs`),
      contents: renderServiceUpdateDto(config),
    },
    {
      relativePath: base('Validators', `Create${singularName}Validator.cs`),
      contents: renderServiceCreateValidator(config),
    },
    {
      relativePath: base('Validators', `Update${singularName}Validator.cs`),
      contents: renderServiceUpdateValidator(config),
    },
    {
      relativePath: base(
        'Mapping',
        isAutoMapper(config) ? `${singularName}MappingProfile.cs` : `${singularName}Mappings.cs`,
      ),
      contents: isAutoMapper(config) ? renderAutoMapperProfile(config) : renderMappings(config),
    },
    {
      relativePath: base('Interfaces', `I${singularName}Service.cs`),
      contents: renderServiceInterface(config),
    },
    {
      relativePath: base('Services', `${singularName}Service.cs`),
      contents: renderServiceImplementation(config),
    },
  ];

  if (ops.search) {
    files.push(
      {
        relativePath: base('DTOs', `Search${pluralName}Dto.cs`),
        contents: renderServiceSearchDto(config),
      },
      {
        relativePath: base('Validators', `Search${pluralName}Validator.cs`),
        contents: renderServiceSearchValidator(config),
      },
    );
  }

  if (canBeLookupTarget(config) || usesLookupModels(config.fields)) {
    files.push({
      relativePath: getBackendFilePath(
        config,
        'Application',
        'Common',
        'Models',
        'LookupItemDto.cs',
      ),
      contents: renderLookupItemDto(config),
      writeMode: 'ifMissing',
    });
  }

  return files;
}

/**
 * Registry update that registers I{Singular}Service in Application DI.
 * @param {object} config
 */
export function planApplicationServiceRegistry(config) {
  const { pluralName, singularName } = config.feature;
  return {
    relativePath: applicationDiPath(config),
    update: (existing) =>
      upsertApplicationServiceRegistration(existing, config.projectName, singularName, pluralName, config.mapping),
  };
}

/**
 * @param {object} config
 */
export function renderServiceCreateDto(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);
  const props = commandPropertyLines(groups).join('\n\n');

  const usings = commonUsings(config);
  const usingBlock = usings.length > 0 ? `${usings.join('\n')}\n` : '';

  return `${usingBlock}namespace ${ns}.Application.Modules.${pluralName}.DTOs;

public sealed record Create${singularName}Dto
{
${props}
}
`;
}

/**
 * @param {object} config
 */
export function renderServiceUpdateDto(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);
  const props = commandPropertyLines(groups).join('\n\n');

  const usings = commonUsings(config);
  const usingBlock = usings.length > 0 ? `${usings.join('\n')}\n` : '';

  return `${usingBlock}namespace ${ns}.Application.Modules.${pluralName}.DTOs;

public sealed record Update${singularName}Dto
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
export function renderServiceSearchDto(config) {
  const { pluralName } = config.feature;
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

  return `${usings}using ${ns}.Application.Common.Models;

namespace ${ns}.Application.Modules.${pluralName}.DTOs;

public sealed class Search${pluralName}Dto : SearchRequest
{${filterBlock}}
`;
}

/**
 * @param {object} config
 */
export function renderServiceCreateValidator(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const rules = renderFieldValidators(config);
  const rulesBlock = rules ? `\n${rules}\n` : '\n';

  return `using FluentValidation;
using ${ns}.Application.Modules.${pluralName}.DTOs;

namespace ${ns}.Application.Modules.${pluralName}.Validators;

public sealed class Create${singularName}Validator : AbstractValidator<Create${singularName}Dto>
{
    public Create${singularName}Validator()
    {${rulesBlock}    }
}
`;
}

/**
 * @param {object} config
 */
export function renderServiceUpdateValidator(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const rules = renderFieldValidators(config);
  const rulesBlock = rules ? `\n\n${rules}` : '';

  return `using FluentValidation;
using ${ns}.Application.Modules.${pluralName}.DTOs;

namespace ${ns}.Application.Modules.${pluralName}.Validators;

public sealed class Update${singularName}Validator : AbstractValidator<Update${singularName}Dto>
{
    public Update${singularName}Validator()
    {
        RuleFor(dto => dto.Id)
            .NotEmpty();

        RuleFor(dto => dto.RowVersion)
            .NotEmpty();${rulesBlock}
    }
}
`;
}

/**
 * @param {object} config
 */
export function renderServiceSearchValidator(config) {
  const { pluralName } = config.feature;
  const ns = config.projectName;

  return `using FluentValidation;
using ${ns}.Application.Common.Models;
using ${ns}.Application.Modules.${pluralName}.DTOs;

namespace ${ns}.Application.Modules.${pluralName}.Validators;

public sealed class Search${pluralName}Validator : AbstractValidator<Search${pluralName}Dto>
{
    public Search${pluralName}Validator()
    {
        RuleFor(request => request.Page)
            .GreaterThanOrEqualTo(1);

        RuleFor(request => request.PageSize)
            .InclusiveBetween(1, PaginationRequest.MaxPageSize);
    }
}
`;
}

/**
 * @param {object} config
 */
export function renderServiceInterface(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const ops = config.operations;
  const methods = [];

  if (ops.search) {
    methods.push(
      `    Task<Result<PaginationResult<${singularName}Dto>>> SearchAsync(Search${pluralName}Dto request, CancellationToken cancellationToken = default);`,
    );
  }
  if (canBeLookupTarget(config)) {
    methods.push(
      `    Task<Result<IReadOnlyList<LookupItemDto>>> LookupAsync(string? search, int take, CancellationToken cancellationToken = default);`,
    );
  }
  if (ops.getById) {
    methods.push(
      `    Task<Result<${singularName}Dto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);`,
    );
  }
  if (ops.create) {
    methods.push(
      `    Task<Result<${singularName}Dto>> CreateAsync(Create${singularName}Dto request, CancellationToken cancellationToken = default);`,
    );
  }
  if (ops.update) {
    methods.push(
      `    Task<Result<${singularName}Dto>> UpdateAsync(Guid id, Update${singularName}Dto request, CancellationToken cancellationToken = default);`,
    );
  }
  if (ops.delete) {
    methods.push(
      `    Task<Result> DeleteAsync(Guid id, CancellationToken cancellationToken = default);`,
    );
  }
  if (ops.restore) {
    methods.push(
      `    Task<Result<${singularName}Dto>> RestoreAsync(Guid id, CancellationToken cancellationToken = default);`,
    );
  }

  const usings = [
    `using ${ns}.Application.Common.Results;`,
    `using ${ns}.Application.Modules.${pluralName}.DTOs;`,
  ];
  if (ops.search || canBeLookupTarget(config)) {
    usings.push(`using ${ns}.Application.Common.Models;`);
  }

  return `${[...new Set(usings)].join('\n')}

namespace ${ns}.Application.Modules.${pluralName}.Interfaces;

public interface I${singularName}Service
{
${methods.join('\n')}
}
`;
}

/**
 * @param {object} config
 */
export function renderServiceImplementation(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const ops = config.operations;
  const groups = groupFields(config.fields);
  const dtoType = `${singularName}Dto`;
  const isDapper = isDapperOnly(config.orm);
  const repo = dapperReadRepositoryName(config);

  const includes = buildIncludes(groups);
  const includeBlock = includes.length > 0 ? `\n${includes.join('\n')}` : '';
  const queryDecl = includes.length > 0 ? `IQueryable<${entityClrName(config)}>` : 'var';

  const fkBlocks = fkValidationBlocks(config, groups, dtoType);
  const { blocks: collectionBlocks, vars } = collectionLoadBlocks(groups, dtoType);

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

  const collectionAssignments = [];
  for (const entry of vars) {
    collectionAssignments.push(`        entity.${entry.field.collectionName} = ${entry.varName};`);
  }

  const createPreamble = joinSections([
    fkBlocks.join('\n\n'),
    collectionBlocks.join('\n\n'),
  ]);
  const createPreambleBlock = createPreamble ? `${createPreamble}\n\n` : '';
  const createTail =
    collectionAssignments.length > 0
      ? `\n\n${collectionAssignments.join('\n')}`
      : '';

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

  const syncBlocks = [];
  for (const entry of vars) {
    syncBlocks.push(`        entity.${entry.field.collectionName}.Clear();
        foreach (var item in ${entry.varName})
        {
            entity.${entry.field.collectionName}.Add(item);
        }`);
  }

  const updateValidation = joinSections([
    fkBlocks.join('\n\n'),
    collectionBlocks.join('\n\n'),
  ]);
  const updateValidationBlock = updateValidation ? `\n${updateValidation}\n` : '';
  const updateAssignmentSection = joinSections([
    scalarAssignments.join('\n'),
    syncBlocks.join('\n\n'),
  ]);

  // Search helpers
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

  const searchable = groups.scalar.filter((field) => field.type === 'string' && field.searchable);
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

  const filterSection = filterBlocks.length > 0 ? `\n${filterBlocks.join('\n\n')}\n` : '';

  /** @type {string[]} */
  const methods = [];

  if (ops.search) {
    if (isDapper) {
      methods.push(`    public async Task<Result<PaginationResult<${singularName}Dto>>> SearchAsync(
        Search${pluralName}Dto request,
        CancellationToken cancellationToken = default)
    {
        await ValidateAsync(request, cancellationToken);
        var (items, totalCount) = await _repository.SearchAsync(request, cancellationToken);
        var data = ${toDtoListCall(config, 'items')};
        var result = PaginationResult<${singularName}Dto>.Create(
            data,
            totalCount,
            request.Page,
            request.PageSize);
        return Result.Success(result);
    }`);
    } else {
      methods.push(`    public async Task<Result<PaginationResult<${singularName}Dto>>> SearchAsync(
        Search${pluralName}Dto request,
        CancellationToken cancellationToken = default)
    {
        await ValidateAsync(request, cancellationToken);

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
    }`);
    }
  }

  if (canBeLookupTarget(config)) {
    const display = lookupDisplayMember(config);
    if (isDapper) {
      methods.push(`    public async Task<Result<IReadOnlyList<LookupItemDto>>> LookupAsync(
        string? search,
        int take,
        CancellationToken cancellationToken = default)
    {
        var items = await _repository.LookupAsync(search, take, cancellationToken);
        return Result.Success(items);
    }`);
    } else {
      methods.push(`    public async Task<Result<IReadOnlyList<LookupItemDto>>> LookupAsync(
        string? search,
        int take,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.${pluralName}.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(item => EF.Functions.Like(item.${display}, pattern));
        }

        var limit = take <= 0 ? 50 : Math.Min(take, 100);
        var items = await query
            .OrderBy(item => item.${display})
            .Take(limit)
            .Select(item => new LookupItemDto
            {
                Id = item.Id,
                DisplayName = item.${display} ?? string.Empty,
            })
            .ToListAsync(cancellationToken);

        return Result.Success<IReadOnlyList<LookupItemDto>>(items);
    }`);
    }
  }

  if (ops.getById) {
    if (isDapper) {
      methods.push(`    public async Task<Result<${singularName}Dto>> GetByIdAsync(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var entity = await _repository.GetByIdAsync(id, cancellationToken);
        if (entity is null)
        {
            return Result.Failure<${singularName}Dto>(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{id}' was not found."));
        }

        return Result.Success(${toDtoCall(config, 'entity')});
    }`);
    } else {
      methods.push(`    public async Task<Result<${singularName}Dto>> GetByIdAsync(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var entity = await _dbContext.${pluralName}
            .AsNoTracking()${includeBlock}
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (entity is null)
        {
            return Result.Failure<${singularName}Dto>(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{id}' was not found."));
        }

        return Result.Success(${toDtoCall(config, 'entity')});
    }`);
    }
  }

  if (ops.create) {
    if (isDapper) {
      methods.push(`    public async Task<Result<${singularName}Dto>> CreateAsync(
        Create${singularName}Dto request,
        CancellationToken cancellationToken = default)
    {
        await ValidateAsync(request, cancellationToken);
        var entity = new ${entityClrName(config)}
        {
${initializerLines.join('\n')}
        };

        await _repository.InsertAsync(entity, cancellationToken);
        return Result.Success(${toDtoCall(config, 'entity')});
    }`);
    } else {
      methods.push(`    public async Task<Result<${singularName}Dto>> CreateAsync(
        Create${singularName}Dto request,
        CancellationToken cancellationToken = default)
    {
        await ValidateAsync(request, cancellationToken);
${createPreambleBlock}        var entity = new ${entityClrName(config)}
        {
${initializerLines.join('\n')}
        };${createTail}

        _dbContext.${pluralName}.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success(${toDtoCall(config, 'entity')});
    }`);
    }
  }

  if (ops.update) {
    if (isDapper) {
      methods.push(`    public async Task<Result<${singularName}Dto>> UpdateAsync(
        Guid id,
        Update${singularName}Dto request,
        CancellationToken cancellationToken = default)
    {
        request = request with { Id = id };
        await ValidateAsync(request, cancellationToken);

        var entity = await _repository.GetByIdAsync(id, cancellationToken);
        if (entity is null)
        {
            return Result.Failure<${singularName}Dto>(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{id}' was not found."));
        }

${updateAssignmentSection}

        await _repository.UpdateAsync(entity, cancellationToken);
        return Result.Success(${toDtoCall(config, 'entity')});
    }`);
    } else {
      methods.push(`    public async Task<Result<${singularName}Dto>> UpdateAsync(
        Guid id,
        Update${singularName}Dto request,
        CancellationToken cancellationToken = default)
    {
        request = request with { Id = id };
        await ValidateAsync(request, cancellationToken);

        var entity = await _dbContext.${pluralName}${includeBlock}
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (entity is null)
        {
            return Result.Failure<${singularName}Dto>(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{id}' was not found."));
        }
${updateValidationBlock}
        if (!string.IsNullOrEmpty(request.RowVersion))
        {
            var incomingRowVersion = Convert.FromBase64String(request.RowVersion);
            _dbContext.Entry(entity).Property(item => item.RowVersion).OriginalValue = incomingRowVersion;
        }

${updateAssignmentSection}

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success(${toDtoCall(config, 'entity')});
    }`);
    }
  }

  if (ops.delete) {
    if (isDapper) {
      methods.push(`    public async Task<Result> DeleteAsync(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var entity = await _repository.GetByIdAsync(id, cancellationToken);
        if (entity is null)
        {
            return Result.Failure(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{id}' was not found."));
        }

        await _repository.SoftDeleteAsync(id, cancellationToken);
        return Result.Success();
    }`);
    } else {
      methods.push(`    public async Task<Result> DeleteAsync(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var entity = await _dbContext.${pluralName}
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (entity is null)
        {
            return Result.Failure(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{id}' was not found."));
        }

        _dbContext.${pluralName}.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }`);
    }
  }

  if (ops.restore) {
    if (isDapper) {
      methods.push(`    public async Task<Result<${singularName}Dto>> RestoreAsync(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var entity = await _repository.GetDeletedByIdAsync(id, cancellationToken);
        if (entity is null)
        {
            return Result.Failure<${singularName}Dto>(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{id}' was not found."));
        }

        await _repository.RestoreAsync(id, cancellationToken);
        return Result.Success(${toDtoCall(config, 'entity')});
    }`);
    } else {
      methods.push(`    public async Task<Result<${singularName}Dto>> RestoreAsync(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var entity = await _dbContext.${pluralName}
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (entity is null)
        {
            return Result.Failure<${singularName}Dto>(
                Error.NotFound(
                    "${singularName}.NotFound",
                    $"${singularName} '{id}' was not found."));
        }

        entity.IsDeleted = false;
        entity.DeletedAtUtc = null;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success(${toDtoCall(config, 'entity')});
    }`);
    }
  }

  const persistLines = [];
  const persistParams = [];
  const persistAssigns = [];

  if (usesEfCore(config.orm) || !usesDapper(config.orm)) {
    persistLines.push('    private readonly IApplicationDbContext _dbContext;');
    persistParams.push('IApplicationDbContext dbContext');
    persistAssigns.push('        _dbContext = dbContext;');
  }
  if (usesDapper(config.orm)) {
    persistLines.push(`    private readonly ${repo} _repository;`);
    persistParams.push(`${repo} repository`);
    persistAssigns.push('        _repository = repository;');
  }
  if (isAutoMapper(config)) {
    persistLines.push('    private readonly IMapper _mapper;');
    persistParams.push('IMapper mapper');
    persistAssigns.push('        _mapper = mapper;');
  }

  const usings = [
    'using FluentValidation;',
    'using Microsoft.Extensions.DependencyInjection;',
    `using ${ns}.Application.Abstractions.Persistence;`,
    `using ${ns}.Application.Common.Exceptions;`,
    `using ${ns}.Application.Common.Models;`,
    `using ${ns}.Application.Common.Results;`,
    `using ${ns}.Application.Modules.${pluralName}.DTOs;`,
    `using ${ns}.Application.Modules.${pluralName}.Interfaces;`,
    `using ${ns}.Application.Modules.${pluralName}.Mapping;`,
    `using ${ns}.Domain.Entities;`,
  ];
  if (usesEfCore(config.orm) || !usesDapper(config.orm)) {
    usings.push('using Microsoft.EntityFrameworkCore;');
  }
  if (isAutoMapper(config)) {
    usings.push('using AutoMapper;');
  }
  if (usesEnums(config)) {
    usings.push(`using ${ns}.Domain.Enums;`);
  }

  return `${[...new Set(usings)].sort().join('\n')}

namespace ${ns}.Application.Modules.${pluralName}.Services;

public sealed class ${singularName}Service : I${singularName}Service
{
${persistLines.join('\n')}
    private readonly IServiceProvider _services;

    public ${singularName}Service(${persistParams.join(', ')}, IServiceProvider services)
    {
${persistAssigns.join('\n')}
        _services = services;
    }

    private async Task ValidateAsync<T>(T instance, CancellationToken cancellationToken)
    {
        var validator = _services.GetService<IValidator<T>>();
        if (validator is null)
        {
            return;
        }

        var result = await validator.ValidateAsync(instance, cancellationToken);
        if (!result.IsValid)
        {
            var errors = result.Errors
                .GroupBy(failure => failure.PropertyName)
                .ToDictionary(
                    group => group.Key,
                    group => group.Select(failure => failure.ErrorMessage).ToArray());
            throw new ApplicationValidationException(errors);
        }
    }

${methods.join('\n\n')}
}
`;
}

/**
 * @param {string} existing
 * @param {string} ns
 * @param {string} pluralName
 * @param {string} [featureName]
 */
export function upsertServiceRegistration(existing, ns, pluralName, featureName = pluralName) {
  return upsertApplicationServiceRegistration(existing, ns, featureName, pluralName);
}
