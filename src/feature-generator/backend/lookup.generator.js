import { groupFields } from '../fields/field-mappers.js';
import { getBackendFilePath } from '../../utils/project-paths.js';
import { isDapperOnly, usesDapper } from './architecture.js';
import { applicationFeatureBase } from './clean-architecture.js';
import { renderDapperLookupHandler } from './dapper-application.generator.js';

export const LOOKUP_DEFAULT_TAKE = 50;
export const LOOKUP_MAX_TAKE = 100;

/**
 * The display member used by the lookup endpoint: the first searchable string
 * scalar field, falling back to the first string field.
 * @param {object} config
 * @returns {string | null}
 */
export function lookupDisplayMember(config) {
  const { scalar } = groupFields(config.fields);
  const searchable = scalar.find(
    (field) => field.type === 'string' && field.searchable,
  );
  if (searchable) {
    return searchable.name;
  }
  const anyString = scalar.find((field) => field.type === 'string');
  return anyString ? anyString.name : null;
}

/**
 * A feature can be used as a relationship lookup target when it exposes a
 * string display member.
 * @param {object} config
 */
export function canBeLookupTarget(config) {
  return lookupDisplayMember(config) != null;
}

/**
 * Plan the lookup query/handler and the shared LookupItemDto model.
 * @param {object} config
 * @returns {{ relativePath: string, contents: string, writeMode?: string }[]}
 */
export function planLookupFiles(config) {
  const display = lookupDisplayMember(config);
  if (!display) {
    return [];
  }

  const { singularName, pluralName } = config.feature;
  const base = (...segments) => applicationFeatureBase(config, ...segments);

  return [
    {
      relativePath: base('Queries', 'Lookup', `Lookup${pluralName}Query.cs`),
      contents: renderLookupQuery(config),
    },
    {
      relativePath: base('Queries', 'Lookup', `Lookup${pluralName}QueryHandler.cs`),
      contents: renderLookupHandler(config, display),
    },
    {
      relativePath: getBackendFilePath(
        config,
        'Application',
        'Common',
        'Models',
        'LookupItemDto.cs',
      ),
      contents: renderLookupItemDto(config),
      writeMode: 'ifMissing',
    },
  ];
}

/**
 * @param {object} config
 */
export function renderLookupQuery(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;

  return `using MediatR;
using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.${singularName}.Queries.Lookup;

public sealed record Lookup${pluralName}Query(string? Search = null, int Take = ${LOOKUP_DEFAULT_TAKE})
    : IRequest<Result<IReadOnlyList<LookupItemDto>>>;
`;
}

/**
 * @param {object} config
 * @param {string} display
 */
export function renderLookupHandler(config, display) {
  if (usesDapper(config.orm)) {
    return renderDapperLookupHandler(config, display);
  }
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;

  return `using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.${singularName}.Queries.Lookup;

public sealed class Lookup${pluralName}QueryHandler
    : IRequestHandler<Lookup${pluralName}Query, Result<IReadOnlyList<LookupItemDto>>>
{
    private const int DefaultTake = ${LOOKUP_DEFAULT_TAKE};
    private const int MaxTake = ${LOOKUP_MAX_TAKE};

    private readonly IApplicationDbContext _dbContext;

    public Lookup${pluralName}QueryHandler(IApplicationDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<Result<IReadOnlyList<LookupItemDto>>> Handle(
        Lookup${pluralName}Query request,
        CancellationToken cancellationToken)
    {
        var take = request.Take <= 0 ? DefaultTake : Math.Min(request.Take, MaxTake);

        var query = _dbContext.${pluralName}.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var pattern = $"%{request.Search.Trim()}%";
            query = query.Where(entity => EF.Functions.Like(entity.${display}, pattern));
        }

        var items = await query
            .OrderBy(entity => entity.${display})
            .Take(take)
            .Select(entity => new LookupItemDto
            {
                Id = entity.Id,
                DisplayName = entity.${display},
            })
            .ToListAsync(cancellationToken);

        return Result.Success<IReadOnlyList<LookupItemDto>>(items);
    }
}
`;
}

/**
 * @param {object} config
 */
export function renderLookupItemDto(config) {
  const ns = config.projectName;

  return `namespace ${ns}.Application.Common.Models;

public sealed record LookupItemDto
{
    public Guid Id { get; init; }

    public string DisplayName { get; init; } = string.Empty;
}
`;
}
