import { getBackendFilePath } from '../../utils/project-paths.js';
import { groupFields } from '../fields/field-mappers.js';
import { canBeLookupTarget, lookupDisplayMember } from './lookup.generator.js';
import {
  dapperReadRepositoryClassName,
  dapperReadRepositoryName,
  isDapperOnly,
  isServicesArchitecture,
} from './architecture.js';
import {
  infrastructureDiPath,
  upsertInfrastructureRegistration as upsertInfraRegistrations,
} from './clean-architecture.js';

/**
 * Plan Dapper repository files for orm = "dapper".
 * @param {object} config
 */
export function planDapperPersistenceFiles(config) {
  const interfaceName = dapperReadRepositoryName(config);
  const className = dapperReadRepositoryClassName(config);

  return [
    {
      relativePath: getBackendFilePath(
        config,
        'Application',
        'Abstractions',
        'Persistence',
        `${interfaceName}.cs`,
      ),
      contents: renderRepositoryInterface(config),
    },
    {
      relativePath: getBackendFilePath(
        config,
        'Infrastructure',
        'Persistence',
        'Repositories',
        `${className}.cs`,
      ),
      contents: renderRepositoryImplementation(config),
    },
  ];
}

/**
 * @param {object} config
 */
export function planDapperRepositoryRegistry(config) {
  const ns = config.projectName;
  const interfaceName = dapperReadRepositoryName(config);
  const className = dapperReadRepositoryClassName(config);
  return {
    relativePath: infrastructureDiPath(config),
    update: (existing) =>
      upsertInfrastructureRegistration(
        existing,
        ns,
        `using ${ns}.Application.Abstractions.Persistence;`,
        `using ${ns}.Infrastructure.Persistence.Repositories;`,
        `        services.AddScoped<${interfaceName}, ${className}>();`,
      ),
  };
}

/**
 * @param {string} existing
 * @param {string} ns
 * @param {string} usingA
 * @param {string} usingB
 * @param {string} registration
 */
export function upsertInfrastructureRegistration(existing, ns, usingA, usingB, registration) {
  return upsertInfraRegistrations(existing, ns, [usingA, usingB], registration);
}

/**
 * @param {object} config
 */
function renderRepositoryInterface(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const ops = config.operations;
  const queriesOnly = !isDapperOnly(config.orm);
  const interfaceName = dapperReadRepositoryName(config);
  const isServices = isServicesArchitecture(config.architecture);
  const searchQueryType = isServices ? `Search${pluralName}Dto` : `Search${pluralName}Query`;
  const methods = [];

  if (ops.search) {
    methods.push(
      `    Task<(IReadOnlyList<${singularName}> Items, int TotalCount)> SearchAsync(${searchQueryType} query, CancellationToken cancellationToken);`,
    );
  }
  if (canBeLookupTarget(config)) {
    if (isServices) {
      methods.push(
        '    Task<IReadOnlyList<LookupItemDto>> LookupAsync(string? search, int take, CancellationToken cancellationToken);',
      );
    } else {
      methods.push(
        `    Task<IReadOnlyList<LookupItemDto>> LookupAsync(Lookup${pluralName}Query query, CancellationToken cancellationToken);`,
      );
    }
  }
  if (ops.getById || (!queriesOnly && (ops.update || ops.delete))) {
    methods.push(
      `    Task<${singularName}?> GetByIdAsync(Guid id, CancellationToken cancellationToken);`,
    );
  }
  if (!queriesOnly && ops.restore) {
    methods.push(
      `    Task<${singularName}?> GetDeletedByIdAsync(Guid id, CancellationToken cancellationToken);`,
    );
  }
  if (!queriesOnly && ops.create) {
    methods.push(`    Task InsertAsync(${singularName} entity, CancellationToken cancellationToken);`);
  }
  if (!queriesOnly && ops.update) {
    methods.push(`    Task UpdateAsync(${singularName} entity, CancellationToken cancellationToken);`);
  }
  if (!queriesOnly && ops.delete) {
    methods.push(`    Task SoftDeleteAsync(Guid id, CancellationToken cancellationToken);`);
  }
  if (!queriesOnly && ops.restore) {
    methods.push(`    Task RestoreAsync(Guid id, CancellationToken cancellationToken);`);
  }

  const usings = [
    `using ${ns}.Domain.Entities;`,
  ];
  if (ops.search) {
    if (isServices) {
      usings.push(`using ${ns}.Application.Modules.${pluralName}.DTOs;`);
    } else {
      usings.push(`using ${ns}.Application.Features.${pluralName}.Search;`);
    }
  }
  if (canBeLookupTarget(config)) {
    usings.push(`using ${ns}.Application.Common.Models;`);
    if (!isServices) {
      usings.push(`using ${ns}.Application.Features.${pluralName}.Lookup;`);
    }
  }

  return `${[...new Set(usings)].join('\n')}

namespace ${ns}.Application.Abstractions.Persistence;

public interface ${interfaceName}
{
${methods.join('\n')}
}
`;
}

/**
 * @param {object} config
 */
function renderRepositoryImplementation(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const ops = config.operations;
  const queriesOnly = !isDapperOnly(config.orm);
  const interfaceName = dapperReadRepositoryName(config);
  const className = dapperReadRepositoryClassName(config);
  const database = config.database ?? 'sqlserver';
  const groups = groupFields(config.fields);
  const table = quoteIdent(database, pluralName);
  const display = lookupDisplayMember(config);
  const isServices = isServicesArchitecture(config.architecture);

  const usings = [
    'using System.Data;',
    'using Dapper;',
    `using ${ns}.Application.Abstractions.Persistence;`,
    `using ${ns}.Domain.Entities;`,
  ];
  if (ops.search) {
    if (isServices) {
      usings.push(`using ${ns}.Application.Modules.${pluralName}.DTOs;`);
    } else {
      usings.push(`using ${ns}.Application.Features.${pluralName}.Search;`);
    }
  }
  if (canBeLookupTarget(config)) {
    usings.push(`using ${ns}.Application.Common.Models;`);
    if (!isServices) {
      usings.push(`using ${ns}.Application.Features.${pluralName}.Lookup;`);
    }
  }

  const methods = [];
  if (ops.search) {
    methods.push(renderSearchMethod(config, groups, table, database));
  }
  if (canBeLookupTarget(config) && display) {
    methods.push(renderLookupMethod(config, table, database, display));
  }
  if (ops.getById || (!queriesOnly && (ops.update || ops.delete))) {
    methods.push(renderGetByIdMethod(singularName, table, database, false));
  }
  if (!queriesOnly && ops.restore) {
    methods.push(renderGetByIdMethod(singularName, table, database, true));
  }
  if (!queriesOnly && ops.create) {
    methods.push(renderInsertMethod(config, groups, table, database));
  }
  if (!queriesOnly && ops.update) {
    methods.push(renderUpdateMethod(config, groups, table, database));
  }
  if (!queriesOnly && ops.delete) {
    methods.push(renderSoftDeleteMethod(table, database));
  }
  if (!queriesOnly && ops.restore) {
    methods.push(renderRestoreMethod(table, database));
  }

  return `${[...new Set(usings)].join('\n')}

namespace ${ns}.Infrastructure.Persistence.Repositories;

public sealed class ${className} : ${interfaceName}
{
    private readonly IDbConnectionFactory _connections;

    public ${className}(IDbConnectionFactory connections)
    {
        _connections = connections;
    }

${methods.join('\n\n')}
}
`;
}

function quoteIdent(database, name) {
  return database === 'sqlserver' ? `[${name}]` : `"${name}"`;
}

function sqlFalse(database) {
  return database === 'postgresql' ? 'FALSE' : '0';
}

function sqlTrue(database) {
  return database === 'postgresql' ? 'TRUE' : '1';
}

function sqlLike(database) {
  return database === 'postgresql' ? 'ILIKE' : 'LIKE';
}

function sqlPaging(database) {
  return database === 'sqlserver'
    ? 'OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY'
    : 'LIMIT @PageSize OFFSET @Offset';
}

function columnList(database, groups) {
  const names = [
    'Id',
    'CreatedAtUtc',
    'UpdatedAtUtc',
    'IsDeleted',
    'DeletedAtUtc',
    ...groups.scalar.map((field) => field.name),
    ...groups.enums.map((field) => field.name),
    ...groups.toOne.map((field) => field.foreignKeyName),
    ...groups.mediaSingle.map((field) => field.foreignKeyName),
  ];
  return names.map((name) => quoteIdent(database, name)).join(', ');
}

function renderSearchMethod(config, groups, table, database) {
  const { singularName } = config.feature;
  const like = sqlLike(database);
  const searchFields = groups.scalar.filter((field) => field.type === 'string' && field.searchable);

  const filterLines = [];
  for (const field of groups.toOne) {
    filterLines.push(`        if (query.${field.foreignKeyName}.HasValue)
        {
            filters.Add("${quoteIdent(database, field.foreignKeyName)} = @${field.foreignKeyName}");
            parameters.Add("${field.foreignKeyName}", query.${field.foreignKeyName});
        }`);
  }
  for (const field of groups.enums) {
    filterLines.push(`        if (query.${field.name}.HasValue)
        {
            filters.Add("${quoteIdent(database, field.name)} = @${field.name}");
            parameters.Add("${field.name}", query.${field.name});
        }`);
  }

  const searchPredicates = searchFields
    .map((field) => `${quoteIdent(database, field.name)} ${like} @SearchTerm`)
    .join(' OR ');

  const searchBlock = searchPredicates
    ? `
        if (!string.IsNullOrWhiteSpace(query.SearchTerm))
        {
            filters.Add("(${searchPredicates})");
            parameters.Add("SearchTerm", $"%{query.SearchTerm.Trim()}%");
        }`
    : '';

  const sortCases = [...groups.scalar, ...groups.enums]
    .map((field) => `            "${String(field.name).toLowerCase()}" => "${quoteIdent(database, field.name)}",`)
    .join('\n');

  const isServices = isServicesArchitecture(config.architecture);
  const queryType = isServices
    ? `Search${config.feature.pluralName}Dto`
    : `Search${config.feature.pluralName}Query`;

  return `    public async Task<(IReadOnlyList<${singularName}> Items, int TotalCount)> SearchAsync(${queryType} query, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var connection = _connections.CreateConnection();
        var filters = new List<string> { "${quoteIdent(database, 'IsDeleted')} = ${sqlFalse(database)}" };
        var parameters = new DynamicParameters();
${filterLines.join('\n')}${searchBlock}

        var where = string.Join(" AND ", filters);
        var sortColumn = query.SortBy?.Trim().ToLowerInvariant() switch
        {
${sortCases}
            "createdatutc" => "${quoteIdent(database, 'CreatedAtUtc')}",
            "updatedatutc" => "${quoteIdent(database, 'UpdatedAtUtc')}",
            _ => "${quoteIdent(database, 'CreatedAtUtc')}",
        };
        var direction = string.Equals(query.SortDirection, "desc", StringComparison.OrdinalIgnoreCase) ? "DESC" : "ASC";
        parameters.Add("Offset", Math.Max((query.Page - 1) * query.PageSize, 0));
        parameters.Add("PageSize", query.PageSize);

        var totalCount = await connection.ExecuteScalarAsync<int>(
            $"SELECT COUNT(1) FROM ${table} WHERE {where}",
            parameters);
        var items = (await connection.QueryAsync<${singularName}>(
            $"SELECT ${columnList(database, groups)} FROM ${table} WHERE {where} ORDER BY {sortColumn} {direction} ${sqlPaging(database)}",
            parameters)).AsList();

        return (items, totalCount);
    }`;
}

function renderLookupMethod(config, table, database, display) {
  const isServices = isServicesArchitecture(config.architecture);
  const like = sqlLike(database);
  const paging = database === 'sqlserver'
    ? 'OFFSET 0 ROWS FETCH NEXT @Take ROWS ONLY'
    : 'LIMIT @Take';

  if (isServices) {
    return `    public async Task<IReadOnlyList<LookupItemDto>> LookupAsync(string? search, int take, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var connection = _connections.CreateConnection();
        var limit = take <= 0 ? 50 : Math.Min(take, 100);
        var parameters = new DynamicParameters();
        parameters.Add("Take", limit);
        var where = "${quoteIdent(database, 'IsDeleted')} = ${sqlFalse(database)}";
        if (!string.IsNullOrWhiteSpace(search))
        {
            where += " AND ${quoteIdent(database, display)} ${like} @Search";
            parameters.Add("Search", $"%{search.Trim()}%");
        }

        var items = await connection.QueryAsync<LookupItemDto>(
            $"SELECT ${quoteIdent(database, 'Id')} AS Id, ${quoteIdent(database, display)} AS DisplayName FROM ${table} WHERE {where} ORDER BY ${quoteIdent(database, display)} ${paging}",
            parameters);
        return items.AsList();
    }`;
  }

  return `    public async Task<IReadOnlyList<LookupItemDto>> LookupAsync(Lookup${config.feature.pluralName}Query query, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var connection = _connections.CreateConnection();
        var take = query.Take <= 0 ? 50 : Math.Min(query.Take, 100);
        var parameters = new DynamicParameters();
        parameters.Add("Take", take);
        var where = "${quoteIdent(database, 'IsDeleted')} = ${sqlFalse(database)}";
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            where += " AND ${quoteIdent(database, display)} ${like} @Search";
            parameters.Add("Search", $"%{query.Search.Trim()}%");
        }

        var items = await connection.QueryAsync<LookupItemDto>(
            $"SELECT ${quoteIdent(database, 'Id')} AS Id, ${quoteIdent(database, display)} AS DisplayName FROM ${table} WHERE {where} ORDER BY ${quoteIdent(database, display)} ${paging}",
            parameters);
        return items.AsList();
    }`;
}

function renderGetByIdMethod(singularName, table, database, deleted) {
  const name = deleted ? 'GetDeletedByIdAsync' : 'GetByIdAsync';
  const predicate = deleted
    ? `${quoteIdent(database, 'Id')} = @Id AND ${quoteIdent(database, 'IsDeleted')} = ${sqlTrue(database)}`
    : `${quoteIdent(database, 'Id')} = @Id AND ${quoteIdent(database, 'IsDeleted')} = ${sqlFalse(database)}`;
  return `    public async Task<${singularName}?> ${name}(Guid id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var connection = _connections.CreateConnection();
        return await connection.QuerySingleOrDefaultAsync<${singularName}>(
            $"SELECT * FROM ${table} WHERE ${predicate}",
            new { Id = id });
    }`;
}

function insertColumns(groups) {
  return [
    'Id',
    'CreatedAtUtc',
    'IsDeleted',
    ...groups.scalar.map((field) => field.name),
    ...groups.enums.map((field) => field.name),
    ...groups.toOne.map((field) => field.foreignKeyName),
    ...groups.mediaSingle.map((field) => field.foreignKeyName),
  ];
}

function renderInsertMethod(config, groups, table, database) {
  const { singularName } = config.feature;
  const columns = insertColumns(groups);
  const quoted = columns.map((name) => quoteIdent(database, name)).join(', ');
  const params = columns.map((name) => `@${name}`).join(', ');
  return `    public async Task InsertAsync(${singularName} entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        entity.CreatedAtUtc = DateTime.UtcNow;
        entity.IsDeleted = false;
        using var connection = _connections.CreateConnection();
        await connection.ExecuteAsync(
            $"INSERT INTO ${table} (${quoted}) VALUES (${params})",
            entity);
    }`;
}

function renderUpdateMethod(config, groups, table, database) {
  const { singularName } = config.feature;
  const columns = [
    'UpdatedAtUtc',
    ...groups.scalar.map((field) => field.name),
    ...groups.enums.map((field) => field.name),
    ...groups.toOne.map((field) => field.foreignKeyName),
    ...groups.mediaSingle.map((field) => field.foreignKeyName),
  ];
  const assignments = columns
    .map((name) => `${quoteIdent(database, name)} = @${name}`)
    .join(', ');
  return `    public async Task UpdateAsync(${singularName} entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        entity.UpdatedAtUtc = DateTime.UtcNow;
        using var connection = _connections.CreateConnection();
        await connection.ExecuteAsync(
            $"UPDATE ${table} SET ${assignments} WHERE ${quoteIdent(database, 'Id')} = @Id AND ${quoteIdent(database, 'IsDeleted')} = ${sqlFalse(database)}",
            entity);
    }`;
}

function renderSoftDeleteMethod(table, database) {
  return `    public async Task SoftDeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var connection = _connections.CreateConnection();
        await connection.ExecuteAsync(
            $"UPDATE ${table} SET ${quoteIdent(database, 'IsDeleted')} = ${sqlTrue(database)}, ${quoteIdent(database, 'DeletedAtUtc')} = @DeletedAtUtc WHERE ${quoteIdent(database, 'Id')} = @Id",
            new { Id = id, DeletedAtUtc = DateTime.UtcNow });
    }`;
}

function renderRestoreMethod(table, database) {
  return `    public async Task RestoreAsync(Guid id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var connection = _connections.CreateConnection();
        await connection.ExecuteAsync(
            $"UPDATE ${table} SET ${quoteIdent(database, 'IsDeleted')} = ${sqlFalse(database)}, ${quoteIdent(database, 'DeletedAtUtc')} = NULL WHERE ${quoteIdent(database, 'Id')} = @Id",
            new { Id = id });
    }`;
}
