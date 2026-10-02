import { getBackendFilePath } from '../../utils/project-paths.js';
import { isServicesArchitecture } from './architecture.js';
import { applicationFeatureName } from './clean-architecture.js';
import { toCSharpType } from '../fields/field-types.js';

/**
 * @param {object} config
 * @returns {{ relativePath: string, contents: string }[]}
 */
export function planMvcFiles(config) {
  const { singularName, pluralName } = config.feature;
  const isServices = isServicesArchitecture(config.architecture);

  const controllerPath = getBackendFilePath(config, 'Web', 'Controllers', `${pluralName}Controller.cs`);
  const vmBase = (...segments) => getBackendFilePath(config, 'Web', 'ViewModels', pluralName, ...segments);
  const viewBase = (...segments) => getBackendFilePath(config, 'Web', 'Views', pluralName, ...segments);

  return [
    {
      relativePath: controllerPath,
      contents: renderMvcController(config, isServices),
    },
    {
      relativePath: vmBase(`${singularName}ViewModel.cs`),
      contents: renderViewModel(config),
    },
    {
      relativePath: vmBase(`Create${singularName}ViewModel.cs`),
      contents: renderCreateViewModel(config),
    },
    {
      relativePath: vmBase(`Update${singularName}ViewModel.cs`),
      contents: renderUpdateViewModel(config),
    },
    {
      relativePath: viewBase('Index.cshtml'),
      contents: renderIndexView(config),
    },
    {
      relativePath: viewBase('Create.cshtml'),
      contents: renderCreateView(config),
    },
    {
      relativePath: viewBase('Edit.cshtml'),
      contents: renderEditView(config),
    },
    {
      relativePath: viewBase('Details.cshtml'),
      contents: renderDetailsView(config),
    },
    {
      relativePath: viewBase('Delete.cshtml'),
      contents: renderDeleteView(config),
    },
  ];
}

function renderMvcController(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const usings = [
    'using Microsoft.AspNetCore.Mvc;',
    `using ${ns}.Web.ViewModels.${pluralName};`,
  ];

  if (isServices) {
    usings.push(
      `using ${ns}.Application.Modules.${pluralName}.DTOs;`,
      `using ${ns}.Application.Modules.${pluralName}.Interfaces;`,
    );
  } else {
    usings.push(
      'using MediatR;',
      `using ${ns}.Application.Features.${featureName}.DTOs;`,
      `using ${ns}.Application.Features.${featureName}.Commands.Create;`,
      `using ${ns}.Application.Features.${featureName}.Commands.Update;`,
      `using ${ns}.Application.Features.${featureName}.Commands.Delete;`,
      `using ${ns}.Application.Features.${featureName}.Queries.Search;`,
      `using ${ns}.Application.Features.${featureName}.Queries.GetById;`,
    );
  }

  const createAssignments = scalarFields
    .map((f) => `                ${f.name} = model.${f.name},`)
    .join('\n');

  const updateAssignments = [
    '                Id = model.Id,',
    '                RowVersion = model.RowVersion,',
    ...scalarFields.map((f) => `                ${f.name} = model.${f.name},`),
  ].join('\n');

  const modelFromDtoAssignments = [
    '            Id = item.Id,',
    '            RowVersion = item.RowVersion,',
    ...scalarFields.map((f) => `            ${f.name} = item.${f.name},`),
  ].join('\n');

  return `${usings.join('\n')}

namespace ${ns}.Web.Controllers;

public class ${pluralName}Controller : Controller
{
    private readonly ${isServices ? `I${singularName}Service _service` : 'ISender _sender'};

    public ${pluralName}Controller(${isServices ? `I${singularName}Service service` : 'ISender sender'})
    {
        ${isServices ? '_service = service;' : '_sender = sender;'}
    }

    public async Task<IActionResult> Index(CancellationToken cancellationToken)
    {
        ${isServices
          ? `var result = await _service.SearchAsync(new Search${pluralName}Dto { PageSize = 100 }, cancellationToken);
        var items = result.IsSuccess ? result.Value.Items : new List<${singularName}Dto>();`
          : `var result = await _sender.Send(new Search${pluralName}Query { PageSize = 100 }, cancellationToken);
        var items = result.IsSuccess ? result.Value.Items : new List<${singularName}Dto>();`}
        return View(items);
    }

    public async Task<IActionResult> Details(Guid id, CancellationToken cancellationToken)
    {
        ${isServices
          ? 'var result = await _service.GetByIdAsync(id, cancellationToken);'
          : `var result = await _sender.Send(new Get${singularName}ByIdQuery(id), cancellationToken);`}
        if (!result.IsSuccess) return NotFound();
        return View(result.Value);
    }

    public IActionResult Create()
    {
        return View(new Create${singularName}ViewModel());
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(Create${singularName}ViewModel model, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return View(model);

        ${isServices
          ? `var request = new Create${singularName}Dto
        {
${createAssignments}
        };
        var result = await _service.CreateAsync(request, cancellationToken);`
          : `var command = new Create${singularName}Command
        {
${createAssignments}
        };
        var result = await _sender.Send(command, cancellationToken);`}

        if (!result.IsSuccess)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message);
            return View(model);
        }

        return RedirectToAction(nameof(Index));
    }

    public async Task<IActionResult> Edit(Guid id, CancellationToken cancellationToken)
    {
        ${isServices
          ? 'var result = await _service.GetByIdAsync(id, cancellationToken);'
          : `var result = await _sender.Send(new Get${singularName}ByIdQuery(id), cancellationToken);`}
        if (!result.IsSuccess) return NotFound();
        var item = result.Value;
        var model = new Update${singularName}ViewModel
        {
${modelFromDtoAssignments}
        };
        return View(model);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Edit(Guid id, Update${singularName}ViewModel model, CancellationToken cancellationToken)
    {
        if (id != model.Id || !ModelState.IsValid) return View(model);

        ${isServices
          ? `var request = new Update${singularName}Dto
        {
${updateAssignments}
        };
        var result = await _service.UpdateAsync(id, request, cancellationToken);`
          : `var command = new Update${singularName}Command
        {
${updateAssignments}
        };
        var result = await _sender.Send(command, cancellationToken);`}

        if (!result.IsSuccess)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message);
            return View(model);
        }

        return RedirectToAction(nameof(Index));
    }

    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        ${isServices
          ? 'var result = await _service.GetByIdAsync(id, cancellationToken);'
          : `var result = await _sender.Send(new Get${singularName}ByIdQuery(id), cancellationToken);`}
        if (!result.IsSuccess) return NotFound();
        return View(result.Value);
    }

    [HttpPost, ActionName("Delete")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteConfirmed(Guid id, CancellationToken cancellationToken)
    {
        ${isServices
          ? 'await _service.DeleteAsync(id, cancellationToken);'
          : `await _sender.Send(new Delete${singularName}Command(id), cancellationToken);`}
        return RedirectToAction(nameof(Index));
    }
}
`;
}

function renderViewModel(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const props = scalarFields
    .map((f) => `    public ${toCSharpType(f)} ${f.name} { get; set; }${f.type === 'string' && !f.nullable ? ' = string.Empty;' : ''}`)
    .join('\n');

  return `namespace ${ns}.Web.ViewModels.${pluralName};

public class ${singularName}ViewModel
{
    public Guid Id { get; set; }
${props}
}
`;
}

function renderCreateViewModel(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const props = scalarFields
    .map((f) => {
      const requiredAttr = f.required ? '    [System.ComponentModel.DataAnnotations.Required]\n' : '';
      return `${requiredAttr}    public ${toCSharpType(f)} ${f.name} { get; set; }${f.type === 'string' && !f.nullable ? ' = string.Empty;' : ''}`;
    })
    .join('\n');

  return `namespace ${ns}.Web.ViewModels.${pluralName};

public class Create${singularName}ViewModel
{
${props}
}
`;
}

function renderUpdateViewModel(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const props = scalarFields
    .map((f) => {
      const requiredAttr = f.required ? '    [System.ComponentModel.DataAnnotations.Required]\n' : '';
      return `${requiredAttr}    public ${toCSharpType(f)} ${f.name} { get; set; }${f.type === 'string' && !f.nullable ? ' = string.Empty;' : ''}`;
    })
    .join('\n');

  return `namespace ${ns}.Web.ViewModels.${pluralName};

public class Update${singularName}ViewModel
{
    public Guid Id { get; set; }
    public byte[] RowVersion { get; set; } = [];
${props}
}
`;
}

function renderIndexView(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const isServices = isServicesArchitecture(config.architecture);
  const featureName = applicationFeatureName(config);
  const dtoNamespace = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${featureName}.DTOs`;

  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  return `@model IEnumerable<${dtoNamespace}.${singularName}Dto>

@{
    ViewData["Title"] = "${pluralName}";
}

<h1>${pluralName}</h1>

<p>
    <a asp-action="Create" class="btn btn-primary">Create New</a>
</p>
<table class="table">
    <thead>
        <tr>
${scalarFields.map((f) => `            <th>${f.name}</th>`).join('\n')}
            <th></th>
        </tr>
    </thead>
    <tbody>
@foreach (var item in Model) {
        <tr>
${scalarFields.map((f) => `            <td>@item.${f.name}</td>`).join('\n')}
            <td>
                <a asp-action="Edit" asp-route-id="@item.Id">Edit</a> |
                <a asp-action="Details" asp-route-id="@item.Id">Details</a> |
                <a asp-action="Delete" asp-route-id="@item.Id">Delete</a>
            </td>
        </tr>
}
    </tbody>
</table>
`;
}

function renderCreateView(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const formFields = scalarFields
    .map(
      (f) => `            <div class="form-group mb-3">
                <label asp-for="${f.name}" class="control-label"></label>
                <input asp-for="${f.name}" class="form-control" />
                <span asp-validation-for="${f.name}" class="text-danger"></span>
            </div>`,
    )
    .join('\n');

  return `@model ${ns}.Web.ViewModels.${pluralName}.Create${singularName}ViewModel

@{
    ViewData["Title"] = "Create ${singularName}";
}

<h1>Create ${singularName}</h1>
<hr />
<div class="row">
    <div class="col-md-6">
        <form asp-action="Create">
            <div asp-validation-summary="ModelOnly" class="text-danger mb-3"></div>
${formFields}
            <div class="form-group mt-3">
                <input type="submit" value="Create" class="btn btn-primary" />
                <a asp-action="Index" class="btn btn-secondary ms-2">Back to List</a>
            </div>
        </form>
    </div>
</div>
`;
}

function renderEditView(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const formFields = scalarFields
    .map(
      (f) => `            <div class="form-group mb-3">
                <label asp-for="${f.name}" class="control-label"></label>
                <input asp-for="${f.name}" class="form-control" />
                <span asp-validation-for="${f.name}" class="text-danger"></span>
            </div>`,
    )
    .join('\n');

  return `@model ${ns}.Web.ViewModels.${pluralName}.Update${singularName}ViewModel

@{
    ViewData["Title"] = "Edit ${singularName}";
}

<h1>Edit ${singularName}</h1>
<hr />
<div class="row">
    <div class="col-md-6">
        <form asp-action="Edit">
            <div asp-validation-summary="ModelOnly" class="text-danger mb-3"></div>
            <input type="hidden" asp-for="Id" />
            <input type="hidden" asp-for="RowVersion" />
${formFields}
            <div class="form-group mt-3">
                <input type="submit" value="Save" class="btn btn-primary" />
                <a asp-action="Index" class="btn btn-secondary ms-2">Back to List</a>
            </div>
        </form>
    </div>
</div>
`;
}

function renderDetailsView(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const isServices = isServicesArchitecture(config.architecture);
  const featureName = applicationFeatureName(config);
  const dtoNamespace = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${featureName}.DTOs`;

  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  return `@model ${dtoNamespace}.${singularName}Dto

@{
    ViewData["Title"] = "${singularName} Details";
}

<h1>Details</h1>

<div>
    <h4>${singularName}</h4>
    <hr />
    <dl class="row">
${scalarFields
  .map(
    (f) => `        <dt class="col-sm-3">${f.name}</dt>
        <dd class="col-sm-9">@Model.${f.name}</dd>`,
  )
  .join('\n')}
    </dl>
</div>
<div>
    <a asp-action="Edit" asp-route-id="@Model.Id" class="btn btn-primary">Edit</a>
    <a asp-action="Index" class="btn btn-secondary ms-2">Back to List</a>
</div>
`;
}

function renderDeleteView(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const isServices = isServicesArchitecture(config.architecture);
  const featureName = applicationFeatureName(config);
  const dtoNamespace = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${featureName}.DTOs`;

  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  return `@model ${dtoNamespace}.${singularName}Dto

@{
    ViewData["Title"] = "Delete ${singularName}";
}

<h1>Delete</h1>

<h3>Are you sure you want to delete this?</h3>
<div>
    <h4>${singularName}</h4>
    <hr />
    <dl class="row">
${scalarFields
  .map(
    (f) => `        <dt class="col-sm-3">${f.name}</dt>
        <dd class="col-sm-9">@Model.${f.name}</dd>`,
  )
  .join('\n')}
    </dl>
    
    <form asp-action="Delete">
        <input type="hidden" asp-for="Id" />
        <input type="submit" value="Delete" class="btn btn-danger" />
        <a asp-action="Index" class="btn btn-secondary ms-2">Cancel</a>
    </form>
</div>
`;
}
