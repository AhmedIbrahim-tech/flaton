import { getBackendFilePath } from '../../utils/project-paths.js';
import { isServicesArchitecture } from './architecture.js';
import { applicationFeatureName } from './clean-architecture.js';

/**
 * @param {object} config
 * @returns {{ relativePath: string, contents: string }[]}
 */
export function planRazorPagesFiles(config) {
  const { singularName, pluralName } = config.feature;
  const isServices = isServicesArchitecture(config.architecture);

  const base = (...segments) => getBackendFilePath(config, 'Web', 'Pages', pluralName, ...segments);

  return [
    {
      relativePath: base('Index.cshtml'),
      contents: renderIndexPage(config),
    },
    {
      relativePath: base('Index.cshtml.cs'),
      contents: renderIndexPageModel(config, isServices),
    },
    {
      relativePath: base('Create.cshtml'),
      contents: renderCreatePage(config),
    },
    {
      relativePath: base('Create.cshtml.cs'),
      contents: renderCreatePageModel(config, isServices),
    },
    {
      relativePath: base('Edit.cshtml'),
      contents: renderEditPage(config),
    },
    {
      relativePath: base('Edit.cshtml.cs'),
      contents: renderEditPageModel(config, isServices),
    },
    {
      relativePath: base('Details.cshtml'),
      contents: renderDetailsPage(config),
    },
    {
      relativePath: base('Details.cshtml.cs'),
      contents: renderDetailsPageModel(config, isServices),
    },
    {
      relativePath: base('Delete.cshtml'),
      contents: renderDeletePage(config),
    },
    {
      relativePath: base('Delete.cshtml.cs'),
      contents: renderDeletePageModel(config, isServices),
    },
  ];
}

function renderIndexPageModel(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);

  const usings = [
    'using Microsoft.AspNetCore.Mvc.RazorPages;',
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
      `using ${ns}.Application.Features.${featureName}.Queries.Search;`,
    );
  }

  return `${usings.join('\n')}

namespace ${ns}.Web.Pages.${pluralName};

public class IndexModel : PageModel
{
    private readonly ${isServices ? `I${singularName}Service _service` : 'ISender _sender'};

    public IndexModel(${isServices ? `I${singularName}Service service` : 'ISender sender'})
    {
        ${isServices ? '_service = service;' : '_sender = sender;'}
    }

    public IList<${singularName}Dto> ${pluralName} { get; set; } = new List<${singularName}Dto>();

    public async Task OnGetAsync(CancellationToken cancellationToken)
    {
        ${isServices
          ? `var result = await _service.SearchAsync(new Search${pluralName}Dto { PageSize = 100 }, cancellationToken);
        if (result.IsSuccess)
        {
            ${pluralName} = result.Value.Items.ToList();
        }`
          : `var result = await _sender.Send(new Search${pluralName}Query { PageSize = 100 }, cancellationToken);
        if (result.IsSuccess)
        {
            ${pluralName} = result.Value.Items.ToList();
        }`}
    }
}
`;
}

function renderIndexPage(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  return `@page
@model ${ns}.Web.Pages.${pluralName}.IndexModel
@{
    ViewData["Title"] = "${pluralName}";
}

<h1>${pluralName}</h1>

<p>
    <a asp-page="Create" class="btn btn-primary">Create New</a>
</p>
<table class="table">
    <thead>
        <tr>
${scalarFields.map((f) => `            <th>${f.name}</th>`).join('\n')}
            <th></th>
        </tr>
    </thead>
    <tbody>
@foreach (var item in Model.${pluralName}) {
        <tr>
${scalarFields.map((f) => `            <td>@item.${f.name}</td>`).join('\n')}
            <td>
                <a asp-page="./Edit" asp-route-id="@item.Id">Edit</a> |
                <a asp-page="./Details" asp-route-id="@item.Id">Details</a> |
                <a asp-page="./Delete" asp-route-id="@item.Id">Delete</a>
            </td>
        </tr>
}
    </tbody>
</table>
`;
}

function renderCreatePageModel(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const usings = [
    'using Microsoft.AspNetCore.Mvc;',
    'using Microsoft.AspNetCore.Mvc.RazorPages;',
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
    );
  }

  const dtoNamespace = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${featureName}.DTOs`;

  const assignments = scalarFields
    .map((f) => `                ${f.name} = ${singularName}.${f.name},`)
    .join('\n');

  return `${usings.join('\n')}

namespace ${ns}.Web.Pages.${pluralName};

public class CreateModel : PageModel
{
    private readonly ${isServices ? `I${singularName}Service _service` : 'ISender _sender'};

    public CreateModel(${isServices ? `I${singularName}Service service` : 'ISender sender'})
    {
        ${isServices ? '_service = service;' : '_sender = sender;'}
    }

    [BindProperty]
    public ${dtoNamespace}.Create${singularName}Dto ${singularName} { get; set; } = new();

    public IActionResult OnGet()
    {
        return Page();
    }

    public async Task<IActionResult> OnPostAsync(CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return Page();
        }

        ${isServices
          ? `var result = await _service.CreateAsync(${singularName}, cancellationToken);`
          : `var command = new Create${singularName}Command
        {
${assignments}
        };
        var result = await _sender.Send(command, cancellationToken);`}

        if (!result.IsSuccess)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message);
            return Page();
        }

        return RedirectToPage("./Index");
    }
}
`;
}

function renderCreatePage(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const formFields = scalarFields
    .map(
      (f) => `            <div class="form-group mb-3">
                <label asp-for="${singularName}.${f.name}" class="control-label"></label>
                <input asp-for="${singularName}.${f.name}" class="form-control" />
                <span asp-validation-for="${singularName}.${f.name}" class="text-danger"></span>
            </div>`,
    )
    .join('\n');

  return `@page
@model ${ns}.Web.Pages.${pluralName}.CreateModel

@{
    ViewData["Title"] = "Create ${singularName}";
}

<h1>Create ${singularName}</h1>
<hr />
<div class="row">
    <div class="col-md-6">
        <form method="post">
            <div asp-validation-summary="ModelOnly" class="text-danger mb-3"></div>
${formFields}
            <div class="form-group mt-3">
                <input type="submit" value="Create" class="btn btn-primary" />
                <a asp-page="./Index" class="btn btn-secondary ms-2">Back to List</a>
            </div>
        </form>
    </div>
</div>
`;
}

function renderEditPageModel(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const usings = [
    'using Microsoft.AspNetCore.Mvc;',
    'using Microsoft.AspNetCore.Mvc.RazorPages;',
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
      `using ${ns}.Application.Features.${featureName}.Commands.Update;`,
      `using ${ns}.Application.Features.${featureName}.Queries.GetById;`,
    );
  }

  const dtoNamespace = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${featureName}.DTOs`;

  const populateAssignments = [
    '            Id = item.Id,',
    '            RowVersion = item.RowVersion,',
    ...scalarFields.map((f) => `            ${f.name} = item.${f.name},`),
  ].join('\n');

  const updateAssignments = [
    `                Id = ${singularName}.Id,`,
    `                RowVersion = ${singularName}.RowVersion,`,
    ...scalarFields.map((f) => `                ${f.name} = ${singularName}.${f.name},`),
  ].join('\n');

  return `${usings.join('\n')}

namespace ${ns}.Web.Pages.${pluralName};

public class EditModel : PageModel
{
    private readonly ${isServices ? `I${singularName}Service _service` : 'ISender _sender'};

    public EditModel(${isServices ? `I${singularName}Service service` : 'ISender sender'})
    {
        ${isServices ? '_service = service;' : '_sender = sender;'}
    }

    [BindProperty]
    public ${dtoNamespace}.Update${singularName}Dto ${singularName} { get; set; } = new();

    public async Task<IActionResult> OnGetAsync(Guid id, CancellationToken cancellationToken)
    {
        ${isServices
          ? 'var result = await _service.GetByIdAsync(id, cancellationToken);'
          : `var result = await _sender.Send(new Get${singularName}ByIdQuery(id), cancellationToken);`}
        if (!result.IsSuccess)
        {
            return NotFound();
        }

        var item = result.Value;
        ${singularName} = new ${dtoNamespace}.Update${singularName}Dto
        {
${populateAssignments}
        };

        return Page();
    }

    public async Task<IActionResult> OnPostAsync(CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return Page();
        }

        ${isServices
          ? `var result = await _service.UpdateAsync(${singularName}.Id, ${singularName}, cancellationToken);`
          : `var command = new Update${singularName}Command
        {
${updateAssignments}
        };
        var result = await _sender.Send(command, cancellationToken);`}

        if (!result.IsSuccess)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message);
            return Page();
        }

        return RedirectToPage("./Index");
    }
}
`;
}

function renderEditPage(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  const formFields = scalarFields
    .map(
      (f) => `            <div class="form-group mb-3">
                <label asp-for="${singularName}.${f.name}" class="control-label"></label>
                <input asp-for="${singularName}.${f.name}" class="form-control" />
                <span asp-validation-for="${singularName}.${f.name}" class="text-danger"></span>
            </div>`,
    )
    .join('\n');

  return `@page "{id:guid}"
@model ${ns}.Web.Pages.${pluralName}.EditModel

@{
    ViewData["Title"] = "Edit ${singularName}";
}

<h1>Edit ${singularName}</h1>
<hr />
<div class="row">
    <div class="col-md-6">
        <form method="post">
            <div asp-validation-summary="ModelOnly" class="text-danger mb-3"></div>
            <input type="hidden" asp-for="${singularName}.Id" />
            <input type="hidden" asp-for="${singularName}.RowVersion" />
${formFields}
            <div class="form-group mt-3">
                <input type="submit" value="Save" class="btn btn-primary" />
                <a asp-page="./Index" class="btn btn-secondary ms-2">Back to List</a>
            </div>
        </form>
    </div>
</div>
`;
}

function renderDetailsPageModel(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);

  const usings = [
    'using Microsoft.AspNetCore.Mvc;',
    'using Microsoft.AspNetCore.Mvc.RazorPages;',
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
      `using ${ns}.Application.Features.${featureName}.Queries.GetById;`,
    );
  }

  const dtoNamespace = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${featureName}.DTOs`;

  return `${usings.join('\n')}

namespace ${ns}.Web.Pages.${pluralName};

public class DetailsModel : PageModel
{
    private readonly ${isServices ? `I${singularName}Service _service` : 'ISender _sender'};

    public DetailsModel(${isServices ? `I${singularName}Service service` : 'ISender sender'})
    {
        ${isServices ? '_service = service;' : '_sender = sender;'}
    }

    public ${dtoNamespace}.${singularName}Dto ${singularName} { get; set; } = default!;

    public async Task<IActionResult> OnGetAsync(Guid id, CancellationToken cancellationToken)
    {
        ${isServices
          ? 'var result = await _service.GetByIdAsync(id, cancellationToken);'
          : `var result = await _sender.Send(new Get${singularName}ByIdQuery(id), cancellationToken);`}
        if (!result.IsSuccess)
        {
            return NotFound();
        }

        ${singularName} = result.Value;
        return Page();
    }
}
`;
}

function renderDetailsPage(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  return `@page "{id:guid}"
@model ${ns}.Web.Pages.${pluralName}.DetailsModel

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
        <dd class="col-sm-9">@Model.${singularName}.${f.name}</dd>`,
  )
  .join('\n')}
    </dl>
</div>
<div>
    <a asp-page="./Edit" asp-route-id="@Model.${singularName}.Id" class="btn btn-primary">Edit</a>
    <a asp-page="./Index" class="btn btn-secondary ms-2">Back to List</a>
</div>
`;
}

function renderDeletePageModel(config, isServices) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const featureName = applicationFeatureName(config);

  const usings = [
    'using Microsoft.AspNetCore.Mvc;',
    'using Microsoft.AspNetCore.Mvc.RazorPages;',
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
      `using ${ns}.Application.Features.${featureName}.Commands.Delete;`,
      `using ${ns}.Application.Features.${featureName}.Queries.GetById;`,
    );
  }

  const dtoNamespace = isServices
    ? `${ns}.Application.Modules.${pluralName}.DTOs`
    : `${ns}.Application.Features.${featureName}.DTOs`;

  return `${usings.join('\n')}

namespace ${ns}.Web.Pages.${pluralName};

public class DeleteModel : PageModel
{
    private readonly ${isServices ? `I${singularName}Service _service` : 'ISender _sender'};

    public DeleteModel(${isServices ? `I${singularName}Service service` : 'ISender sender'})
    {
        ${isServices ? '_service = service;' : '_sender = sender;'}
    }

    [BindProperty]
    public ${dtoNamespace}.${singularName}Dto ${singularName} { get; set; } = default!;

    public async Task<IActionResult> OnGetAsync(Guid id, CancellationToken cancellationToken)
    {
        ${isServices
          ? 'var result = await _service.GetByIdAsync(id, cancellationToken);'
          : `var result = await _sender.Send(new Get${singularName}ByIdQuery(id), cancellationToken);`}
        if (!result.IsSuccess)
        {
            return NotFound();
        }

        ${singularName} = result.Value;
        return Page();
    }

    public async Task<IActionResult> OnPostAsync(Guid id, CancellationToken cancellationToken)
    {
        ${isServices
          ? 'await _service.DeleteAsync(id, cancellationToken);'
          : `await _sender.Send(new Delete${singularName}Command(id), cancellationToken);`}
        return RedirectToPage("./Index");
    }
}
`;
}

function renderDeletePage(config) {
  const { singularName, pluralName } = config.feature;
  const ns = config.projectName;
  const scalarFields = (config.fields ?? []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  return `@page "{id:guid}"
@model ${ns}.Web.Pages.${pluralName}.DeleteModel

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
        <dd class="col-sm-9">@Model.${singularName}.${f.name}</dd>`,
  )
  .join('\n')}
    </dl>
    
    <form method="post">
        <input type="submit" value="Delete" class="btn btn-danger" />
        <a asp-page="./Index" class="btn btn-secondary ms-2">Cancel</a>
    </form>
</div>
`;
}
