/**
 * V4 Notifications module generator.
 *
 * Backend:
 *   - Notification entity (UserId, Type, Title, Message, TargetUrl?, IsRead,
 *     ReadAtUtc?, CreatedAtUtc) indexed on (UserId, IsRead, CreatedAtUtc)
 *   - GetMyNotifications / GetUnreadCount / MarkAsRead / MarkAllAsRead — every
 *     one resolves the acting user from ICurrentUser.UserId and NEVER trusts a
 *     client-supplied user id (ownership is always enforced server-side)
 *   - Admin SendNotificationToUser guarded by Notifications.Send
 *   - INotificationService abstraction + Infrastructure implementation
 *
 * Frontend: notification bell + unread badge + list page (React and Angular).
 */

import {
  paths,
  isReact,
  isAngular,
  isNext,
  dbSetUpdates,
  currentUserAbstraction,
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
export function planNotificationsModule(config) {
  const ns = config.projectName;

  /** @type {{ relativePath: string, contents: string, writeMode?: string }[]} */
  const files = [];
  /** @type {{ relativePath: string, update: (existing: string) => string }[]} */
  const registryUpdates = [];

  registryUpdates.push(registerFeaturePermissions(config, 'Notifications', ['Send']));
  registryUpdates.push(...dbSetUpdates(ns, 'Notification', 'Notifications'));
  registryUpdates.push(
    routerUpdate(ns, 'Notifications', 'Notifications', [
      { name: 'Root' },
      { name: 'Mine', suffix: '/Mine' },
      { name: 'UnreadCount', suffix: '/UnreadCount' },
      { name: 'Read', suffix: '/{id:guid}/Read' },
      { name: 'ReadAll', suffix: '/ReadAll' },
      { name: 'Send', suffix: '/Send' },
    ]),
  );

  // Backend ---------------------------------------------------------
  files.push(...planNotificationsBackend(ns));
  const { file: registrationFile, registration } = moduleRegistrationFile({
    projectName: ns,
    moduleName: 'Notifications',
    usings: [
      `using ${ns}.Application.Abstractions.Notifications;`,
      `using ${ns}.Infrastructure.Notifications;`,
    ],
    body: ['        services.AddScoped<INotificationService, NotificationService>();'],
  });
  files.push(registrationFile);

  // Frontend --------------------------------------------------------
  if (isReact(config)) {
    files.push(...planNotificationsReact(config));
    registryUpdates.push({
      relativePath: paths.client('store', 'generated-reducers.ts'),
      update: reactReducerUpdate({
        reducerKey: 'notifications',
        importName: 'notificationsReducer',
        importPath: '@/modules/notifications/slices/notifications.slice',
      }),
    });
    registryUpdates.push({
      relativePath: paths.client('navigation', 'generated-dashboard-nav.ts'),
      update: reactDashboardNavUpdate({
        navKey: 'notifications',
        label: 'Notifications',
        href: '/dashboard/notifications',
        icon: 'Bell',
      }),
    });
  }

  if (isAngular(config)) {
    files.push(...planNotificationsAngular(config));
    const angularConfig = {
      feature: {
        kebabName: 'notification',
        kebabPluralName: 'notifications',
        camelName: 'notifications',
        camelPluralName: 'notifications',
        pluralName: 'Notifications',
      },
      surface: { dashboard: true, public: false },
      labels: { enPlural: 'Notifications' },
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
    id: 'notifications',
    requires: ['auth'],
    files,
    registryUpdates,
    registrations: [registration],
    notes: [
      'My-notification queries/commands always use ICurrentUser.UserId; client-provided user ids are ignored.',
      'Only SendNotificationToUser targets another user, and it requires the Notifications.Send permission.',
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
function planNotificationsBackend(ns) {
  const feature = (...segments) =>
    paths.application('Features', 'Notifications', ...segments);

  /** @type {{ relativePath: string, contents: string, writeMode?: string }[]} */
  const files = [];

  files.push({
    relativePath: paths.domain('Entities', 'Notification.cs'),
    contents: renderNotificationEntity(ns),
  });

  files.push({
    relativePath: paths.infrastructure(
      'Persistence',
      'Configurations',
      'NotificationConfiguration.cs',
    ),
    contents: renderNotificationConfiguration(ns),
  });

  files.push(...currentUserAbstraction(ns));

  files.push(
    {
      relativePath: paths.application(
        'Abstractions',
        'Notifications',
        'INotificationService.cs',
      ),
      contents: renderNotificationServiceAbstraction(ns),
    },
    {
      relativePath: paths.infrastructure('Notifications', 'Services', 'NotificationService.cs'),
      contents: renderNotificationServiceImplementation(ns),
    },
  );

  files.push(
    { relativePath: feature('DTOs', 'NotificationDto.cs'), contents: renderNotificationDto(ns) },
    {
      relativePath: feature('Mapping', 'NotificationMappings.cs'),
      contents: renderNotificationMappings(ns),
    },
    {
      relativePath: feature('Queries', 'GetMy', 'GetMyNotificationsQuery.cs'),
      contents: renderGetMyQuery(ns),
    },
    {
      relativePath: feature('Queries', 'GetMy', 'GetMyNotificationsQueryHandler.cs'),
      contents: renderGetMyHandler(ns),
    },
    {
      relativePath: feature('Queries', 'GetUnreadCount', 'GetUnreadCountQuery.cs'),
      contents: renderUnreadCountQuery(ns),
    },
    {
      relativePath: feature('Queries', 'GetUnreadCount', 'GetUnreadCountQueryHandler.cs'),
      contents: renderUnreadCountHandler(ns),
    },
    {
      relativePath: feature('Commands', 'MarkAsRead', 'MarkAsReadCommand.cs'),
      contents: renderMarkAsReadCommand(ns),
    },
    {
      relativePath: feature('Commands', 'MarkAsRead', 'MarkAsReadCommandHandler.cs'),
      contents: renderMarkAsReadHandler(ns),
    },
    {
      relativePath: feature('Commands', 'MarkAllAsRead', 'MarkAllAsReadCommand.cs'),
      contents: renderMarkAllAsReadCommand(ns),
    },
    {
      relativePath: feature('Commands', 'MarkAllAsRead', 'MarkAllAsReadCommandHandler.cs'),
      contents: renderMarkAllAsReadHandler(ns),
    },
    {
      relativePath: feature('Commands', 'Send', 'SendNotificationToUserCommand.cs'),
      contents: renderSendCommand(ns),
    },
    {
      relativePath: feature('Commands', 'Send', 'SendNotificationToUserCommandHandler.cs'),
      contents: renderSendHandler(ns),
    },
    {
      relativePath: feature('Commands', 'Send', 'SendNotificationToUserCommandValidator.cs'),
      contents: renderSendValidator(ns),
    },
    {
      relativePath: paths.api('Controllers', 'NotificationsController.cs'),
      contents: renderController(ns),
    },
  );

  return files;
}

/**
 * @param {string} ns
 */
function renderNotificationEntity(ns) {
  return `namespace ${ns}.Domain.Entities;

public sealed class Notification
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }

    public string Type { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    public string? TargetUrl { get; set; }

    public bool IsRead { get; set; }

    public DateTime? ReadAtUtc { get; set; }

    public DateTime CreatedAtUtc { get; set; }
}
`;
}

/**
 * @param {string} ns
 */
function renderNotificationConfiguration(ns) {
  return `using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ${ns}.Domain.Entities;

namespace ${ns}.Infrastructure.Persistence.Configurations;

public sealed class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.ToTable("Notifications");
        builder.HasKey(entity => entity.Id);

        builder.Property(entity => entity.Type)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(entity => entity.Title)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(entity => entity.Message)
            .IsRequired()
            .HasMaxLength(2000);

        builder.Property(entity => entity.TargetUrl)
            .HasMaxLength(2048);

        // Supports the primary access pattern: a user's unread inbox, newest first.
        builder.HasIndex(entity => new
        {
            entity.UserId,
            entity.IsRead,
            entity.CreatedAtUtc,
        });
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderNotificationServiceAbstraction(ns) {
  return `namespace ${ns}.Application.Abstractions.Notifications;

public sealed record NotificationRequest(
    Guid UserId,
    string Type,
    string Title,
    string Message,
    string? TargetUrl);

public interface INotificationService
{
    Task SendAsync(NotificationRequest request, CancellationToken cancellationToken = default);
}
`;
}

/**
 * @param {string} ns
 */
function renderNotificationServiceImplementation(ns) {
  return `using ${ns}.Application.Abstractions.Notifications;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Domain.Entities;

namespace ${ns}.Infrastructure.Notifications.Services;

public sealed class NotificationService : INotificationService
{
    private readonly IApplicationDbContext _dbContext;

    public NotificationService(IApplicationDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task SendAsync(
        NotificationRequest request,
        CancellationToken cancellationToken = default)
    {
        var notification = new Notification
        {
            UserId = request.UserId,
            Type = request.Type,
            Title = request.Title,
            Message = request.Message,
            TargetUrl = request.TargetUrl,
            IsRead = false,
            CreatedAtUtc = DateTime.UtcNow,
        };

        _dbContext.Notifications.Add(notification);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderNotificationDto(ns) {
  return `namespace ${ns}.Application.Features.Notifications.DTOs;

public sealed record NotificationDto
{
    public Guid Id { get; init; }

    public string Type { get; init; } = string.Empty;

    public string Title { get; init; } = string.Empty;

    public string Message { get; init; } = string.Empty;

    public string? TargetUrl { get; init; }

    public bool IsRead { get; init; }

    public DateTime? ReadAtUtc { get; init; }

    public DateTime CreatedAtUtc { get; init; }
}
`;
}

/**
 * @param {string} ns
 */
function renderNotificationMappings(ns) {
  return `using ${ns}.Domain.Entities;
using ${ns}.Application.Features.Notifications.DTOs;

namespace ${ns}.Application.Features.Notifications.Mapping;

public static class NotificationMappings
{
    public static NotificationDto ToDto(Notification entity)
    {
        return new NotificationDto
        {
            Id = entity.Id,
            Type = entity.Type,
            Title = entity.Title,
            Message = entity.Message,
            TargetUrl = entity.TargetUrl,
            IsRead = entity.IsRead,
            ReadAtUtc = entity.ReadAtUtc,
            CreatedAtUtc = entity.CreatedAtUtc,
        };
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderGetMyQuery(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Notifications.DTOs;

namespace ${ns}.Application.Features.Notifications.Queries.GetMy;

/// <summary>
/// Returns the current user's notifications. The user id is resolved from
/// ICurrentUser server-side; there is intentionally no UserId on this query.
/// </summary>
public sealed class GetMyNotificationsQuery
    : PaginationRequest, IRequest<Result<PaginationResult<NotificationDto>>>
{
    public bool UnreadOnly { get; init; }
}
`;
}

/**
 * @param {string} ns
 */
function renderGetMyHandler(ns) {
  return `using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Models;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Notifications.DTOs;
using ${ns}.Application.Features.Notifications.Mapping;
using ${ns}.Domain.Entities;

namespace ${ns}.Application.Features.Notifications.Queries.GetMy;

public sealed class GetMyNotificationsQueryHandler
    : IRequestHandler<GetMyNotificationsQuery, Result<PaginationResult<NotificationDto>>>
{
    private readonly IApplicationDbContext _dbContext;
    private readonly ICurrentUser _currentUser;

    public GetMyNotificationsQueryHandler(
        IApplicationDbContext dbContext,
        ICurrentUser currentUser)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
    }

    public async Task<Result<PaginationResult<NotificationDto>>> Handle(
        GetMyNotificationsQuery request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId;
        if (userId is null)
        {
            return Result.Failure<PaginationResult<NotificationDto>>(
                Error.Unauthorized(
                    "Notification.Unauthorized",
                    "You must be signed in to view notifications."));
        }

        IQueryable<Notification> query = _dbContext.Notifications
            .AsNoTracking()
            .Where(entity => entity.UserId == userId.Value);

        if (request.UnreadOnly)
        {
            query = query.Where(entity => !entity.IsRead);
        }

        query = query.OrderByDescending(entity => entity.CreatedAtUtc);

        var totalCount = await query.CountAsync(cancellationToken);
        var page = await query
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .ToListAsync(cancellationToken);

        var data = page.Select(NotificationMappings.ToDto).ToList();

        var result = PaginationResult<NotificationDto>.Create(
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
 * @param {string} ns
 */
function renderUnreadCountQuery(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Notifications.Queries.GetUnreadCount;

public sealed record GetUnreadCountQuery : IRequest<Result<int>>;
`;
}

/**
 * @param {string} ns
 */
function renderUnreadCountHandler(ns) {
  return `using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Notifications.Queries.GetUnreadCount;

public sealed class GetUnreadCountQueryHandler
    : IRequestHandler<GetUnreadCountQuery, Result<int>>
{
    private readonly IApplicationDbContext _dbContext;
    private readonly ICurrentUser _currentUser;

    public GetUnreadCountQueryHandler(
        IApplicationDbContext dbContext,
        ICurrentUser currentUser)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
    }

    public async Task<Result<int>> Handle(
        GetUnreadCountQuery request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId;
        if (userId is null)
        {
            return Result.Failure<int>(
                Error.Unauthorized(
                    "Notification.Unauthorized",
                    "You must be signed in to view notifications."));
        }

        var count = await _dbContext.Notifications
            .AsNoTracking()
            .CountAsync(
                entity => entity.UserId == userId.Value && !entity.IsRead,
                cancellationToken);

        return Result.Success(count);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderMarkAsReadCommand(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Notifications.Commands.MarkAsRead;

public sealed record MarkAsReadCommand(Guid Id) : IRequest<Result>;
`;
}

/**
 * @param {string} ns
 */
function renderMarkAsReadHandler(ns) {
  return `using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Notifications.Commands.MarkAsRead;

public sealed class MarkAsReadCommandHandler
    : IRequestHandler<MarkAsReadCommand, Result>
{
    private readonly IApplicationDbContext _dbContext;
    private readonly ICurrentUser _currentUser;

    public MarkAsReadCommandHandler(
        IApplicationDbContext dbContext,
        ICurrentUser currentUser)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(
        MarkAsReadCommand request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId;
        if (userId is null)
        {
            return Result.Failure(
                Error.Unauthorized(
                    "Notification.Unauthorized",
                    "You must be signed in to update notifications."));
        }

        // Ownership is enforced in the predicate: a user can only read their own.
        var notification = await _dbContext.Notifications
            .FirstOrDefaultAsync(
                entity => entity.Id == request.Id && entity.UserId == userId.Value,
                cancellationToken);

        if (notification is null)
        {
            return Result.Failure(
                Error.NotFound(
                    "Notification.NotFound",
                    $"Notification '{request.Id}' was not found."));
        }

        if (!notification.IsRead)
        {
            notification.IsRead = true;
            notification.ReadAtUtc = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Result.Success();
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderMarkAllAsReadCommand(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Notifications.Commands.MarkAllAsRead;

public sealed record MarkAllAsReadCommand : IRequest<Result<int>>;
`;
}

/**
 * @param {string} ns
 */
function renderMarkAllAsReadHandler(ns) {
  return `using MediatR;
using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Notifications.Commands.MarkAllAsRead;

public sealed class MarkAllAsReadCommandHandler
    : IRequestHandler<MarkAllAsReadCommand, Result<int>>
{
    private readonly IApplicationDbContext _dbContext;
    private readonly ICurrentUser _currentUser;

    public MarkAllAsReadCommandHandler(
        IApplicationDbContext dbContext,
        ICurrentUser currentUser)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
    }

    public async Task<Result<int>> Handle(
        MarkAllAsReadCommand request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId;
        if (userId is null)
        {
            return Result.Failure<int>(
                Error.Unauthorized(
                    "Notification.Unauthorized",
                    "You must be signed in to update notifications."));
        }

        var unread = await _dbContext.Notifications
            .Where(entity => entity.UserId == userId.Value && !entity.IsRead)
            .ToListAsync(cancellationToken);

        if (unread.Count == 0)
        {
            return Result.Success(0);
        }

        var now = DateTime.UtcNow;
        foreach (var notification in unread)
        {
            notification.IsRead = true;
            notification.ReadAtUtc = now;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Result.Success(unread.Count);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderSendCommand(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Notifications.Commands.Send;

/// <summary>
/// Admin-only: sends a notification to an arbitrary user. Requires the
/// Notifications.Send permission (enforced at the controller).
/// </summary>
public sealed record SendNotificationToUserCommand : IRequest<Result>
{
    public Guid TargetUserId { get; init; }

    public string Type { get; init; } = "info";

    public string Title { get; init; } = string.Empty;

    public string Message { get; init; } = string.Empty;

    public string? TargetUrl { get; init; }
}
`;
}

/**
 * @param {string} ns
 */
function renderSendHandler(ns) {
  return `using MediatR;
using ${ns}.Application.Abstractions.Notifications;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Notifications.Commands.Send;

public sealed class SendNotificationToUserCommandHandler
    : IRequestHandler<SendNotificationToUserCommand, Result>
{
    private readonly INotificationService _notificationService;

    public SendNotificationToUserCommandHandler(INotificationService notificationService)
    {
        _notificationService = notificationService;
    }

    public async Task<Result> Handle(
        SendNotificationToUserCommand request,
        CancellationToken cancellationToken)
    {
        await _notificationService.SendAsync(
            new NotificationRequest(
                request.TargetUserId,
                request.Type,
                request.Title,
                request.Message,
                request.TargetUrl),
            cancellationToken);

        return Result.Success();
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderSendValidator(ns) {
  return `using FluentValidation;

namespace ${ns}.Application.Features.Notifications.Commands.Send;

public sealed class SendNotificationToUserCommandValidator
    : AbstractValidator<SendNotificationToUserCommand>
{
    public SendNotificationToUserCommandValidator()
    {
        RuleFor(command => command.TargetUserId)
            .NotEmpty();

        RuleFor(command => command.Type)
            .NotEmpty()
            .MaximumLength(100);

        RuleFor(command => command.Title)
            .NotEmpty()
            .MaximumLength(200);

        RuleFor(command => command.Message)
            .NotEmpty()
            .MaximumLength(2000);

        RuleFor(command => command.TargetUrl)
            .MaximumLength(2048)
            .When(command => command.TargetUrl is not null);
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
    public static class Notifications
    {
        public const string Root = Rule + "/Notifications";
        public const string Mine = Root + "/Mine";
        public const string UnreadCount = Root + "/UnreadCount";
        public const string Read = Root + "/{id:guid}/Read";
        public const string ReadAll = Root + "/ReadAll";
        public const string Send = Root + "/Send";
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
using ${ns}.Application.Features.Notifications.Queries.GetMy;
using ${ns}.Application.Features.Notifications.Queries.GetUnreadCount;
using ${ns}.Application.Features.Notifications.Commands.MarkAllAsRead;
using ${ns}.Application.Features.Notifications.Commands.MarkAsRead;
using ${ns}.Application.Features.Notifications.Commands.Send;

namespace ${ns}.API.Controllers;

[ApiController]
[Authorize]
public sealed class NotificationsController : ApiControllerBase
{
    private readonly ISender _sender;

    public NotificationsController(ISender sender)
    {
        _sender = sender;
    }

    [HttpGet(Router.Notifications.Mine)]
    public async Task<IActionResult> GetMine(
        [FromQuery] GetMyNotificationsQuery query,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(query, cancellationToken);
        return ToActionResult(result);
    }

    [HttpGet(Router.Notifications.UnreadCount)]
    public async Task<IActionResult> GetUnreadCount(CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetUnreadCountQuery(), cancellationToken);
        return ToActionResult(result);
    }

    [HttpPost(Router.Notifications.Read)]
    public async Task<IActionResult> MarkAsRead(Guid id, CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new MarkAsReadCommand(id), cancellationToken);
        return ToActionResult(result);
    }

    [HttpPost(Router.Notifications.ReadAll)]
    public async Task<IActionResult> MarkAllAsRead(CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new MarkAllAsReadCommand(), cancellationToken);
        return ToActionResult(result);
    }

    [HasPermission(PermissionConstants.NotificationsSend)]
    [HttpPost(Router.Notifications.Send)]
    public async Task<IActionResult> Send(
        [FromBody] SendNotificationToUserCommand command,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(command, cancellationToken);
        return ToActionResult(result);
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
function planNotificationsReact(config) {
  const mod = (...segments) => paths.reactModule('notifications', ...segments);
  /** @type {{ relativePath: string, contents: string }[]} */
  const files = [
    { relativePath: mod('types', 'notification.types.ts'), contents: reactTypes() },
    { relativePath: mod('services', 'notifications.routes.ts'), contents: reactRoutes() },
    { relativePath: mod('services', 'notifications.service.ts'), contents: reactService() },
    {
      relativePath: mod('slices', 'thunks', 'getMyNotifications.thunk.ts'),
      contents: reactGetMyThunk(),
    },
    {
      relativePath: mod('slices', 'thunks', 'getUnreadCount.thunk.ts'),
      contents: reactUnreadThunk(),
    },
    {
      relativePath: mod('slices', 'thunks', 'markAsRead.thunk.ts'),
      contents: reactMarkAsReadThunk(),
    },
    {
      relativePath: mod('slices', 'thunks', 'markAllAsRead.thunk.ts'),
      contents: reactMarkAllThunk(),
    },
    { relativePath: mod('slices', 'notifications.slice.ts'), contents: reactSlice() },
    { relativePath: mod('hooks', 'useNotifications.ts'), contents: reactHook() },
    { relativePath: mod('components', 'NotificationBell.tsx'), contents: reactBell() },
    { relativePath: mod('pages', 'NotificationsPage.tsx'), contents: reactPage() },
    { relativePath: mod('index.ts'), contents: reactIndex() },
  ];

  if (isNext(config)) {
    files.push({
      relativePath: paths.client(
        'app',
        '(dashboard)',
        'dashboard',
        'notifications',
        'page.tsx',
      ),
      contents: 'export { default } from "@/modules/notifications/pages/NotificationsPage";\n',
    });
  } else {
    files.push({
      relativePath: paths.client('app', 'router', 'routes', 'notifications.routes.tsx'),
      contents: `import NotificationsPage from "@/modules/notifications/pages/NotificationsPage";

export const notificationsRoute = {
  path: "notifications",
  Component: NotificationsPage,
};
`,
    });
  }

  return files;
}

function reactTypes() {
  return `export type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  targetUrl: string | null;
  isRead: boolean;
  readAtUtc: string | null;
  createdAtUtc: string;
};

export type MyNotificationsRequest = {
  page: number;
  pageSize: number;
  unreadOnly?: boolean;
};
`;
}

function reactRoutes() {
  return `export const notificationsApiRoutes = {
  mine: "/api/v1/Notifications/Mine",
  unreadCount: "/api/v1/Notifications/UnreadCount",
  read: (id: string) => \`/api/v1/Notifications/\${id}/Read\`,
  readAll: "/api/v1/Notifications/ReadAll",
  send: "/api/v1/Notifications/Send",
} as const;

export const notificationsAppRoutes = {
  dashboard: {
    list: "/dashboard/notifications",
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
import { notificationsApiRoutes } from "./notifications.routes";
import type {
  AppNotification,
  MyNotificationsRequest,
} from "../types/notification.types";

export const notificationsService = {
  async getMine(
    request: MyNotificationsRequest,
  ): Promise<PaginationResult<AppNotification>> {
    const response = await apiClient.get<PaginationResult<AppNotification>>(
      notificationsApiRoutes.mine,
      { params: request },
    );
    return normalizePagination(response.data);
  },

  async getUnreadCount(): Promise<number> {
    const response = await apiClient.get<number>(notificationsApiRoutes.unreadCount);
    return response.data;
  },

  async markAsRead(id: string): Promise<void> {
    await apiClient.post(notificationsApiRoutes.read(id));
  },

  async markAllAsRead(): Promise<number> {
    const response = await apiClient.post<number>(notificationsApiRoutes.readAll);
    return response.data;
  },
};
`;
}

function reactGetMyThunk() {
  return `import { createAsyncThunk } from "@reduxjs/toolkit";
import { getErrorMessage } from "@/shared/utils/get-error-message";
import type { PaginationResult } from "@/shared/state/pagination/pagination.types";
import { notificationsService } from "../../services/notifications.service";
import type {
  AppNotification,
  MyNotificationsRequest,
} from "../../types/notification.types";

export const getMyNotifications = createAsyncThunk<
  PaginationResult<AppNotification>,
  MyNotificationsRequest,
  { rejectValue: string }
>("notifications/getMyNotifications", async (request, { rejectWithValue }) => {
  try {
    return await notificationsService.getMine(request);
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});
`;
}

function reactUnreadThunk() {
  return `import { createAsyncThunk } from "@reduxjs/toolkit";
import { getErrorMessage } from "@/shared/utils/get-error-message";
import { notificationsService } from "../../services/notifications.service";

export const getUnreadCount = createAsyncThunk<
  number,
  void,
  { rejectValue: string }
>("notifications/getUnreadCount", async (_arg, { rejectWithValue }) => {
  try {
    return await notificationsService.getUnreadCount();
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});
`;
}

function reactMarkAsReadThunk() {
  return `import { createAsyncThunk } from "@reduxjs/toolkit";
import { getErrorMessage } from "@/shared/utils/get-error-message";
import { notificationsService } from "../../services/notifications.service";

export const markAsRead = createAsyncThunk<
  string,
  string,
  { rejectValue: string }
>("notifications/markAsRead", async (id, { rejectWithValue }) => {
  try {
    await notificationsService.markAsRead(id);
    return id;
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});
`;
}

function reactMarkAllThunk() {
  return `import { createAsyncThunk } from "@reduxjs/toolkit";
import { getErrorMessage } from "@/shared/utils/get-error-message";
import { notificationsService } from "../../services/notifications.service";

export const markAllAsRead = createAsyncThunk<
  number,
  void,
  { rejectValue: string }
>("notifications/markAllAsRead", async (_arg, { rejectWithValue }) => {
  try {
    return await notificationsService.markAllAsRead();
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});
`;
}

function reactSlice() {
  return `import { createSlice } from "@reduxjs/toolkit";
import type { PaginationResult } from "@/shared/state/pagination/pagination.types";
import type { AppNotification } from "../types/notification.types";
import { getMyNotifications } from "./thunks/getMyNotifications.thunk";
import { getUnreadCount } from "./thunks/getUnreadCount.thunk";
import { markAsRead } from "./thunks/markAsRead.thunk";
import { markAllAsRead } from "./thunks/markAllAsRead.thunk";

type NotificationsState = {
  items: AppNotification[];
  pagination: PaginationResult<AppNotification> | null;
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
};

const initialState: NotificationsState = {
  items: [],
  pagination: null,
  unreadCount: 0,
  isLoading: false,
  error: null,
};

const notificationsSlice = createSlice({
  name: "notifications",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(getMyNotifications.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(getMyNotifications.fulfilled, (state, action) => {
        state.isLoading = false;
        state.items = action.payload.data;
        state.pagination = action.payload;
      })
      .addCase(getMyNotifications.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload ?? "Unable to load notifications";
      })
      .addCase(getUnreadCount.fulfilled, (state, action) => {
        state.unreadCount = action.payload;
      })
      .addCase(markAsRead.fulfilled, (state, action) => {
        state.items = state.items.map((item) =>
          item.id === action.payload
            ? { ...item, isRead: true, readAtUtc: new Date().toISOString() }
            : item,
        );
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      })
      .addCase(markAllAsRead.fulfilled, (state) => {
        state.items = state.items.map((item) => ({
          ...item,
          isRead: true,
          readAtUtc: item.readAtUtc ?? new Date().toISOString(),
        }));
        state.unreadCount = 0;
      });
  },
});

export default notificationsSlice.reducer;
`;
}

function reactHook() {
  return `"use client";

import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getMyNotifications } from "../slices/thunks/getMyNotifications.thunk";
import { getUnreadCount } from "../slices/thunks/getUnreadCount.thunk";
import { markAsRead } from "../slices/thunks/markAsRead.thunk";
import { markAllAsRead } from "../slices/thunks/markAllAsRead.thunk";

export function useNotifications(options?: { pollUnread?: boolean }) {
  const dispatch = useAppDispatch();
  const { items, pagination, unreadCount, isLoading, error } = useAppSelector(
    (state) => state.notifications,
  );

  const load = useCallback(
    (page = 1, unreadOnly = false) => {
      void dispatch(getMyNotifications({ page, pageSize: 20, unreadOnly }));
    },
    [dispatch],
  );

  const refreshUnread = useCallback(() => {
    void dispatch(getUnreadCount());
  }, [dispatch]);

  const read = useCallback(
    (id: string) => {
      void dispatch(markAsRead(id));
    },
    [dispatch],
  );

  const readAll = useCallback(() => {
    void dispatch(markAllAsRead());
  }, [dispatch]);

  useEffect(() => {
    if (!options?.pollUnread) {
      return;
    }

    refreshUnread();
    const interval = window.setInterval(refreshUnread, 60_000);
    return () => window.clearInterval(interval);
  }, [options?.pollUnread, refreshUnread]);

  return { items, pagination, unreadCount, isLoading, error, load, refreshUnread, read, readAll };
}
`;
}

function reactBell() {
  return `"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "../hooks/useNotifications";

export function NotificationBell() {
  const { items, unreadCount, load, read, readAll } = useNotifications({
    pollUnread: true,
  });
  const [open, setOpen] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      load(1);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="relative rounded-full p-2 text-zinc-700 hover:bg-zinc-100"
        aria-label="Notifications"
        onClick={toggle}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-medium text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-md border border-zinc-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2">
            <span className="text-sm font-medium text-zinc-900">Notifications</span>
            <button
              type="button"
              className="text-xs text-zinc-600 underline"
              onClick={readAll}
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 divide-y divide-zinc-100 overflow-auto">
            {items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-zinc-500">
                You're all caught up.
              </li>
            ) : (
              items.map((item) => (
                <li
                  key={item.id}
                  className={
                    item.isRead
                      ? "px-4 py-3"
                      : "bg-zinc-50 px-4 py-3"
                  }
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => read(item.id)}
                  >
                    <p className="text-sm font-medium text-zinc-900">{item.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-600">{item.message}</p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
`;
}

function reactPage() {
  return `"use client";

import { useEffect } from "react";
import { useNotifications } from "../hooks/useNotifications";

export default function NotificationsPage() {
  const { items, pagination, isLoading, error, load, read, readAll } =
    useNotifications();

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-zinc-900">Notifications</h1>
          <p className="mt-1 text-sm text-zinc-600">Your recent notifications.</p>
        </div>
        <button
          type="button"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-900"
          onClick={readAll}
        >
          Mark all read
        </button>
      </header>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-zinc-600">Loading notifications...</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-600">
          You have no notifications.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={
                item.isRead
                  ? "rounded-md border border-zinc-200 px-4 py-3"
                  : "rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3"
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{item.title}</p>
                  <p className="mt-0.5 text-sm text-zinc-600">{item.message}</p>
                  {item.targetUrl ? (
                    <a
                      href={item.targetUrl}
                      className="mt-1 inline-block text-xs text-zinc-900 underline"
                    >
                      Open
                    </a>
                  ) : null}
                </div>
                {!item.isRead ? (
                  <button
                    type="button"
                    className="text-xs text-zinc-700 underline"
                    onClick={() => read(item.id)}
                  >
                    Mark read
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-zinc-700">
          <p>
            Page {pagination.currentPage} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-50"
              disabled={!pagination.hasPreviousPage || isLoading}
              onClick={() => load(pagination.currentPage - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-50"
              disabled={!pagination.hasNextPage || isLoading}
              onClick={() => load(pagination.currentPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
`;
}

function reactIndex() {
  return `export { default as notificationsReducer } from "./slices/notifications.slice";
export { default as NotificationsPage } from "./pages/NotificationsPage";
export { NotificationBell } from "./components/NotificationBell";
export { useNotifications } from "./hooks/useNotifications";
export { notificationsService } from "./services/notifications.service";
export type { AppNotification } from "./types/notification.types";
`;
}

/* ================================================================== */
/* Angular frontend                                                   */
/* ================================================================== */

/**
 * @param {object} config
 * @returns {{ relativePath: string, contents: string }[]}
 */
function planNotificationsAngular(config) {
  const base = (...segments) => paths.angularFeature('notifications', ...segments);
  return [
    { relativePath: base('models', 'notification.model.ts'), contents: ngModel() },
    { relativePath: base('services', 'notification.service.ts'), contents: ngService() },
    { relativePath: base('store', 'notification.state.ts'), contents: ngState() },
    { relativePath: base('store', 'notification.actions.ts'), contents: ngActions() },
    { relativePath: base('store', 'notification.reducer.ts'), contents: ngReducer() },
    { relativePath: base('store', 'notification.effects.ts'), contents: ngEffects() },
    { relativePath: base('store', 'notification.selectors.ts'), contents: ngSelectors() },
    {
      relativePath: base('components', 'notification-bell', 'notification-bell.component.ts'),
      contents: ngBell(),
    },
    {
      relativePath: base('pages', 'notifications-page', 'notifications-page.component.ts'),
      contents: ngPage(),
    },
    { relativePath: base('notification.routes.ts'), contents: ngRoutes() },
  ];
}

function ngModel() {
  return `import type { PaginationResult } from "../../../shared/models/pagination";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  targetUrl: string | null;
  isRead: boolean;
  readAtUtc: string | null;
  createdAtUtc: string;
};

export type MyNotificationsQuery = {
  page: number;
  pageSize: number;
  unreadOnly?: boolean;
};

export type NotificationPage = PaginationResult<AppNotification>;
`;
}

function ngService() {
  return `import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import type { PaginationResult } from "../../../shared/models/pagination";
import type {
  AppNotification,
  MyNotificationsQuery,
} from "../models/notification.model";

const basePath = "/api/v1/Notifications";

@Injectable({ providedIn: "root" })
export class NotificationService {
  constructor(private readonly http: HttpClient) {}

  getMine(query: MyNotificationsQuery): Observable<PaginationResult<AppNotification>> {
    let params = new HttpParams()
      .set("page", String(query.page))
      .set("pageSize", String(query.pageSize));

    if (query.unreadOnly) {
      params = params.set("unreadOnly", "true");
    }

    return this.http.get<PaginationResult<AppNotification>>(\`\${basePath}/Mine\`, {
      params,
    });
  }

  getUnreadCount(): Observable<number> {
    return this.http.get<number>(\`\${basePath}/UnreadCount\`);
  }

  markAsRead(id: string): Observable<void> {
    return this.http.post<void>(\`\${basePath}/\${id}/Read\`, {});
  }

  markAllAsRead(): Observable<number> {
    return this.http.post<number>(\`\${basePath}/ReadAll\`, {});
  }
}
`;
}

function ngState() {
  return `import type { PaginationResult } from "../../../shared/models/pagination";
import type { AppNotification } from "../models/notification.model";

export const notificationsFeatureKey = "notifications";

export type RequestStatus = "idle" | "loading" | "succeeded" | "failed";

export type NotificationsState = {
  items: AppNotification[];
  pagination: PaginationResult<AppNotification> | null;
  unreadCount: number;
  status: RequestStatus;
  error: string | null;
};

export const initialNotificationsState: NotificationsState = {
  items: [],
  pagination: null,
  unreadCount: 0,
  status: "idle",
  error: null,
};
`;
}

function ngActions() {
  return `import { createActionGroup, emptyProps, props } from "@ngrx/store";
import type { PaginationResult } from "../../../shared/models/pagination";
import type {
  AppNotification,
  MyNotificationsQuery,
} from "../models/notification.model";

export const NotificationActions = createActionGroup({
  source: "Notifications",
  events: {
    "Load Mine": props<{ query: MyNotificationsQuery }>(),
    "Load Mine Success": props<{ result: PaginationResult<AppNotification> }>(),
    "Load Mine Failure": props<{ error: string }>(),
    "Load Unread Count": emptyProps(),
    "Load Unread Count Success": props<{ count: number }>(),
    "Mark As Read": props<{ id: string }>(),
    "Mark As Read Success": props<{ id: string }>(),
    "Mark All As Read": emptyProps(),
    "Mark All As Read Success": emptyProps(),
  },
});
`;
}

function ngReducer() {
  return `import { createReducer, on } from "@ngrx/store";
import { NotificationActions } from "./notification.actions";
import { initialNotificationsState } from "./notification.state";

export const notificationsReducer = createReducer(
  initialNotificationsState,
  on(NotificationActions.loadMine, (state) => ({
    ...state,
    status: "loading" as const,
    error: null,
  })),
  on(NotificationActions.loadMineSuccess, (state, { result }) => ({
    ...state,
    status: "succeeded" as const,
    items: result.data,
    pagination: result,
  })),
  on(NotificationActions.loadMineFailure, (state, { error }) => ({
    ...state,
    status: "failed" as const,
    error,
  })),
  on(NotificationActions.loadUnreadCountSuccess, (state, { count }) => ({
    ...state,
    unreadCount: count,
  })),
  on(NotificationActions.markAsReadSuccess, (state, { id }) => ({
    ...state,
    items: state.items.map((item) =>
      item.id === id
        ? { ...item, isRead: true, readAtUtc: new Date().toISOString() }
        : item,
    ),
    unreadCount: Math.max(0, state.unreadCount - 1),
  })),
  on(NotificationActions.markAllAsReadSuccess, (state) => ({
    ...state,
    items: state.items.map((item) => ({
      ...item,
      isRead: true,
      readAtUtc: item.readAtUtc ?? new Date().toISOString(),
    })),
    unreadCount: 0,
  })),
);
`;
}

function ngEffects() {
  return `import { Injectable, inject } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { catchError, map, of, switchMap } from "rxjs";
import { getErrorMessage } from "../../../shared/utils/get-error-message";
import { NotificationService } from "../services/notification.service";
import { NotificationActions } from "./notification.actions";

@Injectable()
export class NotificationEffects {
  private readonly actions$ = inject(Actions);
  private readonly notificationService = inject(NotificationService);

  loadMine$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NotificationActions.loadMine),
      switchMap(({ query }) =>
        this.notificationService.getMine(query).pipe(
          map((result) => NotificationActions.loadMineSuccess({ result })),
          catchError((error: unknown) =>
            of(NotificationActions.loadMineFailure({ error: getErrorMessage(error) })),
          ),
        ),
      ),
    ),
  );

  loadUnreadCount$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NotificationActions.loadUnreadCount),
      switchMap(() =>
        this.notificationService.getUnreadCount().pipe(
          map((count) => NotificationActions.loadUnreadCountSuccess({ count })),
          catchError(() => of(NotificationActions.loadUnreadCountSuccess({ count: 0 }))),
        ),
      ),
    ),
  );

  markAsRead$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NotificationActions.markAsRead),
      switchMap(({ id }) =>
        this.notificationService.markAsRead(id).pipe(
          map(() => NotificationActions.markAsReadSuccess({ id })),
          catchError(() => of(NotificationActions.markAsReadSuccess({ id }))),
        ),
      ),
    ),
  );

  markAllAsRead$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NotificationActions.markAllAsRead),
      switchMap(() =>
        this.notificationService.markAllAsRead().pipe(
          map(() => NotificationActions.markAllAsReadSuccess()),
          catchError(() => of(NotificationActions.markAllAsReadSuccess())),
        ),
      ),
    ),
  );
}
`;
}

function ngSelectors() {
  return `import { createFeatureSelector, createSelector } from "@ngrx/store";
import { notificationsFeatureKey, type NotificationsState } from "./notification.state";

export const selectNotificationsState =
  createFeatureSelector<NotificationsState>(notificationsFeatureKey);

export const selectNotifications = createSelector(
  selectNotificationsState,
  (state) => state.items,
);
export const selectUnreadCount = createSelector(
  selectNotificationsState,
  (state) => state.unreadCount,
);
export const selectNotificationsError = createSelector(
  selectNotificationsState,
  (state) => state.error,
);
export const selectNotificationsPagination = createSelector(
  selectNotificationsState,
  (state) => state.pagination,
);
`;
}

function ngBell() {
  return `import { Component, OnInit, inject, signal } from "@angular/core";
import { Store } from "@ngrx/store";
import { NotificationActions } from "../../store/notification.actions";
import {
  selectNotifications,
  selectUnreadCount,
} from "../../store/notification.selectors";

@Component({
  selector: "app-notification-bell",
  standalone: true,
  template: \`
    <div class="relative">
      <button
        type="button"
        class="relative rounded-full p-2 text-zinc-700 hover:bg-zinc-100"
        aria-label="Notifications"
        (click)="toggle()"
      >
        <span aria-hidden="true">🔔</span>
        @if (unreadCount() > 0) {
          <span
            class="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-medium text-white"
          >
            {{ unreadCount() > 99 ? "99+" : unreadCount() }}
          </span>
        }
      </button>

      @if (open()) {
        <div
          class="absolute right-0 z-50 mt-2 w-80 rounded-md border border-zinc-200 bg-white shadow-lg"
        >
          <div class="flex items-center justify-between border-b border-zinc-100 px-4 py-2">
            <span class="text-sm font-medium text-zinc-900">Notifications</span>
            <button type="button" class="text-xs text-zinc-600 underline" (click)="readAll()">
              Mark all read
            </button>
          </div>
          <ul class="max-h-96 divide-y divide-zinc-100 overflow-auto">
            @if (items().length === 0) {
              <li class="px-4 py-6 text-center text-sm text-zinc-500">
                You're all caught up.
              </li>
            } @else {
              @for (item of items(); track item.id) {
                <li [class]="item.isRead ? 'px-4 py-3' : 'bg-zinc-50 px-4 py-3'">
                  <button type="button" class="w-full text-left" (click)="read(item.id)">
                    <p class="text-sm font-medium text-zinc-900">{{ item.title }}</p>
                    <p class="mt-0.5 text-xs text-zinc-600">{{ item.message }}</p>
                  </button>
                </li>
              }
            }
          </ul>
        </div>
      }
    </div>
  \`,
})
export class NotificationBellComponent implements OnInit {
  private readonly store = inject(Store);

  readonly items = this.store.selectSignal(selectNotifications);
  readonly unreadCount = this.store.selectSignal(selectUnreadCount);
  readonly open = signal(false);

  ngOnInit(): void {
    this.store.dispatch(NotificationActions.loadUnreadCount());
  }

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.store.dispatch(
        NotificationActions.loadMine({ query: { page: 1, pageSize: 20 } }),
      );
    }
  }

  read(id: string): void {
    this.store.dispatch(NotificationActions.markAsRead({ id }));
  }

  readAll(): void {
    this.store.dispatch(NotificationActions.markAllAsRead());
  }
}
`;
}

function ngPage() {
  return `import { Component, OnInit, inject } from "@angular/core";
import { Store } from "@ngrx/store";
import { NotificationActions } from "../../store/notification.actions";
import {
  selectNotifications,
  selectNotificationsError,
  selectNotificationsPagination,
} from "../../store/notification.selectors";

@Component({
  selector: "app-notifications-page",
  standalone: true,
  template: \`
    <main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold text-zinc-900">Notifications</h1>
          <p class="mt-1 text-sm text-zinc-600">Your recent notifications.</p>
        </div>
        <button
          type="button"
          class="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-900"
          (click)="readAll()"
        >
          Mark all read
        </button>
      </header>

      @if (error(); as message) {
        <p class="text-sm text-red-600" role="alert">{{ message }}</p>
      }

      @if (items().length === 0) {
        <p class="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-600">
          You have no notifications.
        </p>
      } @else {
        <ul class="flex flex-col gap-2">
          @for (item of items(); track item.id) {
            <li
              [class]="
                item.isRead
                  ? 'rounded-md border border-zinc-200 px-4 py-3'
                  : 'rounded-md border border-zinc-300 bg-zinc-50 px-4 py-3'
              "
            >
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-zinc-900">{{ item.title }}</p>
                  <p class="mt-0.5 text-sm text-zinc-600">{{ item.message }}</p>
                  @if (item.targetUrl) {
                    <a
                      [href]="item.targetUrl"
                      class="mt-1 inline-block text-xs text-zinc-900 underline"
                    >
                      Open
                    </a>
                  }
                </div>
                @if (!item.isRead) {
                  <button
                    type="button"
                    class="text-xs text-zinc-700 underline"
                    (click)="read(item.id)"
                  >
                    Mark read
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }

      @if (pagination(); as page) {
        @if (page.totalPages > 1) {
          <div class="flex items-center justify-between gap-3 text-sm text-zinc-700">
            <p>Page {{ page.currentPage }} of {{ page.totalPages }}</p>
            <div class="flex gap-2">
              <button
                type="button"
                class="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-50"
                [disabled]="!page.hasPreviousPage"
                (click)="load(page.currentPage - 1)"
              >
                Previous
              </button>
              <button
                type="button"
                class="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-50"
                [disabled]="!page.hasNextPage"
                (click)="load(page.currentPage + 1)"
              >
                Next
              </button>
            </div>
          </div>
        }
      }
    </main>
  \`,
})
export class NotificationsPageComponent implements OnInit {
  private readonly store = inject(Store);

  readonly items = this.store.selectSignal(selectNotifications);
  readonly pagination = this.store.selectSignal(selectNotificationsPagination);
  readonly error = this.store.selectSignal(selectNotificationsError);

  ngOnInit(): void {
    this.load(1);
  }

  load(page: number): void {
    if (page < 1) {
      return;
    }

    this.store.dispatch(
      NotificationActions.loadMine({ query: { page, pageSize: 20 } }),
    );
  }

  read(id: string): void {
    this.store.dispatch(NotificationActions.markAsRead({ id }));
  }

  readAll(): void {
    this.store.dispatch(NotificationActions.markAllAsRead());
  }
}
`;
}

function ngRoutes() {
  return `import { Routes } from "@angular/router";
import { provideEffects } from "@ngrx/effects";
import { provideState } from "@ngrx/store";
import { NotificationsPageComponent } from "./pages/notifications-page/notifications-page.component";
import { NotificationEffects } from "./store/notification.effects";
import { notificationsReducer } from "./store/notification.reducer";
import { notificationsFeatureKey } from "./store/notification.state";

export const notificationsRoutes: Routes = [
  {
    path: "",
    providers: [
      provideState(notificationsFeatureKey, notificationsReducer),
      provideEffects(NotificationEffects),
    ],
    children: [{ path: "", component: NotificationsPageComponent }],
  },
];
`;
}
