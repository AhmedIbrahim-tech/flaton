/**
 * V4 Permissions module generator.
 *
 * Produces a permission-based authorization stack:
 *   - RolePermission entity (RoleId, Permission) + EF configuration
 *   - A generator-owned permission constant registry
 *     (Application/Common/Authorization/AppPermissions.cs)
 *   - A dynamic PermissionPolicyProvider + requirement + handler in API/Authorization
 *   - A seeding helper in Infrastructure/Seeders/Identity/ that grants permissions to roles idempotently
 *
 * Also exports `registerFeaturePermissions(config, featureName, actions)` — a
 * registry-update factory the feature generator uses to append its own
 * permission constants to the shared registry file.
 */

import {
  paths,
  dbSetUpdates,
  currentUserAbstraction,
  moduleRegistrationFile,
  finalizePlan,
} from '../modules-orchestrator-helpers.js';

function permissionsRegistryPath() {
  return paths.application('Common', 'Authorization', 'AppPermissions.cs');
}

/**
 * @param {object} config
 * @returns {ReturnType<typeof finalizePlan>}
 */
export function planPermissionsModule(config) {
  const ns = config.projectName;

  /** @type {{ relativePath: string, contents: string, writeMode?: string }[]} */
  const files = [];
  /** @type {{ relativePath: string, update: (existing: string) => string }[]} */
  const registryUpdates = [...dbSetUpdates(ns, 'RolePermission', 'RolePermissions')];

  // Domain entity ---------------------------------------------------
  files.push({
    relativePath: paths.domain('Entities', 'RolePermission.cs'),
    contents: renderRolePermissionEntity(ns),
  });

  // Persistence -----------------------------------------------------
  files.push({
    relativePath: paths.infrastructure(
      'Persistence',
      'Configurations',
      'RolePermissionConfiguration.cs',
    ),
    contents: renderRolePermissionConfiguration(ns),
  });

  // Permission registry (generator-owned, appended by features) ------
  files.push({
    writeMode: 'ifMissing',
    relativePath: permissionsRegistryPath(),
    contents: renderRegistry(ns, [
      { feature: 'Users', actions: ['View', 'Manage'] },
      { feature: 'Audit', actions: ['View'] },
      { feature: 'Notifications', actions: ['Send'] },
    ]),
  });

  // Authorization plumbing (ifMissing: auth may already own these) ---
  files.push(...currentUserAbstraction(ns));
  files.push(
    {
      writeMode: 'ifMissing',
      relativePath: paths.application(
        'Abstractions',
        'Authorization',
        'IPermissionService.cs',
      ),
      contents: renderPermissionServiceAbstraction(ns),
    },
    {
      writeMode: 'ifMissing',
      relativePath: paths.api(
        'Authorization',
        'PermissionRequirement.cs',
      ),
      contents: renderPermissionRequirement(ns),
    },
    {
      writeMode: 'ifMissing',
      relativePath: paths.api(
        'Authorization',
        'PermissionAuthorizationHandler.cs',
      ),
      contents: renderPermissionHandler(ns),
    },
    {
      writeMode: 'ifMissing',
      relativePath: paths.api(
        'Authorization',
        'PermissionPolicyProvider.cs',
      ),
      contents: renderPolicyProvider(ns),
    },
    {
      writeMode: 'ifMissing',
      relativePath: paths.api(
        'Attributes',
        'HasPermissionAttribute.cs',
      ),
      contents: renderHasPermissionAttribute(ns),
    },
  );

  // Permission service implementation + seeding ---------------------
  files.push(
    {
      relativePath: paths.infrastructure('Authorization', 'Services', 'PermissionService.cs'),
      contents: renderPermissionServiceImplementation(ns),
    },
    {
      relativePath: paths.infrastructure(
        'Seeders',
        'Identity',
        'PermissionSeeder.cs',
      ),
      contents: renderPermissionSeeder(ns),
    },
  );

  // DI registration -------------------------------------------------
  const { file: registrationFile, registration } = moduleRegistrationFile({
    projectName: ns,
    moduleName: 'Permissions',
    usings: [
      `using ${ns}.Application.Abstractions.Authorization;`,
      `using ${ns}.Infrastructure.Permissions;`,
    ],
    body: [
      '        services.AddScoped<IPermissionService, PermissionService>();',
    ],
  });
  files.push(registrationFile);

  return finalizePlan({
    id: 'permissions',
    requires: ['auth'],
    files,
    registryUpdates,
    registrations: [registration],
    notes: [
      'RolePermission is DB-driven; PermissionAuthorizationHandler resolves a user\'s permissions from their role claims.',
      'Call PermissionSeeder.SeedRoleAsync during startup to grant PermissionConstants.All to the Admin role.',
      'Feature generators append their permissions via registerFeaturePermissions().',
    ],
  });
}

/**
 * Registry-update factory used by the feature generator (and the other V4
 * modules) to append a feature's permission constants to the shared registry.
 *
 * @param {object} config       module/feature config ({ projectName })
 * @param {string} featureName  PascalCase feature name, e.g. "Products"
 * @param {string[]} actions    permission actions, e.g. ["View", "Manage"]
 * @returns {{ relativePath: string, update: (existing: string) => string }}
 */
export function registerFeaturePermissions(config, featureName, actions) {
  const ns = config.projectName;
  const cleanActions = (actions ?? []).filter(Boolean);

  return {
    relativePath: permissionsRegistryPath(),
    update: (existing) => {
      let content =
        existing && existing.trim().length > 0
          ? existing
          : renderRegistry(ns, []);

      content = appendPermissionGroup(content, featureName, cleanActions);
      return content;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Registry rendering + idempotent append                             */
/* ------------------------------------------------------------------ */

/**
 * @param {string} ns
 * @param {{ feature: string, actions: string[] }[]} groups
 */
function renderRegistry(ns, groups) {
  /** @type {string[]} */
  const constLines = [];
  /** @type {string[]} */
  const allEntries = [];

  for (const group of groups) {
    for (const action of group.actions) {
      const name = `${group.feature}${action}`;
      constLines.push(`    public const string ${name} = "${group.feature}.${action}";`);
      allEntries.push(`        ${name},`);
    }
  }

  const constBlock = constLines.length > 0 ? `${constLines.join('\n')}\n\n` : '';
  const allBlock = allEntries.length > 0 ? `${allEntries.join('\n')}\n` : '';

  return `namespace ${ns}.Application.Common.Authorization;

public static class AppPermissions
{
    public const string ClaimType = "permission";

    public static class Users
    {
        public const string View = "Users.View";
        public const string Manage = "Users.Manage";
    }

    public static class Notifications
    {
        public const string Send = "Notifications.Send";
    }

    public static class Audit
    {
        public const string View = "Audit.View";
    }

    public static string For(string feature, string action) => $"{feature}.{action}";

    public static readonly IReadOnlyList<string> All = new[]
    {
        Users.View,
        Users.Manage,
        Notifications.Send,
        Audit.View,
    };
}

public static class PermissionConstants
{
${constBlock}    public static readonly IReadOnlyList<string> All = new[]
    {
${allBlock}    };
}
`;
}

/**
 * Idempotently insert a feature's permission constants and All entries.
 * @param {string} content
 * @param {string} featureName
 * @param {string[]} actions
 */
function appendPermissionGroup(content, featureName, actions) {
  let result = content;

  for (const action of actions) {
    const name = `${featureName}${action}`;
    const constLine = `    public const string ${name} = "${featureName}.${action}";`;
    const allEntry = `        ${name},`;

    if (!result.includes(`public const string ${name} `)) {
      result = result.replace(
        /(\n)(    public static readonly IReadOnlyList<string> All)/,
        `\n${constLine}$1$2`,
      );
    }

    if (!new RegExp(`\\n        ${name},\\n`).test(result)) {
      result = result.replace(
        /(\n)(    \};\n)/,
        `\n${allEntry}$1$2`,
      );
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Backend C# renderers                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {string} ns
 */
function renderRolePermissionEntity(ns) {
  return `namespace ${ns}.Domain.Entities;

/// <summary>
/// Maps a role to a single granted permission. Role/permission pairs are unique.
/// </summary>
public sealed class RolePermission
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RoleId { get; set; }

    public string Permission { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; }
}
`;
}

/**
 * @param {string} ns
 */
function renderRolePermissionConfiguration(ns) {
  return `using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ${ns}.Domain.Entities;

namespace ${ns}.Infrastructure.Persistence.Configurations;

public sealed class RolePermissionConfiguration : IEntityTypeConfiguration<RolePermission>
{
    public void Configure(EntityTypeBuilder<RolePermission> builder)
    {
        builder.ToTable("RolePermissions");
        builder.HasKey(entity => entity.Id);

        builder.Property(entity => entity.Permission)
            .IsRequired()
            .HasMaxLength(200);

        builder.HasIndex(entity => new { entity.RoleId, entity.Permission })
            .IsUnique();
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderPermissionServiceAbstraction(ns) {
  return `namespace ${ns}.Application.Abstractions.Authorization;

public interface IPermissionService
{
    Task<IReadOnlyCollection<string>> GetPermissionsForRolesAsync(
        IEnumerable<Guid> roleIds,
        CancellationToken cancellationToken = default);

    Task<bool> HasPermissionAsync(
        IEnumerable<Guid> roleIds,
        string permission,
        CancellationToken cancellationToken = default);
}
`;
}

/**
 * @param {string} ns
 */
function renderPermissionRequirement(ns) {
  return `using Microsoft.AspNetCore.Authorization;

namespace ${ns}.API.Authorization;

public sealed class PermissionRequirement : IAuthorizationRequirement
{
    public PermissionRequirement(string permission)
    {
        Permission = permission;
    }

    public string Permission { get; }
}
`;
}

/**
 * @param {string} ns
 */
function renderPermissionHandler(ns) {
  return `using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using ${ns}.Application.Abstractions.Authorization;

namespace ${ns}.API.Authorization;

/// <summary>
/// Resolves the acting user's granted permissions from their role claims and
/// the RolePermission table, then evaluates the required permission.
/// A "permission" claim baked into the token short-circuits the DB lookup.
/// </summary>
public sealed class PermissionAuthorizationHandler
    : AuthorizationHandler<PermissionRequirement>
{
    private readonly IPermissionService _permissionService;

    public PermissionAuthorizationHandler(IPermissionService permissionService)
    {
        _permissionService = permissionService;
    }

    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PermissionRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        var hasClaim = context.User.Claims.Any(claim =>
            claim.Type == "permission" && claim.Value == requirement.Permission);
        if (hasClaim)
        {
            context.Succeed(requirement);
            return;
        }

        var roleIds = context.User.Claims
            .Where(claim => claim.Type == "role_id")
            .Select(claim => Guid.TryParse(claim.Value, out var id) ? id : (Guid?)null)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .ToArray();

        if (roleIds.Length == 0)
        {
            return;
        }

        var granted = await _permissionService.HasPermissionAsync(
            roleIds,
            requirement.Permission);

        if (granted)
        {
            context.Succeed(requirement);
        }
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderPolicyProvider(ns) {
  return `using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace ${ns}.API.Authorization;

/// <summary>
/// Dynamically materializes an authorization policy for any permission name so
/// controllers can use [HasPermission(PermissionConstants.X)] without manual
/// policy registration.
/// </summary>
public sealed class PermissionPolicyProvider : DefaultAuthorizationPolicyProvider
{
    public const string PolicyPrefix = "perm:";

    public PermissionPolicyProvider(IOptions<AuthorizationOptions> options)
        : base(options)
    {
    }

    public override async Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        var existing = await base.GetPolicyAsync(policyName);
        if (existing is not null)
        {
            return existing;
        }

        var permission = policyName.StartsWith(PolicyPrefix, StringComparison.OrdinalIgnoreCase)
            ? policyName[PolicyPrefix.Length..]
            : policyName;

        return new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .AddRequirements(new PermissionRequirement(permission))
            .Build();
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderHasPermissionAttribute(ns) {
  return `using Microsoft.AspNetCore.Authorization;
using ${ns}.API.Authorization;

namespace ${ns}.API.Attributes;

public sealed class HasPermissionAttribute : AuthorizeAttribute
{
    public HasPermissionAttribute(string permission)
        : base(PermissionPolicyProvider.PolicyPrefix + permission)
    {
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderPermissionServiceImplementation(ns) {
  return `using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Authorization;
using ${ns}.Application.Abstractions.Persistence;

namespace ${ns}.Infrastructure.Authorization.Services;

public sealed class PermissionService : IPermissionService
{
    private readonly IApplicationDbContext _dbContext;

    public PermissionService(IApplicationDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<IReadOnlyCollection<string>> GetPermissionsForRolesAsync(
        IEnumerable<Guid> roleIds,
        CancellationToken cancellationToken = default)
    {
        var ids = roleIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return Array.Empty<string>();
        }

        return await _dbContext.RolePermissions
            .AsNoTracking()
            .Where(item => ids.Contains(item.RoleId))
            .Select(item => item.Permission)
            .Distinct()
            .ToArrayAsync(cancellationToken);
    }

    public async Task<bool> HasPermissionAsync(
        IEnumerable<Guid> roleIds,
        string permission,
        CancellationToken cancellationToken = default)
    {
        var ids = roleIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return false;
        }

        return await _dbContext.RolePermissions
            .AsNoTracking()
            .AnyAsync(
                item => ids.Contains(item.RoleId) && item.Permission == permission,
                cancellationToken);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderPermissionSeeder(ns) {
  return `using Microsoft.EntityFrameworkCore;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Domain.Entities;

namespace ${ns}.Infrastructure.Seeders.Identity;

/// <summary>
/// Idempotently grants a set of permissions to a role. Safe to run on every
/// startup: only missing (RoleId, Permission) pairs are inserted.
/// </summary>
public static class PermissionSeeder
{
    public static async Task SeedRoleAsync(
        IApplicationDbContext dbContext,
        Guid roleId,
        IEnumerable<string> permissions,
        CancellationToken cancellationToken = default)
    {
        var desired = permissions.Distinct().ToArray();
        if (desired.Length == 0)
        {
            return;
        }

        var existing = await dbContext.RolePermissions
            .Where(item => item.RoleId == roleId && desired.Contains(item.Permission))
            .Select(item => item.Permission)
            .ToListAsync(cancellationToken);

        var missing = desired.Except(existing).ToArray();
        if (missing.Length == 0)
        {
            return;
        }

        foreach (var permission in missing)
        {
            dbContext.RolePermissions.Add(new RolePermission
            {
                RoleId = roleId,
                Permission = permission,
                CreatedAtUtc = DateTime.UtcNow,
            });
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
`;
}
