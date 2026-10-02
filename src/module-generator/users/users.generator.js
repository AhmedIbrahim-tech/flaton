/**
 * V4 Users (admin user management) module generator.
 *
 * Backend (Application/Features/Users):
 *   - Safe UserDto (never exposes password hash / security stamp)
 *   - Search, GetById, Create, Update, ChangeRoles
 *   - Delegates all Identity access to an IUserDirectory abstraction that the
 *     Infrastructure layer implements over UserManager/RoleManager (auth).
 *   - Router.Users.g.cs + UsersController guarded by Users.View / Users.Manage
 *
 * Frontend:
 *   - React: Client/src/modules/users with slices/thunks, service, pages
 *   - Angular: Client/src/app/features/users with NgRx store
 */

import {
  paths,
  isReact,
  isAngular,
  isNext,
  moduleRegistrationFile,
  reactReducerUpdate,
  reactDashboardNavUpdate,
  finalizePlan,
  routerUpdate,
} from '../modules-orchestrator-helpers.js';
import {
  buildAngularGeneratedRoutes,
  buildAngularDashboardNav,
} from '../../feature-generator/frontend/angular/angular-registries.js';
import { registerFeaturePermissions } from '../permissions/permissions.generator.js';

/**
 * @param {object} config
 */
export function planUsersModule(config) {
  const ns = config.projectName;

  /** @type {{ relativePath: string, contents: string, writeMode?: string }[]} */
  const files = [];
  /** @type {{ relativePath: string, update: (existing: string) => string }[]} */
  const registryUpdates = [];
  /** @type {{ method: string, namespace: string }[]} */
  const registrations = [];

  // Permission registry ---------------------------------------------
  registryUpdates.push(registerFeaturePermissions(config, 'Users', ['View', 'Manage']));

  // Backend ---------------------------------------------------------
  files.push(...planUsersBackend(ns));
  registryUpdates.push(
    routerUpdate(ns, 'Users', 'Users', [
      { name: 'Root' },
      { name: 'Search', suffix: '/Search' },
      { name: 'ById', suffix: '/{id:guid}' },
      { name: 'Create' },
      { name: 'Update', suffix: '/{id:guid}' },
      { name: 'ChangeRoles', suffix: '/{id:guid}/Roles' },
    ]),
  );
  const { file: registrationFile, registration } = moduleRegistrationFile({
    projectName: ns,
    moduleName: 'Users',
    usings: [
      `using ${ns}.Application.Abstractions.Identity;`,
      `using ${ns}.Infrastructure.Identity;`,
    ],
    body: ['        services.AddScoped<IUserDirectory, UserDirectory>();'],
  });
  files.push(registrationFile);
  registrations.push(registration);

  // Frontend --------------------------------------------------------
  if (isReact(config)) {
    files.push(...planUsersReact(config));
    registryUpdates.push({
      relativePath: paths.client('store', 'generated-reducers.ts'),
      update: reactReducerUpdate({
        reducerKey: 'users',
        importName: 'usersReducer',
        importPath: '@/modules/users/slices/users.slice',
      }),
    });
    registryUpdates.push({
      relativePath: paths.client('navigation', 'generated-dashboard-nav.ts'),
      update: reactDashboardNavUpdate({
        navKey: 'users',
        label: 'Users',
        href: '/dashboard/users',
        icon: 'Users',
      }),
    });
  }

  if (isAngular(config)) {
    files.push(...planUsersAngular(config));
    const angularConfig = {
      feature: {
        kebabName: 'user',
        kebabPluralName: 'users',
        camelName: 'users',
        camelPluralName: 'users',
        pluralName: 'Users',
      },
      surface: { dashboard: true, public: false },
      labels: { enPlural: 'Users' },
    };
    registryUpdates.push({
      relativePath: paths.client('app', 'router', 'generated-routes.ts'),
      update: (existing) => buildAngularGeneratedRoutes(angularConfig, existing).contents,
    });
    registryUpdates.push({
      relativePath: paths.client('app', 'navigation', 'generated-dashboard-nav.ts'),
      update: (existing) => buildAngularDashboardNav(angularConfig, existing).contents,
    });
  }

  return finalizePlan({
    id: 'users',
    requires: ['auth', 'permissions'],
    files,
    registryUpdates,
    registrations,
    notes: [
      'UsersController is protected: reads require Users.View, writes require Users.Manage.',
      'UserDto is intentionally minimal and never exposes password hashes or security stamps.',
      'IUserDirectory is implemented in Infrastructure over UserManager/RoleManager from the auth module.',
    ],
  });
}

/* ================================================================== */
/* Backend                                                            */
/* ================================================================== */

/**
 * @param {string} ns
 * @returns {{ relativePath: string, contents: string, writeMode?: string }[]}
 */
function planUsersBackend(ns) {
  const base = (...segments) => paths.application('Features', 'Users', ...segments);

  return [
    { relativePath: base('DTOs', 'UserDto.cs'), contents: renderUserDto(ns) },
    {
      relativePath: paths.application('Abstractions', 'Identity', 'IUserDirectory.cs'),
      contents: renderUserDirectoryAbstraction(ns),
    },
    { relativePath: base('Queries', 'Search', 'SearchUsersQuery.cs'), contents: renderSearchQuery(ns) },
    {
      relativePath: base('Queries', 'Search', 'SearchUsersQueryHandler.cs'),
      contents: renderSearchHandler(ns),
    },
    {
      relativePath: base('Queries', 'Search', 'SearchUsersQueryValidator.cs'),
      contents: renderSearchValidator(ns),
    },
    { relativePath: base('Queries', 'GetById', 'GetUserByIdQuery.cs'), contents: renderGetByIdQuery(ns) },
    {
      relativePath: base('Queries', 'GetById', 'GetUserByIdQueryHandler.cs'),
      contents: renderGetByIdHandler(ns),
    },
    { relativePath: base('Commands', 'Create', 'CreateUserCommand.cs'), contents: renderCreateCommand(ns) },
    {
      relativePath: base('Commands', 'Create', 'CreateUserCommandHandler.cs'),
      contents: renderCreateHandler(ns),
    },
    {
      relativePath: base('Commands', 'Create', 'CreateUserCommandValidator.cs'),
      contents: renderCreateValidator(ns),
    },
    { relativePath: base('Commands', 'Update', 'UpdateUserCommand.cs'), contents: renderUpdateCommand(ns) },
    {
      relativePath: base('Commands', 'Update', 'UpdateUserCommandHandler.cs'),
      contents: renderUpdateHandler(ns),
    },
    {
      relativePath: base('Commands', 'Update', 'UpdateUserCommandValidator.cs'),
      contents: renderUpdateValidator(ns),
    },
    {
      relativePath: base('Commands', 'ChangeRoles', 'ChangeUserRolesCommand.cs'),
      contents: renderChangeRolesCommand(ns),
    },
    {
      relativePath: base('Commands', 'ChangeRoles', 'ChangeUserRolesCommandHandler.cs'),
      contents: renderChangeRolesHandler(ns),
    },
    {
      relativePath: base('Commands', 'ChangeRoles', 'ChangeUserRolesCommandValidator.cs'),
      contents: renderChangeRolesValidator(ns),
    },
    {
      relativePath: paths.api('Controllers', 'UsersController.cs'),
      contents: renderController(ns),
    },
    {
      relativePath: paths.infrastructure('Identity', 'Services', 'UserDirectory.cs'),
      contents: renderUserDirectoryImplementation(ns),
    },
  ];
}

/**
 * @param {string} ns
 */
function renderUserDto(ns) {
  return `namespace ${ns}.Application.Features.Users.DTOs;

/// <summary>
/// Safe projection of an identity user. Never includes password hashes,
/// security stamps, or other credential material.
/// </summary>
public sealed record UserDto
{
    public Guid Id { get; init; }

    public string UserName { get; init; } = string.Empty;

    public string Email { get; init; } = string.Empty;

    public bool EmailConfirmed { get; init; }

    public bool IsActive { get; init; }

    public DateTimeOffset? LockoutEndUtc { get; init; }

    public IReadOnlyList<string> Roles { get; init; } = Array.Empty<string>();
}
`;
}

/**
 * @param {string} ns
 */
function renderUserDirectoryAbstraction(ns) {
  return `using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Abstractions.Identity;

public sealed record UserSearchCriteria(
    int Page,
    int PageSize,
    string? SearchTerm,
    string? Role,
    bool? IsActive,
    string? SortBy,
    string? SortDirection);

public sealed record CreateUserInput(
    string UserName,
    string Email,
    string Password,
    IReadOnlyList<string> Roles);

public sealed record UpdateUserInput(
    Guid UserId,
    string Email,
    bool EmailConfirmed,
    bool IsActive);

/// <summary>
/// Read/write access to the identity user store, exposed to the Application
/// layer without leaking ASP.NET Core Identity types or credential material.
/// Implemented in Infrastructure over UserManager/RoleManager.
/// </summary>
public interface IUserDirectory
{
    Task<PaginationResult<UserDto>> SearchAsync(
        UserSearchCriteria criteria,
        CancellationToken cancellationToken = default);

    Task<UserDto?> GetByIdAsync(Guid userId, CancellationToken cancellationToken = default);

    Task<Result<UserDto>> CreateAsync(
        CreateUserInput input,
        CancellationToken cancellationToken = default);

    Task<Result<UserDto>> UpdateAsync(
        UpdateUserInput input,
        CancellationToken cancellationToken = default);

    Task<Result<UserDto>> ChangeRolesAsync(
        Guid userId,
        IReadOnlyList<string> roles,
        CancellationToken cancellationToken = default);
}
`;
}

/**
 * @param {string} ns
 */
function renderSearchQuery(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Queries.Search;

public sealed class SearchUsersQuery : SearchRequest, IRequest<Result<PaginationResult<UserDto>>>
{
    public string? Role { get; init; }

    public bool? IsActive { get; init; }
}
`;
}

/**
 * @param {string} ns
 */
function renderSearchHandler(ns) {
  return `using MediatR;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Queries.Search;

public sealed class SearchUsersQueryHandler
    : IRequestHandler<SearchUsersQuery, Result<PaginationResult<UserDto>>>
{
    private readonly IUserDirectory _directory;

    public SearchUsersQueryHandler(IUserDirectory directory)
    {
        _directory = directory;
    }

    public async Task<Result<PaginationResult<UserDto>>> Handle(
        SearchUsersQuery request,
        CancellationToken cancellationToken)
    {
        var criteria = new UserSearchCriteria(
            request.Page,
            request.PageSize,
            request.SearchTerm,
            request.Role,
            request.IsActive,
            request.SortBy,
            request.SortDirection);

        var result = await _directory.SearchAsync(criteria, cancellationToken);
        return Result.Success(result);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderSearchValidator(ns) {
  return `using FluentValidation;
using ${ns}.Application.Common.Models;

namespace ${ns}.Application.Features.Users.Queries.Search;

public sealed class SearchUsersQueryValidator : AbstractValidator<SearchUsersQuery>
{
    public SearchUsersQueryValidator()
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
 * @param {string} ns
 */
function renderGetByIdQuery(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Queries.GetById;

public sealed record GetUserByIdQuery(Guid Id) : IRequest<Result<UserDto>>;
`;
}

/**
 * @param {string} ns
 */
function renderGetByIdHandler(ns) {
  return `using MediatR;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Queries.GetById;

public sealed class GetUserByIdQueryHandler
    : IRequestHandler<GetUserByIdQuery, Result<UserDto>>
{
    private readonly IUserDirectory _directory;

    public GetUserByIdQueryHandler(IUserDirectory directory)
    {
        _directory = directory;
    }

    public async Task<Result<UserDto>> Handle(
        GetUserByIdQuery request,
        CancellationToken cancellationToken)
    {
        var user = await _directory.GetByIdAsync(request.Id, cancellationToken);

        if (user is null)
        {
            return Result.Failure<UserDto>(
                Error.NotFound("User.NotFound", $"User '{request.Id}' was not found."));
        }

        return Result.Success(user);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderCreateCommand(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Commands.Create;

public sealed record CreateUserCommand : IRequest<Result<UserDto>>
{
    public string UserName { get; init; } = string.Empty;

    public string Email { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;

    public IReadOnlyList<string> Roles { get; init; } = Array.Empty<string>();
}
`;
}

/**
 * @param {string} ns
 */
function renderCreateHandler(ns) {
  return `using MediatR;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Commands.Create;

public sealed class CreateUserCommandHandler
    : IRequestHandler<CreateUserCommand, Result<UserDto>>
{
    private readonly IUserDirectory _directory;

    public CreateUserCommandHandler(IUserDirectory directory)
    {
        _directory = directory;
    }

    public Task<Result<UserDto>> Handle(
        CreateUserCommand request,
        CancellationToken cancellationToken)
    {
        var input = new CreateUserInput(
            request.UserName,
            request.Email,
            request.Password,
            request.Roles);

        return _directory.CreateAsync(input, cancellationToken);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderCreateValidator(ns) {
  return `using FluentValidation;

namespace ${ns}.Application.Features.Users.Commands.Create;

public sealed class CreateUserCommandValidator : AbstractValidator<CreateUserCommand>
{
    public CreateUserCommandValidator()
    {
        RuleFor(command => command.UserName)
            .NotEmpty()
            .MaximumLength(256);

        RuleFor(command => command.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(256);

        RuleFor(command => command.Password)
            .NotEmpty()
            .MinimumLength(8)
            .MaximumLength(128);

        RuleForEach(command => command.Roles)
            .NotEmpty();
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderUpdateCommand(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Commands.Update;

public sealed record UpdateUserCommand : IRequest<Result<UserDto>>
{
    public Guid Id { get; init; }

    public string Email { get; init; } = string.Empty;

    public bool EmailConfirmed { get; init; }

    public bool IsActive { get; init; }
}
`;
}

/**
 * @param {string} ns
 */
function renderUpdateHandler(ns) {
  return `using MediatR;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Commands.Update;

public sealed class UpdateUserCommandHandler
    : IRequestHandler<UpdateUserCommand, Result<UserDto>>
{
    private readonly IUserDirectory _directory;

    public UpdateUserCommandHandler(IUserDirectory directory)
    {
        _directory = directory;
    }

    public Task<Result<UserDto>> Handle(
        UpdateUserCommand request,
        CancellationToken cancellationToken)
    {
        var input = new UpdateUserInput(
            request.Id,
            request.Email,
            request.EmailConfirmed,
            request.IsActive);

        return _directory.UpdateAsync(input, cancellationToken);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderUpdateValidator(ns) {
  return `using FluentValidation;

namespace ${ns}.Application.Features.Users.Commands.Update;

public sealed class UpdateUserCommandValidator : AbstractValidator<UpdateUserCommand>
{
    public UpdateUserCommandValidator()
    {
        RuleFor(command => command.Id)
            .NotEmpty();

        RuleFor(command => command.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(256);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderChangeRolesCommand(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Commands.ChangeRoles;

public sealed record ChangeUserRolesCommand : IRequest<Result<UserDto>>
{
    public Guid Id { get; init; }

    public IReadOnlyList<string> Roles { get; init; } = Array.Empty<string>();
}
`;
}

/**
 * @param {string} ns
 */
function renderChangeRolesHandler(ns) {
  return `using MediatR;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;

namespace ${ns}.Application.Features.Users.Commands.ChangeRoles;

public sealed class ChangeUserRolesCommandHandler
    : IRequestHandler<ChangeUserRolesCommand, Result<UserDto>>
{
    private readonly IUserDirectory _directory;

    public ChangeUserRolesCommandHandler(IUserDirectory directory)
    {
        _directory = directory;
    }

    public Task<Result<UserDto>> Handle(
        ChangeUserRolesCommand request,
        CancellationToken cancellationToken)
    {
        return _directory.ChangeRolesAsync(request.Id, request.Roles, cancellationToken);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderChangeRolesValidator(ns) {
  return `using FluentValidation;

namespace ${ns}.Application.Features.Users.Commands.ChangeRoles;

public sealed class ChangeUserRolesCommandValidator : AbstractValidator<ChangeUserRolesCommand>
{
    public ChangeUserRolesCommandValidator()
    {
        RuleFor(command => command.Id)
            .NotEmpty();

        RuleForEach(command => command.Roles)
            .NotEmpty();
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderRouter(ns) {
  return `namespace ${ns}.API.Routing;

public static partial class Router
{
    public static class Users
    {
        public const string Root = Rule + "/Users";
        public const string Search = Root + "/Search";
        public const string ById = Root + "/{id:guid}";
        public const string Create = Root;
        public const string Update = Root + "/{id:guid}";
        public const string ChangeRoles = Root + "/{id:guid}/Roles";
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderController(ns) {
  return `using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ${ns}.Application.Common.Authorization;
using ${ns}.API.Contracts;
using ${ns}.Application.Features.Users.Commands.ChangeRoles;
using ${ns}.Application.Features.Users.Commands.Create;
using ${ns}.Application.Features.Users.Queries.GetById;
using ${ns}.Application.Features.Users.Queries.Search;
using ${ns}.Application.Features.Users.Commands.Update;

namespace ${ns}.API.Controllers;

[ApiController]
[Authorize]
public sealed class UsersController : ApiControllerBase
{
    private readonly ISender _sender;

    public UsersController(ISender sender)
    {
        _sender = sender;
    }

    [HasPermission(PermissionConstants.UsersView)]
    [HttpPost(Router.Users.Search)]
    public async Task<IActionResult> Search(
        [FromBody] SearchUsersQuery query,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(query, cancellationToken);
        return ToActionResult(result);
    }

    [HasPermission(PermissionConstants.UsersView)]
    [HttpGet(Router.Users.ById)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetUserByIdQuery(id), cancellationToken);
        return ToActionResult(result);
    }

    [HasPermission(PermissionConstants.UsersManage)]
    [HttpPost(Router.Users.Create)]
    public async Task<IActionResult> Create(
        [FromBody] CreateUserCommand command,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(command, cancellationToken);
        return ToCreatedResult(result);
    }

    [HasPermission(PermissionConstants.UsersManage)]
    [HttpPut(Router.Users.Update)]
    public async Task<IActionResult> Update(
        Guid id,
        [FromBody] UpdateUserCommand command,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(command with { Id = id }, cancellationToken);
        return ToActionResult(result);
    }

    [HasPermission(PermissionConstants.UsersManage)]
    [HttpPut(Router.Users.ChangeRoles)]
    public async Task<IActionResult> ChangeRoles(
        Guid id,
        [FromBody] ChangeUserRolesCommand command,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(command with { Id = id }, cancellationToken);
        return ToActionResult(result);
    }
}
`;
}

/**
 * The Infrastructure adapter over ASP.NET Core Identity. Depends on the auth
 * module's ApplicationUser (IdentityUser&lt;Guid&gt;) and ApplicationRole types.
 * @param {string} ns
 */
function renderUserDirectoryImplementation(ns) {
  return `using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Users.DTOs;
using ${ns}.Infrastructure.Identity.Entities;

namespace ${ns}.Infrastructure.Identity.Services;

/// <summary>
/// Maps ASP.NET Core Identity users to safe DTOs. Requires the auth module's
/// ApplicationUser (IdentityUser&lt;Guid&gt;) and ApplicationRole (IdentityRole&lt;Guid&gt;).
/// </summary>
public sealed class UserDirectory : IUserDirectory
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly RoleManager<ApplicationRole> _roleManager;

    public UserDirectory(
        UserManager<ApplicationUser> userManager,
        RoleManager<ApplicationRole> roleManager)
    {
        _userManager = userManager;
        _roleManager = roleManager;
    }

    public async Task<PaginationResult<UserDto>> SearchAsync(
        UserSearchCriteria criteria,
        CancellationToken cancellationToken = default)
    {
        var query = _userManager.Users.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(criteria.SearchTerm))
        {
            var term = criteria.SearchTerm.Trim();
            query = query.Where(user =>
                (user.UserName != null && EF.Functions.Like(user.UserName, $"%{term}%")) ||
                (user.Email != null && EF.Functions.Like(user.Email, $"%{term}%")));
        }

        if (criteria.IsActive.HasValue)
        {
            var now = DateTimeOffset.UtcNow;
            query = criteria.IsActive.Value
                ? query.Where(user => user.LockoutEnd == null || user.LockoutEnd <= now)
                : query.Where(user => user.LockoutEnd != null && user.LockoutEnd > now);
        }

        query = query.OrderBy(user => user.UserName);

        var totalCount = await query.CountAsync(cancellationToken);
        var page = await query
            .Skip((criteria.Page - 1) * criteria.PageSize)
            .Take(criteria.PageSize)
            .ToListAsync(cancellationToken);

        /* Roles are resolved per user via the UserManager to honor the store. */
        var items = new List<UserDto>(page.Count);
        foreach (var user in page)
        {
            var roles = await _userManager.GetRolesAsync(user);
            if (!string.IsNullOrWhiteSpace(criteria.Role) &&
                !roles.Contains(criteria.Role))
            {
                continue;
            }

            items.Add(ToDto(user, roles));
        }

        return PaginationResult<UserDto>.Create(
            items,
            totalCount,
            criteria.Page,
            criteria.PageSize);
    }

    public async Task<UserDto?> GetByIdAsync(
        Guid userId,
        CancellationToken cancellationToken = default)
    {
        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null)
        {
            return null;
        }

        var roles = await _userManager.GetRolesAsync(user);
        return ToDto(user, roles);
    }

    public async Task<Result<UserDto>> CreateAsync(
        CreateUserInput input,
        CancellationToken cancellationToken = default)
    {
        var user = new ApplicationUser
        {
            UserName = input.UserName,
            Email = input.Email,
        };

        var created = await _userManager.CreateAsync(user, input.Password);
        if (!created.Succeeded)
        {
            return Result.Failure<UserDto>(ToError(created));
        }

        var rolesResult = await EnsureRolesAsync(user, input.Roles);
        if (rolesResult.IsFailure)
        {
            return Result.Failure<UserDto>(rolesResult.Error);
        }

        var roles = await _userManager.GetRolesAsync(user);
        return Result.Success(ToDto(user, roles));
    }

    public async Task<Result<UserDto>> UpdateAsync(
        UpdateUserInput input,
        CancellationToken cancellationToken = default)
    {
        var user = await _userManager.FindByIdAsync(input.UserId.ToString());
        if (user is null)
        {
            return Result.Failure<UserDto>(
                Error.NotFound("User.NotFound", $"User '{input.UserId}' was not found."));
        }

        user.Email = input.Email;
        user.EmailConfirmed = input.EmailConfirmed;

        var updated = await _userManager.UpdateAsync(user);
        if (!updated.Succeeded)
        {
            return Result.Failure<UserDto>(ToError(updated));
        }

        var lockout = input.IsActive ? (DateTimeOffset?)null : DateTimeOffset.MaxValue;
        await _userManager.SetLockoutEndDateAsync(user, lockout);

        var roles = await _userManager.GetRolesAsync(user);
        return Result.Success(ToDto(user, roles));
    }

    public async Task<Result<UserDto>> ChangeRolesAsync(
        Guid userId,
        IReadOnlyList<string> roles,
        CancellationToken cancellationToken = default)
    {
        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null)
        {
            return Result.Failure<UserDto>(
                Error.NotFound("User.NotFound", $"User '{userId}' was not found."));
        }

        var rolesResult = await EnsureRolesAsync(user, roles, replace: true);
        if (rolesResult.IsFailure)
        {
            return Result.Failure<UserDto>(rolesResult.Error);
        }

        var currentRoles = await _userManager.GetRolesAsync(user);
        return Result.Success(ToDto(user, currentRoles));
    }

    private async Task<Result> EnsureRolesAsync(
        ApplicationUser user,
        IReadOnlyList<string> roles,
        bool replace = false)
    {
        foreach (var role in roles.Distinct())
        {
            if (!await _roleManager.RoleExistsAsync(role))
            {
                return Result.Failure(
                    Error.Validation("User.UnknownRole", $"Role '{role}' does not exist."));
            }
        }

        if (replace)
        {
            var existing = await _userManager.GetRolesAsync(user);
            var toRemove = existing.Except(roles).ToArray();
            if (toRemove.Length > 0)
            {
                await _userManager.RemoveFromRolesAsync(user, toRemove);
            }
        }

        var current = await _userManager.GetRolesAsync(user);
        var toAdd = roles.Distinct().Except(current).ToArray();
        if (toAdd.Length > 0)
        {
            await _userManager.AddToRolesAsync(user, toAdd);
        }

        return Result.Success();
    }

    private static UserDto ToDto(ApplicationUser user, IEnumerable<string> roles)
    {
        var now = DateTimeOffset.UtcNow;
        var isActive = user.LockoutEnd is null || user.LockoutEnd <= now;

        return new UserDto
        {
            Id = user.Id,
            UserName = user.UserName ?? string.Empty,
            Email = user.Email ?? string.Empty,
            EmailConfirmed = user.EmailConfirmed,
            IsActive = isActive,
            LockoutEndUtc = user.LockoutEnd,
            Roles = roles.ToArray(),
        };
    }

    private static Error ToError(IdentityResult result)
    {
        var message = string.Join(
            " ",
            result.Errors.Select(error => error.Description));
        return Error.Validation("User.IdentityError", message);
    }
}
`;
}

/* ================================================================== */
/* React frontend                                                     */
/* ================================================================== */

/**
 * @param {object} config
 * @returns {{ relativePath: string, contents: string }[]}
 */
function planUsersReact(config) {
  const mod = (...segments) => paths.reactModule('users', ...segments);
  /** @type {{ relativePath: string, contents: string }[]} */
  const files = [
    { relativePath: mod('types', 'user.types.ts'), contents: reactTypes() },
    { relativePath: mod('services', 'users.routes.ts'), contents: reactRoutes() },
    { relativePath: mod('services', 'users.service.ts'), contents: reactService() },
    { relativePath: mod('slices', 'thunks', 'getUsers.thunk.ts'), contents: reactGetUsersThunk() },
    {
      relativePath: mod('slices', 'thunks', 'getUserById.thunk.ts'),
      contents: reactGetByIdThunk(),
    },
    {
      relativePath: mod('slices', 'thunks', 'createUser.thunk.ts'),
      contents: reactCreateThunk(),
    },
    {
      relativePath: mod('slices', 'thunks', 'updateUser.thunk.ts'),
      contents: reactUpdateThunk(),
    },
    {
      relativePath: mod('slices', 'thunks', 'changeUserRoles.thunk.ts'),
      contents: reactChangeRolesThunk(),
    },
    { relativePath: mod('slices', 'users.slice.ts'), contents: reactSlice() },
    { relativePath: mod('hooks', 'useUsersController.ts'), contents: reactController() },
    { relativePath: mod('components', 'UserTable.tsx'), contents: reactTable() },
    { relativePath: mod('components', 'UserRolesDialog.tsx'), contents: reactRolesDialog() },
    { relativePath: mod('pages', 'UsersPage.tsx'), contents: reactListPage() },
    { relativePath: mod('index.ts'), contents: reactIndex() },
  ];

  if (isNext(config)) {
    files.push({
      relativePath: paths.client('app', '(dashboard)', 'dashboard', 'users', 'page.tsx'),
      contents: 'export { default } from "@/modules/users/pages/UsersPage";\n',
    });
  } else {
    // Vite route wrapper is registered via the generated-routes registry; the
    // page component is exported from the module index for the router to use.
    files.push({
      relativePath: paths.client('app', 'router', 'routes', 'users.routes.tsx'),
      contents: reactViteRoute(),
    });
  }

  return files;
}

function reactTypes() {
  return `export type UserSummary = {
  id: string;
  userName: string;
  email: string;
  emailConfirmed: boolean;
  isActive: boolean;
  lockoutEndUtc: string | null;
  roles: string[];
};

export type UserSearchRequest = {
  page: number;
  pageSize: number;
  searchTerm?: string | null;
  role?: string | null;
  isActive?: boolean | null;
  sortBy?: string | null;
  sortDirection?: string | null;
};

export type CreateUserRequest = {
  userName: string;
  email: string;
  password: string;
  roles: string[];
};

export type UpdateUserRequest = {
  id: string;
  email: string;
  emailConfirmed: boolean;
  isActive: boolean;
};

export type ChangeUserRolesRequest = {
  id: string;
  roles: string[];
};
`;
}

function reactRoutes() {
  return `export const usersApiRoutes = {
  root: "/api/v1/Users",
  search: "/api/v1/Users/Search",
  byId: (id: string) => \`/api/v1/Users/\${id}\`,
  roles: (id: string) => \`/api/v1/Users/\${id}/Roles\`,
} as const;

export const usersAppRoutes = {
  dashboard: {
    list: "/dashboard/users",
  },
} as const;
`;
}

function reactService() {
  return `import { apiClient } from "@/lib/api/api-client";
import {
  normalizePagination,
  type PaginationResult,
} from "@/shared/state/pagination/pagination.types";
import { usersApiRoutes } from "./users.routes";
import type {
  ChangeUserRolesRequest,
  CreateUserRequest,
  UpdateUserRequest,
  UserSearchRequest,
  UserSummary,
} from "../types/user.types";

export const usersService = {
  async search(
    request: UserSearchRequest,
  ): Promise<PaginationResult<UserSummary>> {
    const response = await apiClient.post<PaginationResult<UserSummary>>(
      usersApiRoutes.search,
      request,
    );
    return normalizePagination(response.data);
  },

  async getById(id: string): Promise<UserSummary> {
    const response = await apiClient.get<UserSummary>(usersApiRoutes.byId(id));
    return response.data;
  },

  async create(input: CreateUserRequest): Promise<UserSummary> {
    const response = await apiClient.post<UserSummary>(usersApiRoutes.root, input);
    return response.data;
  },

  async update(input: UpdateUserRequest): Promise<UserSummary> {
    const response = await apiClient.put<UserSummary>(
      usersApiRoutes.byId(input.id),
      input,
    );
    return response.data;
  },

  async changeRoles(input: ChangeUserRolesRequest): Promise<UserSummary> {
    const response = await apiClient.put<UserSummary>(
      usersApiRoutes.roles(input.id),
      input,
    );
    return response.data;
  },
};
`;
}

function reactGetUsersThunk() {
  return `import { createAsyncThunk } from "@reduxjs/toolkit";
import { getErrorMessage } from "@/shared/utils/get-error-message";
import type { PaginationResult } from "@/shared/state/pagination/pagination.types";
import { usersService } from "../../services/users.service";
import type {
  UserSearchRequest,
  UserSummary,
} from "../../types/user.types";

export const getUsers = createAsyncThunk<
  PaginationResult<UserSummary>,
  UserSearchRequest,
  { rejectValue: string }
>("users/getUsers", async (request, { rejectWithValue }) => {
  try {
    return await usersService.search(request);
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});
`;
}

function reactGetByIdThunk() {
  return `import { createAsyncThunk } from "@reduxjs/toolkit";
import { getErrorMessage } from "@/shared/utils/get-error-message";
import { usersService } from "../../services/users.service";
import type { UserSummary } from "../../types/user.types";

export const getUserById = createAsyncThunk<
  UserSummary,
  string,
  { rejectValue: string }
>("users/getUserById", async (id, { rejectWithValue }) => {
  try {
    return await usersService.getById(id);
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});
`;
}

function reactCreateThunk() {
  return `import { createAsyncThunk } from "@reduxjs/toolkit";
import { getErrorMessage } from "@/shared/utils/get-error-message";
import { usersService } from "../../services/users.service";
import type {
  CreateUserRequest,
  UserSummary,
} from "../../types/user.types";

export const createUser = createAsyncThunk<
  UserSummary,
  CreateUserRequest,
  { rejectValue: string }
>("users/createUser", async (input, { rejectWithValue }) => {
  try {
    return await usersService.create(input);
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});
`;
}

function reactUpdateThunk() {
  return `import { createAsyncThunk } from "@reduxjs/toolkit";
import { getErrorMessage } from "@/shared/utils/get-error-message";
import { usersService } from "../../services/users.service";
import type {
  UpdateUserRequest,
  UserSummary,
} from "../../types/user.types";

export const updateUser = createAsyncThunk<
  UserSummary,
  UpdateUserRequest,
  { rejectValue: string }
>("users/updateUser", async (input, { rejectWithValue }) => {
  try {
    return await usersService.update(input);
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});
`;
}

function reactChangeRolesThunk() {
  return `import { createAsyncThunk } from "@reduxjs/toolkit";
import { getErrorMessage } from "@/shared/utils/get-error-message";
import { usersService } from "../../services/users.service";
import type {
  ChangeUserRolesRequest,
  UserSummary,
} from "../../types/user.types";

export const changeUserRoles = createAsyncThunk<
  UserSummary,
  ChangeUserRolesRequest,
  { rejectValue: string }
>("users/changeUserRoles", async (input, { rejectWithValue }) => {
  try {
    return await usersService.changeRoles(input);
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});
`;
}

function reactSlice() {
  return `import { createSlice } from "@reduxjs/toolkit";
import type { PaginationResult } from "@/shared/state/pagination/pagination.types";
import type { UserSummary } from "../types/user.types";
import { getUsers } from "./thunks/getUsers.thunk";
import { getUserById } from "./thunks/getUserById.thunk";
import { createUser } from "./thunks/createUser.thunk";
import { updateUser } from "./thunks/updateUser.thunk";
import { changeUserRoles } from "./thunks/changeUserRoles.thunk";

type UsersState = {
  items: UserSummary[];
  selected: UserSummary | null;
  pagination: PaginationResult<UserSummary> | null;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;
};

const initialState: UsersState = {
  items: [],
  selected: null,
  pagination: null,
  isLoading: false,
  isSubmitting: false,
  error: null,
};

function upsert(state: UsersState, user: UserSummary) {
  state.selected = user;
  const exists = state.items.some((item) => item.id === user.id);
  state.items = exists
    ? state.items.map((item) => (item.id === user.id ? user : item))
    : [user, ...state.items];
}

const usersSlice = createSlice({
  name: "users",
  initialState,
  reducers: {
    clearUsersError(state) {
      state.error = null;
    },
    clearSelectedUser(state) {
      state.selected = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getUsers.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(getUsers.fulfilled, (state, action) => {
        state.isLoading = false;
        state.items = action.payload.data;
        state.pagination = action.payload;
      })
      .addCase(getUsers.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload ?? "Unable to load users";
      })
      .addCase(getUserById.fulfilled, (state, action) => {
        state.selected = action.payload;
      })
      .addCase(createUser.pending, (state) => {
        state.isSubmitting = true;
        state.error = null;
      })
      .addCase(createUser.fulfilled, (state, action) => {
        state.isSubmitting = false;
        upsert(state, action.payload);
      })
      .addCase(createUser.rejected, (state, action) => {
        state.isSubmitting = false;
        state.error = action.payload ?? "Unable to create user";
      })
      .addCase(updateUser.fulfilled, (state, action) => {
        upsert(state, action.payload);
      })
      .addCase(changeUserRoles.fulfilled, (state, action) => {
        upsert(state, action.payload);
      });
  },
});

export const { clearUsersError, clearSelectedUser } = usersSlice.actions;
export default usersSlice.reducer;
`;
}

function reactController() {
  return `"use client";

import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { notify } from "@/shared/utils/toast";
import { getUsers } from "../slices/thunks/getUsers.thunk";
import { createUser } from "../slices/thunks/createUser.thunk";
import { updateUser } from "../slices/thunks/updateUser.thunk";
import { changeUserRoles } from "../slices/thunks/changeUserRoles.thunk";
import type {
  ChangeUserRolesRequest,
  CreateUserRequest,
  UpdateUserRequest,
  UserSearchRequest,
} from "../types/user.types";

export function useUsersController() {
  const dispatch = useAppDispatch();
  const { items, selected, pagination, isLoading, isSubmitting, error } =
    useAppSelector((state) => state.users);

  const load = useCallback(
    (request: UserSearchRequest) => {
      void dispatch(getUsers(request));
    },
    [dispatch],
  );

  const create = useCallback(
    async (input: CreateUserRequest) => {
      const result = await dispatch(createUser(input));
      if (createUser.fulfilled.match(result)) {
        notify.success("User created");
        return result.payload;
      }
      notify.error(result.payload ?? "Unable to create user");
      return null;
    },
    [dispatch],
  );

  const update = useCallback(
    async (input: UpdateUserRequest) => {
      const result = await dispatch(updateUser(input));
      if (updateUser.fulfilled.match(result)) {
        notify.success("User updated");
        return result.payload;
      }
      notify.error(result.payload ?? "Unable to update user");
      return null;
    },
    [dispatch],
  );

  const setRoles = useCallback(
    async (input: ChangeUserRolesRequest) => {
      const result = await dispatch(changeUserRoles(input));
      if (changeUserRoles.fulfilled.match(result)) {
        notify.success("Roles updated");
        return result.payload;
      }
      notify.error(result.payload ?? "Unable to update roles");
      return null;
    },
    [dispatch],
  );

  return {
    items,
    selected,
    pagination,
    isLoading,
    isSubmitting,
    error,
    load,
    create,
    update,
    setRoles,
  };
}
`;
}

function reactTable() {
  return `"use client";

import type { UserSummary } from "../types/user.types";

type UserTableProps = {
  items: UserSummary[];
  onEditRoles?: (user: UserSummary) => void;
  onToggleActive?: (user: UserSummary) => void;
};

export function UserTable({ items, onEditRoles, onToggleActive }: UserTableProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-600">
        No users found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50 text-zinc-700">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">User</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Email</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Roles</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white text-zinc-900">
          {items.map((user) => (
            <tr key={user.id}>
              <td className="px-3 py-2">{user.userName}</td>
              <td className="px-3 py-2">{user.email}</td>
              <td className="px-3 py-2">{user.roles.join(", ") || "—"}</td>
              <td className="px-3 py-2">
                <span
                  className={
                    user.isActive ? "text-green-700" : "text-red-700"
                  }
                >
                  {user.isActive ? "Active" : "Disabled"}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    className="text-sm text-zinc-900 underline"
                    onClick={() => onEditRoles?.(user)}
                  >
                    Roles
                  </button>
                  <button
                    type="button"
                    className="text-sm text-zinc-700 underline"
                    onClick={() => onToggleActive?.(user)}
                  >
                    {user.isActive ? "Disable" : "Enable"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
`;
}

function reactRolesDialog() {
  return `"use client";

import { useEffect, useState } from "react";
import type { UserSummary } from "../types/user.types";

type UserRolesDialogProps = {
  user: UserSummary | null;
  availableRoles: string[];
  onClose: () => void;
  onSave: (roles: string[]) => void | Promise<void>;
};

export function UserRolesDialog({
  user,
  availableRoles,
  onClose,
  onSave,
}: UserRolesDialogProps) {
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    setRoles(user?.roles ?? []);
  }, [user]);

  if (!user) {
    return null;
  }

  const toggle = (role: string) => {
    setRoles((current) =>
      current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role],
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-zinc-900">
          Roles for {user.userName}
        </h2>
        <div className="mt-4 flex flex-col gap-2">
          {availableRoles.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm text-zinc-800">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-zinc-300"
                checked={roles.includes(role)}
                onChange={() => toggle(role)}
              />
              {role}
            </label>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white"
            onClick={() => {
              void onSave(roles);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
`;
}

function reactListPage() {
  return `"use client";

import { useEffect, useState } from "react";
import { UserTable } from "../components/UserTable";
import { UserRolesDialog } from "../components/UserRolesDialog";
import { useUsersController } from "../hooks/useUsersController";
import type { UserSummary } from "../types/user.types";

const AVAILABLE_ROLES = ["Admin", "Editor", "User"];

export default function UsersPage() {
  const { items, pagination, isLoading, error, load, update, setRoles } =
    useUsersController();
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [rolesTarget, setRolesTarget] = useState<UserSummary | null>(null);
  const pageSize = 10;

  useEffect(() => {
    load({ page, pageSize, searchTerm: searchTerm.trim() || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold text-zinc-900">Users</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Search users, manage roles, and enable or disable accounts.
        </p>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          load({ page: 1, pageSize, searchTerm: searchTerm.trim() || null });
        }}
      >
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm text-zinc-800">
          Search
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search users..."
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900"
        >
          Apply
        </button>
      </form>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-zinc-600">Loading users...</p>
      ) : (
        <UserTable
          items={items}
          onEditRoles={setRolesTarget}
          onToggleActive={(user) => {
            void update({
              id: user.id,
              email: user.email,
              emailConfirmed: user.emailConfirmed,
              isActive: !user.isActive,
            });
          }}
        />
      )}

      {pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-700">
          <p>
            Page {pagination.currentPage} of {pagination.totalPages} ·{" "}
            {pagination.totalCount} total
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-50"
              disabled={!pagination.hasPreviousPage || isLoading}
              onClick={() => {
                const nextPage = Math.max(1, page - 1);
                setPage(nextPage);
                load({ page: nextPage, pageSize, searchTerm: searchTerm.trim() || null });
              }}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-50"
              disabled={!pagination.hasNextPage || isLoading}
              onClick={() => {
                const nextPage = page + 1;
                setPage(nextPage);
                load({ page: nextPage, pageSize, searchTerm: searchTerm.trim() || null });
              }}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <UserRolesDialog
        user={rolesTarget}
        availableRoles={AVAILABLE_ROLES}
        onClose={() => setRolesTarget(null)}
        onSave={async (roles) => {
          if (rolesTarget) {
            await setRoles({ id: rolesTarget.id, roles });
            setRolesTarget(null);
          }
        }}
      />
    </main>
  );
}
`;
}

function reactViteRoute() {
  return `import UsersPage from "@/modules/users/pages/UsersPage";

export const usersRoute = {
  path: "users",
  Component: UsersPage,
};
`;
}

function reactIndex() {
  return `export { default as usersReducer } from "./slices/users.slice";
export { default as UsersPage } from "./pages/UsersPage";
export { useUsersController } from "./hooks/useUsersController";
export { usersService } from "./services/users.service";
export { usersApiRoutes, usersAppRoutes } from "./services/users.routes";
export type { UserSummary } from "./types/user.types";
`;
}

/* ================================================================== */
/* Angular frontend                                                   */
/* ================================================================== */

/**
 * @param {object} config
 * @returns {{ relativePath: string, contents: string }[]}
 */
function planUsersAngular(config) {
  const base = (...segments) => paths.angularFeature('users', ...segments);
  return [
    { relativePath: base('models', 'user.model.ts'), contents: ngModel() },
    { relativePath: base('services', 'user.service.ts'), contents: ngService() },
    { relativePath: base('store', 'user.state.ts'), contents: ngState() },
    { relativePath: base('store', 'user.actions.ts'), contents: ngActions() },
    { relativePath: base('store', 'user.reducer.ts'), contents: ngReducer() },
    { relativePath: base('store', 'user.effects.ts'), contents: ngEffects() },
    { relativePath: base('store', 'user.selectors.ts'), contents: ngSelectors() },
    {
      relativePath: base('pages', 'users-page', 'users-page.component.ts'),
      contents: ngListPage(),
    },
    { relativePath: base('user.routes.ts'), contents: ngRoutes() },
  ];
}

function ngModel() {
  return `import type { PaginationResult } from "../../../shared/models/pagination";

export type UserSummary = {
  id: string;
  userName: string;
  email: string;
  emailConfirmed: boolean;
  isActive: boolean;
  lockoutEndUtc: string | null;
  roles: string[];
};

export type UserQuery = {
  page: number;
  pageSize: number;
  searchTerm?: string | null;
  role?: string | null;
  isActive?: boolean | null;
};

export type CreateUserInput = {
  userName: string;
  email: string;
  password: string;
  roles: string[];
};

export type UpdateUserInput = {
  id: string;
  email: string;
  emailConfirmed: boolean;
  isActive: boolean;
};

export type ChangeUserRolesInput = {
  id: string;
  roles: string[];
};

export type UserPage = PaginationResult<UserSummary>;
`;
}

function ngService() {
  return `import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import type { PaginationResult } from "../../../shared/models/pagination";
import type {
  ChangeUserRolesInput,
  CreateUserInput,
  UpdateUserInput,
  UserQuery,
  UserSummary,
} from "../models/user.model";

const basePath = "/api/v1/Users";

@Injectable({ providedIn: "root" })
export class UserService {
  constructor(private readonly http: HttpClient) {}

  search(query: UserQuery): Observable<PaginationResult<UserSummary>> {
    return this.http.post<PaginationResult<UserSummary>>(\`\${basePath}/Search\`, query);
  }

  getById(id: string): Observable<UserSummary> {
    return this.http.get<UserSummary>(\`\${basePath}/\${id}\`);
  }

  create(input: CreateUserInput): Observable<UserSummary> {
    return this.http.post<UserSummary>(basePath, input);
  }

  update(input: UpdateUserInput): Observable<UserSummary> {
    return this.http.put<UserSummary>(\`\${basePath}/\${input.id}\`, input);
  }

  changeRoles(input: ChangeUserRolesInput): Observable<UserSummary> {
    return this.http.put<UserSummary>(\`\${basePath}/\${input.id}/Roles\`, input);
  }
}
`;
}

function ngState() {
  return `import type { PaginationResult } from "../../../shared/models/pagination";
import type { UserSummary } from "../models/user.model";

export const usersFeatureKey = "users";

export type RequestStatus = "idle" | "loading" | "succeeded" | "failed";

export type UsersState = {
  items: UserSummary[];
  selected: UserSummary | null;
  pagination: PaginationResult<UserSummary> | null;
  status: RequestStatus;
  error: string | null;
};

export const initialUsersState: UsersState = {
  items: [],
  selected: null,
  pagination: null,
  status: "idle",
  error: null,
};
`;
}

function ngActions() {
  return `import { createActionGroup, emptyProps, props } from "@ngrx/store";
import type { PaginationResult } from "../../../shared/models/pagination";
import type {
  ChangeUserRolesInput,
  CreateUserInput,
  UpdateUserInput,
  UserQuery,
  UserSummary,
} from "../models/user.model";

export const UserActions = createActionGroup({
  source: "Users",
  events: {
    "Load Users": props<{ query: UserQuery }>(),
    "Load Users Success": props<{ result: PaginationResult<UserSummary> }>(),
    "Load Users Failure": props<{ error: string }>(),
    "Create User": props<{ input: CreateUserInput }>(),
    "Create User Success": props<{ user: UserSummary }>(),
    "Create User Failure": props<{ error: string }>(),
    "Update User": props<{ input: UpdateUserInput }>(),
    "Update User Success": props<{ user: UserSummary }>(),
    "Update User Failure": props<{ error: string }>(),
    "Change Roles": props<{ input: ChangeUserRolesInput }>(),
    "Change Roles Success": props<{ user: UserSummary }>(),
    "Change Roles Failure": props<{ error: string }>(),
    "Clear Error": emptyProps(),
  },
});
`;
}

function ngReducer() {
  return `import { createReducer, on } from "@ngrx/store";
import type { UserSummary } from "../models/user.model";
import { UserActions } from "./user.actions";
import { initialUsersState } from "./user.state";

function upsert(items: UserSummary[], user: UserSummary): UserSummary[] {
  return items.some((item) => item.id === user.id)
    ? items.map((item) => (item.id === user.id ? user : item))
    : [user, ...items];
}

export const usersReducer = createReducer(
  initialUsersState,
  on(UserActions.loadUsers, (state) => ({
    ...state,
    status: "loading" as const,
    error: null,
  })),
  on(UserActions.loadUsersSuccess, (state, { result }) => ({
    ...state,
    status: "succeeded" as const,
    items: result.data,
    pagination: result,
  })),
  on(UserActions.loadUsersFailure, (state, { error }) => ({
    ...state,
    status: "failed" as const,
    error,
  })),
  on(
    UserActions.createUserSuccess,
    UserActions.updateUserSuccess,
    UserActions.changeRolesSuccess,
    (state, { user }) => ({
      ...state,
      status: "succeeded" as const,
      selected: user,
      items: upsert(state.items, user),
    }),
  ),
  on(
    UserActions.createUserFailure,
    UserActions.updateUserFailure,
    UserActions.changeRolesFailure,
    (state, { error }) => ({
      ...state,
      status: "failed" as const,
      error,
    }),
  ),
  on(UserActions.clearError, (state) => ({ ...state, error: null })),
);
`;
}

function ngEffects() {
  return `import { Injectable, inject } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { catchError, map, of, switchMap } from "rxjs";
import { getErrorMessage } from "../../../shared/utils/get-error-message";
import { UserService } from "../services/user.service";
import { UserActions } from "./user.actions";

@Injectable()
export class UserEffects {
  private readonly actions$ = inject(Actions);
  private readonly userService = inject(UserService);

  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UserActions.loadUsers),
      switchMap(({ query }) =>
        this.userService.search(query).pipe(
          map((result) => UserActions.loadUsersSuccess({ result })),
          catchError((error: unknown) =>
            of(UserActions.loadUsersFailure({ error: getErrorMessage(error) })),
          ),
        ),
      ),
    ),
  );

  createUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UserActions.createUser),
      switchMap(({ input }) =>
        this.userService.create(input).pipe(
          map((user) => UserActions.createUserSuccess({ user })),
          catchError((error: unknown) =>
            of(UserActions.createUserFailure({ error: getErrorMessage(error) })),
          ),
        ),
      ),
    ),
  );

  updateUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UserActions.updateUser),
      switchMap(({ input }) =>
        this.userService.update(input).pipe(
          map((user) => UserActions.updateUserSuccess({ user })),
          catchError((error: unknown) =>
            of(UserActions.updateUserFailure({ error: getErrorMessage(error) })),
          ),
        ),
      ),
    ),
  );

  changeRoles$ = createEffect(() =>
    this.actions$.pipe(
      ofType(UserActions.changeRoles),
      switchMap(({ input }) =>
        this.userService.changeRoles(input).pipe(
          map((user) => UserActions.changeRolesSuccess({ user })),
          catchError((error: unknown) =>
            of(UserActions.changeRolesFailure({ error: getErrorMessage(error) })),
          ),
        ),
      ),
    ),
  );
}
`;
}

function ngSelectors() {
  return `import { createFeatureSelector, createSelector } from "@ngrx/store";
import { usersFeatureKey, type UsersState } from "./user.state";

export const selectUsersState = createFeatureSelector<UsersState>(usersFeatureKey);

export const selectUsers = createSelector(selectUsersState, (state) => state.items);
export const selectSelectedUser = createSelector(
  selectUsersState,
  (state) => state.selected,
);
export const selectUsersStatus = createSelector(
  selectUsersState,
  (state) => state.status,
);
export const selectUsersError = createSelector(
  selectUsersState,
  (state) => state.error,
);
export const selectUsersPagination = createSelector(
  selectUsersState,
  (state) => state.pagination,
);
`;
}

function ngListPage() {
  return `import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Store } from "@ngrx/store";
import { UserActions } from "../../store/user.actions";
import {
  selectUsers,
  selectUsersError,
  selectUsersPagination,
} from "../../store/user.selectors";
import type { UserSummary } from "../../models/user.model";

const AVAILABLE_ROLES = ["Admin", "Editor", "User"];

@Component({
  selector: "app-users-page",
  standalone: true,
  imports: [FormsModule],
  template: \`
    <main class="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 class="text-3xl font-semibold text-zinc-900">Users</h1>
        <p class="mt-1 text-sm text-zinc-600">
          Search users, manage roles, and enable or disable accounts.
        </p>
      </header>

      <form class="flex flex-wrap items-end gap-3" (ngSubmit)="applySearch()">
        <label class="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm text-zinc-800">
          Search
          <input
            type="search"
            class="rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900"
            placeholder="Search users..."
            [ngModel]="term()"
            (ngModelChange)="term.set($event)"
            name="search"
          />
        </label>
        <button
          type="submit"
          class="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900"
        >
          Apply
        </button>
      </form>

      @if (error(); as message) {
        <p class="text-sm text-red-600" role="alert">{{ message }}</p>
      }

      @if (users().length === 0) {
        <p class="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-600">
          No users found.
        </p>
      } @else {
        <div class="overflow-x-auto rounded-md border border-zinc-200">
          <table class="min-w-full divide-y divide-zinc-200 text-sm">
            <thead class="bg-zinc-50 text-zinc-700">
              <tr>
                <th class="px-3 py-2 text-left font-medium">User</th>
                <th class="px-3 py-2 text-left font-medium">Email</th>
                <th class="px-3 py-2 text-left font-medium">Roles</th>
                <th class="px-3 py-2 text-left font-medium">Status</th>
                <th class="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-100 bg-white text-zinc-900">
              @for (user of users(); track user.id) {
                <tr>
                  <td class="px-3 py-2">{{ user.userName }}</td>
                  <td class="px-3 py-2">{{ user.email }}</td>
                  <td class="px-3 py-2">{{ user.roles.join(", ") || "—" }}</td>
                  <td class="px-3 py-2">
                    <span [class]="user.isActive ? 'text-green-700' : 'text-red-700'">
                      {{ user.isActive ? "Active" : "Disabled" }}
                    </span>
                  </td>
                  <td class="px-3 py-2">
                    <div class="flex justify-end gap-3">
                      <button
                        type="button"
                        class="text-sm text-zinc-900 underline"
                        (click)="openRoles(user)"
                      >
                        Roles
                      </button>
                      <button
                        type="button"
                        class="text-sm text-zinc-700 underline"
                        (click)="toggleActive(user)"
                      >
                        {{ user.isActive ? "Disable" : "Enable" }}
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (rolesTarget(); as target) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div class="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
            <h2 class="text-lg font-semibold text-zinc-900">
              Roles for {{ target.userName }}
            </h2>
            <div class="mt-4 flex flex-col gap-2">
              @for (role of availableRoles; track role) {
                <label class="flex items-center gap-2 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-zinc-300"
                    [checked]="draftRoles().includes(role)"
                    (change)="toggleRole(role)"
                  />
                  {{ role }}
                </label>
              }
            </div>
            <div class="mt-6 flex justify-end gap-3">
              <button
                type="button"
                class="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-800"
                (click)="closeRoles()"
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white"
                (click)="saveRoles()"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      }
    </main>
  \`,
})
export class UsersPageComponent implements OnInit {
  private readonly store = inject(Store);

  readonly users = this.store.selectSignal(selectUsers);
  readonly pagination = this.store.selectSignal(selectUsersPagination);
  readonly error = this.store.selectSignal(selectUsersError);

  readonly term = signal("");
  readonly rolesTarget = signal<UserSummary | null>(null);
  readonly draftRoles = signal<string[]>([]);
  readonly availableRoles = AVAILABLE_ROLES;

  private page = 1;
  private readonly pageSize = 10;

  ngOnInit(): void {
    this.load();
  }

  applySearch(): void {
    this.page = 1;
    this.load();
  }

  toggleActive(user: UserSummary): void {
    this.store.dispatch(
      UserActions.updateUser({
        input: {
          id: user.id,
          email: user.email,
          emailConfirmed: user.emailConfirmed,
          isActive: !user.isActive,
        },
      }),
    );
  }

  openRoles(user: UserSummary): void {
    this.rolesTarget.set(user);
    this.draftRoles.set([...user.roles]);
  }

  closeRoles(): void {
    this.rolesTarget.set(null);
  }

  toggleRole(role: string): void {
    this.draftRoles.update((roles) =>
      roles.includes(role)
        ? roles.filter((item) => item !== role)
        : [...roles, role],
    );
  }

  saveRoles(): void {
    const target = this.rolesTarget();
    if (!target) {
      return;
    }

    this.store.dispatch(
      UserActions.changeRoles({ input: { id: target.id, roles: this.draftRoles() } }),
    );
    this.closeRoles();
  }

  private load(): void {
    this.store.dispatch(
      UserActions.loadUsers({
        query: {
          page: this.page,
          pageSize: this.pageSize,
          searchTerm: this.term().trim() || null,
        },
      }),
    );
  }
}
`;
}

function ngRoutes() {
  return `import { Routes } from "@angular/router";
import { provideEffects } from "@ngrx/effects";
import { provideState } from "@ngrx/store";
import { UsersPageComponent } from "./pages/users-page/users-page.component";
import { UserEffects } from "./store/user.effects";
import { usersReducer } from "./store/user.reducer";
import { usersFeatureKey } from "./store/user.state";

export const usersRoutes: Routes = [
  {
    path: "",
    providers: [
      provideState(usersFeatureKey, usersReducer),
      provideEffects(UserEffects),
    ],
    children: [{ path: "", component: UsersPageComponent }],
  },
];
`;
}
