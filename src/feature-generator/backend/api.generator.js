import { canBeLookupTarget } from './lookup.generator.js';
import { getBackendFilePath } from '../../utils/project-paths.js';
import { isServicesArchitecture } from './architecture.js';
import {
  authorizationUsings,
  controllerAuthorizationAttribute,
  methodPermissionAttribute,
} from './authorization.js';
import { applicationFeatureName, planRouterUpdate } from './clean-architecture.js';

/**
 * @param {object} config
 * @returns {{ relativePath: string, contents: string }[]}
 */
export function planApiFiles(config) {
  const { pluralName } = config.feature;

  return [
    {
      relativePath: getBackendFilePath(config, 'API', 'Controllers', `${pluralName}Controller.cs`),
      contents: isServicesArchitecture(config.architecture)
        ? renderServiceController(config)
        : renderController(config),
    },
  ];
}

/**
 * @param {object} config
 */
export function planApiRegistryUpdates(config) {
  const { pluralName } = config.feature;
  const ops = config.operations;
  /** @type {{ name: string, suffix?: string }[]} */
  const routes = [{ name: 'Root' }];

  if (ops.search) {
    routes.push({ name: 'Search', suffix: '/Search' });
  }
  if (canBeLookupTarget(config)) {
    routes.push({ name: 'Lookup', suffix: '/Lookup' });
  }
  if (ops.getById) {
    routes.push({ name: 'ById', suffix: '/{id:guid}' });
  }
  if (ops.create) {
    routes.push({ name: 'Create' });
  }
  if (ops.update) {
    routes.push({ name: 'Update', suffix: '/{id:guid}' });
  }
  if (ops.delete) {
    routes.push({ name: 'Delete', suffix: '/{id:guid}' });
  }
  if (ops.restore) {
    routes.push({ name: 'Restore', suffix: '/{id:guid}/Restore' });
  }

  return [
    planRouterUpdate(config, config.projectName, pluralName, pluralName, routes),
  ];
}

/**
 * @param {object} config
 */
function renderController(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const ops = config.operations;

  /** @type {string[]} */
  const usings = [
    'using MediatR;',
    'using Microsoft.AspNetCore.Mvc;',
    `using ${ns}.API.Contracts;`,
    ...authorizationUsings(config),
  ];

  if (ops.search) {
    usings.push(`using ${ns}.Application.Features.${applicationFeatureName(config)}.Queries.Search;`);
  }

  if (canBeLookupTarget(config)) {
    usings.push(`using ${ns}.Application.Features.${applicationFeatureName(config)}.Queries.Lookup;`);
  }

  if (ops.getById) {
    usings.push(`using ${ns}.Application.Features.${applicationFeatureName(config)}.Queries.GetById;`);
  }

  if (ops.create) {
    usings.push(`using ${ns}.Application.Features.${applicationFeatureName(config)}.Commands.Create;`);
  }

  if (ops.update) {
    usings.push(`using ${ns}.Application.Features.${applicationFeatureName(config)}.Commands.Update;`);
  }

  if (ops.delete) {
    usings.push(`using ${ns}.Application.Features.${applicationFeatureName(config)}.Commands.Delete;`);
  }

  if (ops.restore) {
    usings.push(`using ${ns}.Application.Features.${applicationFeatureName(config)}.Commands.Restore;`);
  }

  /** @type {string[]} */
  const actions = [];

  if (ops.search) {
    actions.push(`${methodPermissionAttribute(config, 'View')}    [HttpPost(Router.${pluralName}.Search)]
    public async Task<IActionResult> Search(
        [FromBody] Search${pluralName}Query query,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(query, cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (canBeLookupTarget(config)) {
    actions.push(`${methodPermissionAttribute(config, 'View')}    [HttpGet(Router.${pluralName}.Lookup)]
    public async Task<IActionResult> Lookup(
        [FromQuery] string? search,
        [FromQuery] int take,
        CancellationToken cancellationToken)
    {
        var query = new Lookup${pluralName}Query(search, take <= 0 ? 50 : take);
        var result = await _sender.Send(query, cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (ops.getById) {
    actions.push(`${methodPermissionAttribute(config, 'View')}    [HttpGet(Router.${pluralName}.ById)]
    public async Task<IActionResult> GetById(
        Guid id,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new Get${singularName}ByIdQuery(id), cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (ops.create) {
    actions.push(`${methodPermissionAttribute(config, 'Create')}    [HttpPost(Router.${pluralName}.Create)]
    public async Task<IActionResult> Create(
        [FromBody] Create${singularName}Command command,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(command, cancellationToken);
        return ToCreatedResult(result);
    }`);
  }

  if (ops.update) {
    actions.push(`${methodPermissionAttribute(config, 'Update')}    [HttpPut(Router.${pluralName}.Update)]
    public async Task<IActionResult> Update(
        Guid id,
        [FromBody] Update${singularName}Command command,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(command with { Id = id }, cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (ops.delete) {
    actions.push(`${methodPermissionAttribute(config, 'Delete')}    [HttpDelete(Router.${pluralName}.Delete)]
    public async Task<IActionResult> Delete(
        Guid id,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new Delete${singularName}Command(id), cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (ops.restore) {
    actions.push(`${methodPermissionAttribute(config, 'Restore')}    [HttpPost(Router.${pluralName}.Restore)]
    public async Task<IActionResult> Restore(
        Guid id,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new Restore${singularName}Command(id), cancellationToken);
        return ToActionResult(result);
    }`);
  }

  return `${usings.join('\n')}

namespace ${ns}.API.Controllers;

[ApiController]
${controllerAuthorizationAttribute(config)}public sealed class ${pluralName}Controller : ApiControllerBase
{
    private readonly ISender _sender;

    public ${pluralName}Controller(ISender sender)
    {
        _sender = sender;
    }

${actions.join('\n\n')}
}
`;
}

/**
 * @param {object} config
 */
function renderServiceController(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const ops = config.operations;

  /** @type {string[]} */
  const usings = [
    'using Microsoft.AspNetCore.Mvc;',
    `using ${ns}.API.Contracts;`,
    `using ${ns}.Application.Modules.${pluralName}.DTOs;`,
    `using ${ns}.Application.Modules.${pluralName}.Interfaces;`,
    ...authorizationUsings(config),
  ];

  if (ops.search || canBeLookupTarget(config)) {
    usings.push(`using ${ns}.Application.Common.Models;`);
  }

  /** @type {string[]} */
  const actions = [];

  if (ops.search) {
    actions.push(`${methodPermissionAttribute(config, 'View')}    [HttpPost(Router.${pluralName}.Search)]
    public async Task<IActionResult> Search(
        [FromBody] Search${pluralName}Dto request,
        CancellationToken cancellationToken)
    {
        var result = await _service.SearchAsync(request, cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (canBeLookupTarget(config)) {
    actions.push(`${methodPermissionAttribute(config, 'View')}    [HttpGet(Router.${pluralName}.Lookup)]
    public async Task<IActionResult> Lookup(
        [FromQuery] string? search,
        [FromQuery] int take,
        CancellationToken cancellationToken)
    {
        var result = await _service.LookupAsync(search, take <= 0 ? 50 : take, cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (ops.getById) {
    actions.push(`${methodPermissionAttribute(config, 'View')}    [HttpGet(Router.${pluralName}.ById)]
    public async Task<IActionResult> GetById(
        Guid id,
        CancellationToken cancellationToken)
    {
        var result = await _service.GetByIdAsync(id, cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (ops.create) {
    actions.push(`${methodPermissionAttribute(config, 'Create')}    [HttpPost(Router.${pluralName}.Create)]
    public async Task<IActionResult> Create(
        [FromBody] Create${singularName}Dto request,
        CancellationToken cancellationToken)
    {
        var result = await _service.CreateAsync(request, cancellationToken);
        return ToCreatedResult(result);
    }`);
  }

  if (ops.update) {
    actions.push(`${methodPermissionAttribute(config, 'Update')}    [HttpPut(Router.${pluralName}.Update)]
    public async Task<IActionResult> Update(
        Guid id,
        [FromBody] Update${singularName}Dto request,
        CancellationToken cancellationToken)
    {
        var result = await _service.UpdateAsync(id, request, cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (ops.delete) {
    actions.push(`${methodPermissionAttribute(config, 'Delete')}    [HttpDelete(Router.${pluralName}.Delete)]
    public async Task<IActionResult> Delete(
        Guid id,
        CancellationToken cancellationToken)
    {
        var result = await _service.DeleteAsync(id, cancellationToken);
        return ToActionResult(result);
    }`);
  }

  if (ops.restore) {
    actions.push(`${methodPermissionAttribute(config, 'Restore')}    [HttpPost(Router.${pluralName}.Restore)]
    public async Task<IActionResult> Restore(
        Guid id,
        CancellationToken cancellationToken)
    {
        var result = await _service.RestoreAsync(id, cancellationToken);
        return ToActionResult(result);
    }`);
  }

  return `${[...new Set(usings)].join('\n')}

namespace ${ns}.API.Controllers;

[ApiController]
${controllerAuthorizationAttribute(config)}public sealed class ${pluralName}Controller : ApiControllerBase
{
    private readonly I${singularName}Service _service;

    public ${pluralName}Controller(I${singularName}Service service)
    {
        _service = service;
    }

${actions.join('\n\n')}
}
`;
}

