import { isAutoMapper } from '../feature-profile.js';
import { groupFields } from '../fields/field-mappers.js';
import { entityClrName } from './clean-architecture.js';

/**
 * @param {object} config
 */
export function mappingUsing(config) {
  return isAutoMapper(config) ? 'using AutoMapper;\n' : '';
}

/**
 * @param {object} config
 */
export function mappingFields(config) {
  return isAutoMapper(config) ? '\n    private readonly IMapper _mapper;' : '';
}

/**
 * @param {object} config
 */
export function mappingCtorParam(config) {
  return isAutoMapper(config) ? ', IMapper mapper' : '';
}

/**
 * @param {object} config
 */
export function mappingCtorAssign(config) {
  return isAutoMapper(config) ? '\n        _mapper = mapper;' : '';
}

/**
 * @param {object} config
 * @param {string} entityExpr
 */
export function toDtoCall(config, entityExpr) {
  const singular = config.feature.singularName;
  return isAutoMapper(config)
    ? `_mapper.Map<${singular}Dto>(${entityExpr})`
    : `${singular}Mappings.ToDto(${entityExpr})`;
}

/**
 * @param {object} config
 * @param {string} listExpr
 */
export function toDtoListCall(config, listExpr) {
  const singular = config.feature.singularName;
  return isAutoMapper(config)
    ? `_mapper.Map<List<${singular}Dto>>(${listExpr})`
    : `${listExpr}.Select(${singular}Mappings.ToDto).ToList()`;
}

import { isServicesArchitecture } from './architecture.js';

/**
 * @param {object} config
 */
export function renderAutoMapperProfile(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const groups = groupFields(config.fields);
  const isServices = isServicesArchitecture(config.architecture);

  /** @type {string[]} */
  const members = [];

  for (const field of groups.toOne) {
    const fallback = field.nullable ? 'null' : 'string.Empty';
    members.push(
      `            .ForMember(dto => dto.${field.displayName}, opt => opt.MapFrom(entity => entity.${field.name} != null ? entity.${field.name}.${field.display} : ${fallback}))`,
    );
  }

  for (const field of groups.toMany) {
    members.push(
      `            .ForMember(dto => dto.${field.commandIdsName}, opt => opt.MapFrom(entity => entity.${field.collectionName}.Select(item => item.Id).ToList()))`,
    );
    members.push(
      `            .ForMember(dto => dto.${field.collectionName}, opt => opt.MapFrom(entity => entity.${field.collectionName}.Select(item => new LookupItemDto { Id = item.Id, DisplayName = item.${field.display} }).ToList()))`,
    );
  }

  for (const field of groups.mediaMultiple) {
    members.push(
      `            .ForMember(dto => dto.${field.commandIdsName}, opt => opt.MapFrom(entity => entity.${field.collectionName}.Select(item => item.Id).ToList()))`,
    );
  }

  members.push(
    `            .ForMember(dto => dto.RowVersion, opt => opt.MapFrom(entity => Convert.ToBase64String(entity.RowVersion)))`,
  );

  const dtoNamespace = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${singularName}.DTOs`;

  const mappingNamespace = isServices
    ? `${ns}.Application.Modules.${pluralName}.Mapping`
    : `${ns}.Application.Features.${singularName}.Mapping`;

  const usings = [
    'using AutoMapper;',
    `using ${ns}.Domain.Entities;`,
    `using ${dtoNamespace};`,
  ];
  if (groups.toMany.length > 0) {
    usings.push(`using ${ns}.Application.Common.Models;`);
  }

  let extraMaps = '';
  if (isServices) {
    extraMaps = `
        CreateMap<Create${singularName}Dto, ${entityClrName(config)}>();
        CreateMap<Update${singularName}Dto, ${entityClrName(config)}>();`;
  }

  return `${usings.join('\n')}

namespace ${mappingNamespace};

public sealed class ${singularName}MappingProfile : Profile
{
    public ${singularName}MappingProfile()
    {
        CreateMap<${entityClrName(config)}, ${singularName}Dto>()
${members.join('\n')};${extraMaps}
    }
}
`;
}
