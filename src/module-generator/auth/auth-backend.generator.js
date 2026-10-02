import path from 'node:path';
import { paths, routerUpdate } from '../modules-orchestrator-helpers.js';
import { upsertContextDbSet } from '../../feature-generator/backend/clean-architecture.js';
import { assertBackendCompatibility } from '../../models/backend.js';

/**
 * V4 Authentication module — backend generator.
 *
 * Produces complete, compilable C# files for a Clean Architecture solution
 * (Domain / Application / Infrastructure / API) using `projectName` as the
 * root namespace.
 *
 * Security guarantees baked into the generated code:
 *   - Refresh tokens are NEVER stored in plaintext (SHA-256 hash only).
 *   - Refresh tokens are NEVER returned in JSON — they only travel in an
 *     HttpOnly cookie.
 *   - No production admin password is hardcoded (seeding is opt-in via config).
 *   - Access tokens are short-lived (default 15 minutes).
 *
 * The generator cannot rewrite `Program.cs`, `ApplicationDbContext.cs`, or the
 * `.csproj` files by itself. `planAuthBackend` therefore returns pure file
 * plans, and the orchestrator is expected to:
 *   1. Change `ApplicationDbContext` base class to
 *      `IdentityDbContext<ApplicationUser, ApplicationRole, Guid>`.
 *   2. Patch `Program.cs` (see `auth-program-patch.js`).
 *   3. Merge the appsettings fragment (see `getAuthAppsettingsPatch`).
 *   4. Ensure the required packages / framework references are present.
 * See `AUTH_BACKEND_ORCHESTRATION_NOTES` for the full checklist.
 */

/**
 * @typedef {object} AuthBackendConfig
 * @property {string} projectName Root namespace / PascalCase project name.
 * @property {string} [defaultRole] Role assigned on registration. Default `User`.
 * @property {string[]} [roles] Roles to seed. Default `['Admin','Editor','User']`.
 * @property {boolean} [dryRun] Passed through by the CLI (unused while planning).
 * @property {boolean} [force] Passed through by the CLI (unused while planning).
 */

/**
 * @typedef {object} PlannedFile
 * @property {string} relativePath
 * @property {string} contents
 * @property {'create'|'ifMissing'|'replace'} [writeMode]
 */

const DEFAULT_ROLES = ['Admin', 'Editor', 'User'];
const DEFAULT_ROLE = 'User';

/**
 * Human-readable checklist the orchestrator must action after writing files.
 */
export const AUTH_BACKEND_ORCHESTRATION_NOTES = [
  'Change ApplicationDbContext base type from "DbContext" to "IdentityDbContext<ApplicationUser, ApplicationRole, Guid>" (keep the IApplicationDbContext interface and the existing OnModelCreating body — base.OnModelCreating configures Identity).',
  'Add "using <ProjectName>.Infrastructure.Identity;" to ApplicationDbContext.cs for the ApplicationUser/ApplicationRole types.',
  'Patch Program.cs via patchProgramForAuth() to register AddAuthModule and insert UseAuthentication/UseAuthorization before MapControllers.',
  'Merge getAuthAppsettingsPatch() into appsettings.json (and provide a Development override with Secure=false / SameSite=Lax if serving over http).',
  'Provide the JWT signing key out-of-band via the environment variable "Jwt__SigningKey" (never commit a production key).',
  'Ensure packages: Infrastructure references Microsoft.AspNetCore.Identity.EntityFrameworkCore, Microsoft.AspNetCore.Authentication.JwtBearer, System.IdentityModel.Tokens.Jwt and <FrameworkReference Include="Microsoft.AspNetCore.App" />; Application references Microsoft.AspNetCore.Authorization.',
  'Run an EF migration (e.g. AddAuthModule) to create the Identity + RefreshTokens tables.',
];

/**
 * Plan every backend file required by the Authentication module.
 *
 * @param {AuthBackendConfig} config
 * @returns {PlannedFile[]}
 */
export function planAuthBackend(config) {
  const orm = config?.manifest?.backend?.orm ?? config?.orm ?? 'efcore';
  if (orm === 'dapper') {
    throw new Error(
      'Cannot generate Authentication for a Dapper-only project. Identity requires EF Core. Use --orm efcore or --orm efcore-dapper.',
    );
  }
  const architecture = config?.manifest?.backend?.architecture ?? config?.architecture ?? 'cqrs-mediatr';
  const presentation = config?.manifest?.backend?.presentation ?? config?.presentation ?? 'controllers';
  const authMode = config?.manifest?.backend?.authentication ?? config?.authMode ?? 'identity-jwt';
  const isCookieAuth = authMode === 'identity-cookies' || authMode === 'identity-cookie' || authMode === 'identity' || authMode === 'cookies';
  const isJwt = !isCookieAuth;

  assertBackendCompatibility({
    orm,
    authentication: authMode,
    presentation,
  });

  const ns = requireProjectName(config);
  const defaultRole = normalizeRole(config?.defaultRole) || DEFAULT_ROLE;
  const roles = normalizeRoles(config?.roles, defaultRole);
  const ctx = {
    ns,
    roles,
    defaultRole,
    architecture,
    presentation,
    authMode,
    isCookieAuth,
    isJwt,
  };

  /** @type {PlannedFile[]} */
  const files = [];

  const infraIdentity = (...segments) =>
    paths.infrastructure('Identity', ...segments);
  const infraAuth = (...segments) =>
    paths.infrastructure('Authentication', ...segments);
  const infraPersistence = (...segments) =>
    paths.infrastructure('Persistence', ...segments);
  const appAbstractions = (...segments) =>
    paths.application('Abstractions', ...segments);
  const appAuthz = (...segments) =>
    paths.application('Common', 'Authorization', ...segments);
  const appFeature = (...segments) =>
    paths.application('Features', 'Authentication', ...segments);
  const appModule = (...segments) =>
    paths.application('Modules', 'Authentication', ...segments);
  const api = (...segments) => paths.api(...segments);
  const web = (...segments) => paths.web(...segments);

  const isWebProject = presentation === 'mvc' || presentation === 'razor-pages';
  const presentationTarget = isWebProject ? web : api;

  // --- Infrastructure/Identity -------------------------------------------
  files.push(
    { relativePath: infraIdentity('Entities', 'ApplicationUser.cs'), contents: renderApplicationUser(ctx) },
    { relativePath: infraIdentity('Entities', 'ApplicationRole.cs'), contents: renderApplicationRole(ctx) },
    { relativePath: infraIdentity('Services', 'IdentityService.cs'), contents: renderIdentityService(ctx) },
  );

  // --- Infrastructure/Authentication -------------------------------------
  if (isJwt) {
    files.push(
      { relativePath: infraAuth('Options', 'JwtOptions.cs'), contents: renderJwtOptions(ctx), writeMode: 'replace' },
      { relativePath: infraAuth('Services', 'IJwtTokenService.cs'), contents: renderIJwtTokenService(ctx) },
      { relativePath: infraAuth('Services', 'JwtTokenService.cs'), contents: renderJwtTokenService(ctx) },
      { relativePath: infraAuth('Services', 'IRefreshTokenService.cs'), contents: renderIRefreshTokenService(ctx) },
      { relativePath: infraAuth('Services', 'RefreshTokenService.cs'), contents: renderRefreshTokenService(ctx) },
    );
  }

  // --- Presentation Layer (Services, Authentication & Authorization) ----
  files.push(
    { relativePath: presentationTarget('Services', 'CurrentUserService.cs'), contents: renderCurrentUserService(ctx) },
    { relativePath: presentationTarget('Authorization', 'PermissionRequirement.cs'), contents: renderPermissionRequirement(ctx) },
    { relativePath: presentationTarget('Authorization', 'PermissionAuthorizationHandler.cs'), contents: renderPermissionAuthorizationHandler(ctx) },
    { relativePath: presentationTarget('Authorization', 'PermissionPolicyProvider.cs'), contents: renderPermissionPolicyProvider(ctx) },
    { relativePath: presentationTarget('Attributes', 'HasPermissionAttribute.cs'), contents: renderHasPermissionAttribute(ctx) },
  );

  if (isJwt) {
    files.push(
      { relativePath: presentationTarget('Authentication', 'Options', 'RefreshTokenCookieOptions.cs'), contents: renderRefreshTokenCookieOptions(ctx) },
      { relativePath: presentationTarget('Authentication', 'Services', 'RefreshTokenCookieManager.cs'), contents: renderRefreshTokenCookieManager(ctx) },
      { relativePath: presentationTarget('Authentication', 'Services', 'AuthCookieService.cs'), contents: renderAuthCookieService(ctx) },
    );
  }

  files.push(
    {
      relativePath: paths.infrastructure('Email', 'Services', 'DevelopmentEmailSender.cs'),
      contents: renderDevelopmentEmailSender(ctx),
    },
    {
      relativePath: paths.infrastructure('Seeders', 'DatabaseSeeder.cs'),
      contents: renderDatabaseSeeder(ctx),
    },
    {
      relativePath: paths.infrastructure('Seeders', 'Identity', 'RoleSeeder.cs'),
      contents: renderRoleSeeder(ctx),
    },
    {
      relativePath: paths.infrastructure('Seeders', 'Identity', 'PermissionSeeder.cs'),
      contents: renderPermissionSeeder(ctx),
    },
    {
      relativePath: paths.infrastructure('Seeders', 'Identity', 'AdminUserSeeder.cs'),
      contents: renderAdminUserSeeder(ctx),
    },
    {
      relativePath: paths.infrastructure('DependencyInjection', 'AuthenticationServiceExtensions.cs'),
      contents: renderAuthDependencyInjection(ctx),
    },
    {
      relativePath: paths.infrastructure('DependencyInjection', 'AuthApplicationBuilderExtensions.cs'),
      contents: renderAuthApplicationBuilderExtensions(ctx),
    },
  );

  // --- Infrastructure/Persistence ----------------------------------------
  if (isJwt) {
    files.push(
      { relativePath: infraPersistence('Entities', 'RefreshToken.cs'), contents: renderRefreshTokenEntity(ctx) },
      { relativePath: infraPersistence('Configurations', 'RefreshTokenConfiguration.cs'), contents: renderRefreshTokenConfiguration(ctx) },
    );
  }

  // --- Application/Abstractions (shared → ifMissing) ----------------------
  files.push(
    { relativePath: appAbstractions('Identity', 'ICurrentUser.cs'), contents: renderICurrentUser(ctx), writeMode: 'ifMissing' },
    { relativePath: appAbstractions('Email', 'IEmailSender.cs'), contents: renderIEmailSender(ctx), writeMode: 'ifMissing' },
    { relativePath: appAbstractions('Identity', 'IIdentityService.cs'), contents: renderIIdentityService(ctx) },
  );

  if (isJwt) {
    files.push(
      { relativePath: appAbstractions('Authentication', 'AuthTokens.cs'), contents: renderAuthTokens(ctx) },
      { relativePath: appAbstractions('Authentication', 'IAuthCookieService.cs'), contents: renderIAuthCookieService(ctx) },
    );
  }

  // --- Application/Common/Authorization -----------------------------------
  files.push(
    { relativePath: appAuthz('AppRoles.cs'), contents: renderAppRoles(ctx) },
    { relativePath: appAuthz('AppPermissions.cs'), contents: renderAppPermissions(ctx) },
  );

  // --- Application Layer (Architecture Dependent) -----------------------
  if (architecture === 'services') {
    files.push(
      { relativePath: appModule('DTOs', 'UserInfoDto.cs'), contents: renderUserInfoDto(ctx) },
      ...(isJwt ? [{ relativePath: appModule('DTOs', 'AuthResponseDto.cs'), contents: renderAuthResponseDto(ctx) }] : []),
      { relativePath: appModule('DTOs', 'RegisterRequestDto.cs'), contents: renderRegisterRequestDto(ctx) },
      { relativePath: appModule('DTOs', 'LoginRequestDto.cs'), contents: renderLoginRequestDto(ctx) },
      { relativePath: appModule('Interfaces', 'IAuthService.cs'), contents: renderIAuthService(ctx) },
      { relativePath: appModule('Services', 'AuthService.cs'), contents: renderAuthService(ctx) },
      { relativePath: appModule('Validators', 'RegisterRequestValidator.cs'), contents: renderRegisterRequestValidator(ctx) },
      { relativePath: appModule('Validators', 'LoginRequestValidator.cs'), contents: renderLoginRequestValidator(ctx) },
    );
  } else {
    files.push(
      { relativePath: appFeature('DTOs', 'UserInfoDto.cs'), contents: renderUserInfoDto(ctx) },
      ...(isJwt ? [{ relativePath: appFeature('DTOs', 'AuthResponseDto.cs'), contents: renderAuthResponseDto(ctx) }] : []),
      { relativePath: appFeature('Commands', 'Register', 'RegisterCommand.cs'), contents: renderRegisterCommand(ctx) },
      { relativePath: appFeature('Commands', 'Register', 'RegisterCommandHandler.cs'), contents: renderRegisterHandler(ctx) },
      { relativePath: appFeature('Commands', 'Register', 'RegisterCommandValidator.cs'), contents: renderRegisterValidator(ctx) },
      { relativePath: appFeature('Commands', 'Login', 'LoginCommand.cs'), contents: renderLoginCommand(ctx) },
      { relativePath: appFeature('Commands', 'Login', 'LoginCommandHandler.cs'), contents: renderLoginHandler(ctx) },
      { relativePath: appFeature('Commands', 'Login', 'LoginCommandValidator.cs'), contents: renderLoginValidator(ctx) },
      ...(isJwt
        ? [
            { relativePath: appFeature('Commands', 'RefreshToken', 'RefreshTokenCommand.cs'), contents: renderRefreshCommand(ctx) },
            { relativePath: appFeature('Commands', 'RefreshToken', 'RefreshTokenCommandHandler.cs'), contents: renderRefreshHandler(ctx) },
          ]
        : []),
      { relativePath: appFeature('Commands', 'Logout', 'LogoutCommand.cs'), contents: renderLogoutCommand(ctx) },
      { relativePath: appFeature('Commands', 'Logout', 'LogoutCommandHandler.cs'), contents: renderLogoutHandler(ctx) },
      { relativePath: appFeature('Queries', 'GetMe', 'GetMeQuery.cs'), contents: renderGetMeQuery(ctx) },
      { relativePath: appFeature('Queries', 'GetMe', 'GetMeQueryHandler.cs'), contents: renderGetMeHandler(ctx) },
    );
  }

  // --- Presentation Layer ------------------------------------------------
  if (presentation === 'controllers') {
    files.push({ relativePath: api('Controllers', 'AuthController.cs'), contents: renderAuthController(ctx) });
  } else if (presentation === 'minimal-api') {
    files.push({ relativePath: api('Endpoints', 'Authentication', 'AuthEndpoints.cs'), contents: renderMinimalApiAuthEndpoints(ctx) });
  } else if (presentation === 'mvc') {
    files.push(
      { relativePath: web('Controllers', 'AccountController.cs'), contents: renderMvcAccountController(ctx) },
      { relativePath: web('ViewModels', 'Account', 'LoginViewModel.cs'), contents: renderLoginViewModel(ctx) },
      { relativePath: web('ViewModels', 'Account', 'RegisterViewModel.cs'), contents: renderRegisterViewModel(ctx) },
      { relativePath: web('Views', 'Account', 'Login.cshtml'), contents: renderLoginView(ctx) },
      { relativePath: web('Views', 'Account', 'Register.cshtml'), contents: renderRegisterView(ctx) },
    );
  } else if (presentation === 'razor-pages') {
    files.push(
      { relativePath: web('Pages', 'Account', 'Login.cshtml'), contents: renderRazorLoginPage(ctx) },
      { relativePath: web('Pages', 'Account', 'Login.cshtml.cs'), contents: renderRazorLoginPageModel(ctx) },
      { relativePath: web('Pages', 'Account', 'Register.cshtml'), contents: renderRazorRegisterPage(ctx) },
      { relativePath: web('Pages', 'Account', 'Register.cshtml.cs'), contents: renderRazorRegisterPageModel(ctx) },
      { relativePath: web('Pages', 'Account', 'Logout.cshtml'), contents: renderRazorLogoutPage(ctx) },
      { relativePath: web('Pages', 'Account', 'Logout.cshtml.cs'), contents: renderRazorLogoutPageModel(ctx) },
    );
  }

  return files;
}

/**
 * Router + persistence registry updates for the Authentication module.
 *
 * @param {AuthBackendConfig} config
 */
export function planAuthRegistryUpdates(config) {
  const ns = requireProjectName(config);
  const presentation = config?.manifest?.backend?.presentation ?? config?.presentation ?? 'controllers';
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const authMode = config?.manifest?.backend?.authentication ?? config?.authMode ?? 'identity-jwt';
  const isJwt = !(authMode === 'identity-cookies' || authMode === 'identity-cookie' || authMode === 'identity' || authMode === 'cookies');
  const updates = [];

  if (!isWeb) {
    updates.push(
      routerUpdate(ns, 'Authentication', 'Auth', [
        { name: 'Root' },
        { name: 'Register', suffix: '/Register' },
        { name: 'Login', suffix: '/Login' },
        ...(isJwt ? [{ name: 'Refresh', suffix: '/Refresh' }] : []),
        { name: 'Logout', suffix: '/Logout' },
        { name: 'Me', suffix: '/Me' },
      ]),
    );
  }

  if (isJwt) {
    updates.push({
      relativePath: paths.infrastructure('Persistence', 'ApplicationDbContext.cs'),
      update: (existing) =>
        upsertContextDbSet(
          existing,
          ns,
          'RefreshToken',
          'RefreshTokens',
          `${ns}.Infrastructure.Persistence.Entities`,
        ),
    });
  }

  return updates;
}

/**
 * Marker paths indicating the auth module is already installed. When any of
 * these exist the orchestrator should refuse to overwrite without `--force`.
 *
 * @param {AuthBackendConfig} config
 * @returns {string[]}
 */
export function authBackendConflictPaths(config) {
  requireProjectName(config);
  const presentation = config?.manifest?.backend?.presentation ?? config?.presentation ?? 'controllers';
  const architecture = config?.manifest?.backend?.architecture ?? config?.architecture ?? 'cqrs-mediatr';

  const conflictPaths = [
    path.join('Infrastructure', 'DependencyInjection', 'AuthenticationServiceExtensions.cs'),
    path.join('Application', 'Common', 'Authorization', 'AppPermissions.cs'),
  ];

  if (architecture === 'services') {
    conflictPaths.push(path.join('Application', 'Modules', 'Authentication'));
  } else {
    conflictPaths.push(path.join('Application', 'Features', 'Authentication'));
  }

  if (presentation === 'controllers') {
    conflictPaths.push(path.join('API', 'Controllers', 'AuthController.cs'));
  } else if (presentation === 'minimal-api') {
    conflictPaths.push(path.join('API', 'Endpoints', 'Authentication', 'AuthEndpoints.cs'));
  } else if (presentation === 'mvc') {
    conflictPaths.push(path.join('Web', 'Controllers', 'AccountController.cs'));
  } else if (presentation === 'razor-pages') {
    conflictPaths.push(path.join('Web', 'Pages', 'Account'));
  }

  return conflictPaths;
}

/**
 * appsettings.json fragment to deep-merge. Secrets are intentionally empty:
 * the signing key must be provided via the `Jwt__SigningKey` environment
 * variable, and admin seeding is disabled by default.
 *
 * @returns {Record<string, unknown>}
 */
export function getAuthAppsettingsPatch() {
  return {
    Jwt: {
      Issuer: 'fullstack-app',
      Audience: 'fullstack-app-client',
      // Provide via environment: Jwt__SigningKey. Never commit a real key.
      SigningKey: '',
      AccessTokenMinutes: 15,
    },
    RefreshToken: {
      CookieName: 'refreshToken',
      Path: '/',
      HttpOnly: true,
      Secure: true,
      // "None" requires HTTPS. Use "Lax" + Secure=false in a Development override
      // when serving the API over http://localhost.
      SameSite: 'None',
      Days: 7,
    },
    Auth: {
      SeedAdmin: {
        Enabled: false,
        Email: '',
        Password: '',
      },
    },
  };
}

/* ====================================================================== */
/* Config helpers                                                         */
/* ====================================================================== */

/**
 * @param {AuthBackendConfig} config
 * @returns {string}
 */
function requireProjectName(config) {
  const name = config?.projectName;
  if (!name || typeof name !== 'string') {
    throw new Error('planAuthBackend requires config.projectName.');
  }
  return name;
}

/**
 * @param {unknown} role
 * @returns {string}
 */
function normalizeRole(role) {
  return typeof role === 'string' ? role.trim() : '';
}

/**
 * Deduplicate roles (case-insensitive) and guarantee the default role exists.
 * @param {unknown} roles
 * @param {string} defaultRole
 * @returns {string[]}
 */
function normalizeRoles(roles, defaultRole) {
  const source = Array.isArray(roles) && roles.length > 0 ? roles : DEFAULT_ROLES;
  /** @type {string[]} */
  const result = [];
  const seen = new Set();
  for (const candidate of [...source, defaultRole]) {
    const value = normalizeRole(candidate);
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * Turn an arbitrary role name into a valid C# identifier for a constant.
 * @param {string} role
 * @returns {string}
 */
function toRoleConst(role) {
  const cleaned = String(role)
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  if (!cleaned) {
    return 'Role';
  }
  return /^[0-9]/.test(cleaned) ? `Role${cleaned}` : cleaned;
}

/**
 * Resolve the constant name to use for the admin role (case-insensitive match),
 * falling back to the default role when no explicit Admin role is configured.
 * @param {{ roles: string[], defaultRole: string }} ctx
 * @returns {string}
 */
function adminRoleConst(ctx) {
  const admin = ctx.roles.find((role) => role.toLowerCase() === 'admin');
  return toRoleConst(admin ?? ctx.defaultRole);
}

/* ====================================================================== */
/* Infrastructure/Authentication renderers                                */
/* ====================================================================== */

/** @param {{ ns: string }} ctx */
function renderApplicationUser({ ns }) {
  return `using Microsoft.AspNetCore.Identity;

namespace ${ns}.Infrastructure.Identity.Entities;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;
}
`;
}

/** @param {{ ns: string }} ctx */
function renderApplicationRole({ ns }) {
  return `using Microsoft.AspNetCore.Identity;

namespace ${ns}.Infrastructure.Identity.Entities;

public sealed class ApplicationRole : IdentityRole<Guid>
{
    public ApplicationRole()
    {
    }

    public ApplicationRole(string roleName)
        : base(roleName)
    {
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderJwtOptions({ ns }) {
  return `namespace ${ns}.Infrastructure.Authentication.Options;

public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; init; } = string.Empty;

    public string Audience { get; init; } = string.Empty;

    public string SigningKey { get; init; } = string.Empty;

    public int AccessTokenMinutes { get; init; } = 15;
}
`;
}

/** @param {{ ns: string, presentation?: string }} ctx */
function renderRefreshTokenCookieOptions({ ns, presentation }) {
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const folder = isWeb ? 'Web' : 'API';
  return `namespace ${ns}.${folder}.Authentication.Options;

public sealed class RefreshTokenCookieOptions
{
    public const string SectionName = "RefreshToken";

    public string CookieName { get; init; } = "refreshToken";

    public string Path { get; init; } = "/";

    public bool HttpOnly { get; init; } = true;

    public bool Secure { get; init; } = true;

    public string SameSite { get; init; } = "Lax";

    public int Days { get; init; } = 7;
}
`;
}

/** @param {{ ns: string }} ctx */
function renderIJwtTokenService({ ns }) {
  return `namespace ${ns}.Infrastructure.Authentication.Services;

public interface IJwtTokenService
{
    AccessTokenResult CreateAccessToken(
        Guid userId,
        string email,
        IEnumerable<string> roles,
        IEnumerable<string> permissions);
}

public sealed record AccessTokenResult(string AccessToken, DateTime ExpiresAtUtc);
`;
}

/** @param {{ ns: string }} ctx */
function renderJwtTokenService({ ns }) {
  return `using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using ${ns}.Application.Common.Authorization;
using ${ns}.Infrastructure.Authentication.Options;

namespace ${ns}.Infrastructure.Authentication.Services;

public sealed class JwtTokenService : IJwtTokenService
{
    private readonly JwtOptions _options;

    public JwtTokenService(IOptions<JwtOptions> options)
    {
        _options = options.Value;
    }

    public AccessTokenResult CreateAccessToken(
        Guid userId,
        string email,
        IEnumerable<string> roles,
        IEnumerable<string> permissions)
    {
        var minutes = _options.AccessTokenMinutes <= 0 ? 15 : _options.AccessTokenMinutes;
        var issuedAt = DateTime.UtcNow;
        var expiresAtUtc = issuedAt.AddMinutes(minutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };

        foreach (var role in roles)
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
        }

        foreach (var permission in permissions)
        {
            claims.Add(new Claim(AppPermissions.ClaimType, permission));
        }

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: issuedAt,
            expires: expiresAtUtc,
            signingCredentials: credentials);

        var accessToken = new JwtSecurityTokenHandler().WriteToken(token);
        return new AccessTokenResult(accessToken, expiresAtUtc);
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderIRefreshTokenService({ ns }) {
  return `namespace ${ns}.Infrastructure.Authentication.Services;

public interface IRefreshTokenService
{
    Task<RefreshTokenIssueResult> IssueAsync(
        Guid userId,
        string? createdByIp,
        CancellationToken cancellationToken);

    Task<RefreshTokenRotationResult> RotateAsync(
        string rawToken,
        string? requestIp,
        CancellationToken cancellationToken);

    Task RevokeAsync(
        string rawToken,
        string? requestIp,
        CancellationToken cancellationToken);

    Task RevokeAllForUserAsync(
        Guid userId,
        string? requestIp,
        CancellationToken cancellationToken);
}

public sealed record RefreshTokenIssueResult(string RawToken, DateTime ExpiresAtUtc);

public sealed record RefreshTokenRotationResult(
    bool Succeeded,
    Guid UserId,
    string RawToken,
    DateTime ExpiresAtUtc)
{
    public static RefreshTokenRotationResult Failure() =>
        new(false, Guid.Empty, string.Empty, DateTime.MinValue);

    public static RefreshTokenRotationResult Success(
        Guid userId,
        string rawToken,
        DateTime expiresAtUtc) =>
        new(true, userId, rawToken, expiresAtUtc);
}
`;
}

/** @param {{ ns: string }} ctx */
function renderRefreshTokenService({ ns }) {
  return `using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using ${ns}.Infrastructure.Persistence;
using ${ns}.Infrastructure.Persistence.Entities;

namespace ${ns}.Infrastructure.Authentication.Services;

public sealed class RefreshTokenService : IRefreshTokenService
{
    private const int TokenLifetimeDays = 7;
    private readonly ApplicationDbContext _dbContext;

    public RefreshTokenService(ApplicationDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<RefreshTokenIssueResult> IssueAsync(
        Guid userId,
        string? createdByIp,
        CancellationToken cancellationToken)
    {
        var (rawToken, tokenHash) = GenerateToken();
        var now = DateTime.UtcNow;

        var entity = new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TokenHash = tokenHash,
            CreatedAtUtc = now,
            ExpiresAtUtc = now.AddDays(TokenLifetimeDays),
            CreatedByIp = createdByIp,
        };

        _dbContext.RefreshTokens.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new RefreshTokenIssueResult(rawToken, entity.ExpiresAtUtc);
    }

    public async Task<RefreshTokenRotationResult> RotateAsync(
        string rawToken,
        string? requestIp,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(rawToken))
        {
            return RefreshTokenRotationResult.Failure();
        }

        var tokenHash = Hash(rawToken);
        var existing = await _dbContext.RefreshTokens
            .FirstOrDefaultAsync(token => token.TokenHash == tokenHash, cancellationToken);

        if (existing is null)
        {
            return RefreshTokenRotationResult.Failure();
        }

        // Reuse detection: a token that was already revoked is being replayed,
        // so treat the whole chain as compromised and revoke every active token.
        if (existing.RevokedAtUtc is not null)
        {
            await RevokeAllForUserAsync(existing.UserId, requestIp, cancellationToken);
            return RefreshTokenRotationResult.Failure();
        }

        if (DateTime.UtcNow >= existing.ExpiresAtUtc)
        {
            return RefreshTokenRotationResult.Failure();
        }

        var (newRawToken, newTokenHash) = GenerateToken();
        var now = DateTime.UtcNow;

        var replacement = new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = existing.UserId,
            TokenHash = newTokenHash,
            CreatedAtUtc = now,
            ExpiresAtUtc = now.AddDays(TokenLifetimeDays),
            CreatedByIp = requestIp,
        };

        existing.RevokedAtUtc = now;
        existing.RevokedByIp = requestIp;
        existing.ReplacedByTokenId = replacement.Id;

        _dbContext.RefreshTokens.Add(replacement);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return RefreshTokenRotationResult.Success(
            existing.UserId,
            newRawToken,
            replacement.ExpiresAtUtc);
    }

    public async Task RevokeAsync(
        string rawToken,
        string? requestIp,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(rawToken))
        {
            return;
        }

        var tokenHash = Hash(rawToken);
        var existing = await _dbContext.RefreshTokens
            .FirstOrDefaultAsync(token => token.TokenHash == tokenHash, cancellationToken);

        if (existing is null || existing.RevokedAtUtc is not null)
        {
            return;
        }

        existing.RevokedAtUtc = DateTime.UtcNow;
        existing.RevokedByIp = requestIp;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task RevokeAllForUserAsync(
        Guid userId,
        string? requestIp,
        CancellationToken cancellationToken)
    {
        var activeTokens = await _dbContext.RefreshTokens
            .Where(token => token.UserId == userId && token.RevokedAtUtc == null)
            .ToListAsync(cancellationToken);

        if (activeTokens.Count == 0)
        {
            return;
        }

        var now = DateTime.UtcNow;
        foreach (var token in activeTokens)
        {
            token.RevokedAtUtc = now;
            token.RevokedByIp = requestIp;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private static (string RawToken, string TokenHash) GenerateToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(64);
        var rawToken = Convert.ToBase64String(bytes);
        return (rawToken, Hash(rawToken));
    }

    private static string Hash(string rawToken)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
        return Convert.ToHexString(hash);
    }
}
`;
}

/** @param {{ ns: string, presentation?: string }} ctx */
function renderRefreshTokenCookieManager({ ns, presentation }) {
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const folder = isWeb ? 'Web' : 'API';
  return `using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using ${ns}.${folder}.Authentication.Options;

namespace ${ns}.${folder}.Authentication.Services;

public interface IRefreshTokenCookieManager
{
    void SetCookie(HttpResponse response, string rawToken, DateTime expiresAtUtc);

    void DeleteCookie(HttpResponse response);

    string? ReadCookie(HttpRequest request);
}

public sealed class RefreshTokenCookieManager : IRefreshTokenCookieManager
{
    private readonly RefreshTokenCookieOptions _options;

    public RefreshTokenCookieManager(IOptions<RefreshTokenCookieOptions> options)
    {
        _options = options.Value;
    }

    public void SetCookie(HttpResponse response, string rawToken, DateTime expiresAtUtc)
    {
        response.Cookies.Append(_options.CookieName, rawToken, BuildOptions(expiresAtUtc));
    }

    public void DeleteCookie(HttpResponse response)
    {
        response.Cookies.Delete(_options.CookieName, BuildOptions(DateTime.UtcNow.AddDays(-1)));
    }

    public string? ReadCookie(HttpRequest request)
    {
        return request.Cookies.TryGetValue(_options.CookieName, out var value) ? value : null;
    }

    private CookieOptions BuildOptions(DateTime expiresAtUtc)
    {
        return new CookieOptions
        {
            HttpOnly = _options.HttpOnly,
            Secure = _options.Secure,
            Path = _options.Path,
            Expires = expiresAtUtc,
            SameSite = ParseSameSite(_options.SameSite),
            IsEssential = true,
        };
    }

    private static SameSiteMode ParseSameSite(string value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "none" => SameSiteMode.None,
            "strict" => SameSiteMode.Strict,
            "lax" => SameSiteMode.Lax,
            _ => SameSiteMode.Lax,
        };
    }
}
`;
}

/** @param {{ ns: string, presentation?: string }} ctx */
function renderAuthCookieService({ ns, presentation }) {
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const folder = isWeb ? 'Web' : 'API';
  return `using Microsoft.AspNetCore.Http;
using ${ns}.Application.Abstractions.Authentication;

namespace ${ns}.${folder}.Authentication.Services;

public sealed class AuthCookieService : IAuthCookieService
{
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IRefreshTokenCookieManager _cookieManager;

    public AuthCookieService(
        IHttpContextAccessor httpContextAccessor,
        IRefreshTokenCookieManager cookieManager)
    {
        _httpContextAccessor = httpContextAccessor;
        _cookieManager = cookieManager;
    }

    public string? ReadRefreshToken()
    {
        var request = _httpContextAccessor.HttpContext?.Request;
        return request is null ? null : _cookieManager.ReadCookie(request);
    }

    public void WriteRefreshToken(string rawToken, DateTime expiresAtUtc)
    {
        var response = _httpContextAccessor.HttpContext?.Response;
        if (response is not null)
        {
            _cookieManager.SetCookie(response, rawToken, expiresAtUtc);
        }
    }

    public void DeleteRefreshToken()
    {
        var response = _httpContextAccessor.HttpContext?.Response;
        if (response is not null)
        {
            _cookieManager.DeleteCookie(response);
        }
    }
}
`;
}

/** @param {{ ns: string, presentation?: string }} ctx */
function renderCurrentUserService({ ns, presentation }) {
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const folder = isWeb ? 'Web' : 'API';
  return `using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Authorization;

namespace ${ns}.${folder}.Services;

public sealed class CurrentUserService : ICurrentUser
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CurrentUserService(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    private ClaimsPrincipal? Principal => _httpContextAccessor.HttpContext?.User;

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated ?? false;

    public Guid? UserId
    {
        get
        {
            var value = Principal?.FindFirstValue("sub")
                ?? Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            return Guid.TryParse(value, out var id) ? id : null;
        }
    }

    public string? Email =>
        Principal?.FindFirstValue("email")
        ?? Principal?.FindFirstValue(ClaimTypes.Email);

    public IReadOnlyList<string> Roles =>
        Principal?.FindAll(ClaimTypes.Role).Select(claim => claim.Value).ToList()
        ?? new List<string>();

    public IReadOnlyList<string> Permissions =>
        Principal?.FindAll(AppPermissions.ClaimType).Select(claim => claim.Value).ToList()
        ?? new List<string>();
}
`;
}

/** @param {{ ns: string, isJwt: boolean, isCookieAuth: boolean, architecture: string }} ctx */
function renderIdentityService(ctx) {
  const { ns, isJwt, architecture } = ctx;
  const dtoNs = `${ns}.Application.${architecture === 'services' ? 'Modules' : 'Features'}.Authentication.DTOs`;

  if (!isJwt) {
    return `using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Authorization;
using ${ns}.Application.Common.Results;
using ${dtoNs};
using ${ns}.Infrastructure.Identity.Entities;

namespace ${ns}.Infrastructure.Identity.Services;

public sealed class IdentityService : IIdentityService
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly RoleManager<ApplicationRole> _roleManager;
    private readonly SignInManager<ApplicationUser> _signInManager;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public IdentityService(
        UserManager<ApplicationUser> userManager,
        RoleManager<ApplicationRole> roleManager,
        SignInManager<ApplicationUser> signInManager,
        IHttpContextAccessor httpContextAccessor)
    {
        _userManager = userManager;
        _roleManager = roleManager;
        _signInManager = signInManager;
        _httpContextAccessor = httpContextAccessor;
    }

    public async Task<Result<Guid>> RegisterAsync(
        string email,
        string password,
        string displayName,
        string role,
        CancellationToken cancellationToken = default)
    {
        var existing = await _userManager.FindByEmailAsync(email);
        if (existing is not null)
        {
            return Result.Failure<Guid>(
                Error.Conflict("Auth.EmailInUse", "An account with this email already exists."));
        }

        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            Email = email,
            UserName = email,
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? email : displayName,
        };

        var createResult = await _userManager.CreateAsync(user, password);
        if (!createResult.Succeeded)
        {
            return Result.Failure<Guid>(
                Error.Validation("Auth.RegistrationFailed", DescribeIdentityErrors(createResult)));
        }

        if (await _roleManager.RoleExistsAsync(role))
        {
            await _userManager.AddToRoleAsync(user, role);
        }

        return Result.Success(user.Id);
    }

    public async Task<Result<UserInfoDto>> SignInCookieAsync(
        string email,
        string password,
        bool isPersistent,
        CancellationToken cancellationToken = default)
    {
        var user = await _userManager.FindByEmailAsync(email);
        if (user is null)
        {
            return Result.Failure<UserInfoDto>(InvalidCredentials());
        }

        var result = await _signInManager.PasswordSignInAsync(user, password, isPersistent, lockoutOnFailure: false);
        if (!result.Succeeded)
        {
            return Result.Failure<UserInfoDto>(InvalidCredentials());
        }

        var (roles, permissions) = await GetRolesAndPermissionsAsync(user);
        return Result.Success(BuildUserInfo(user, roles, permissions));
    }

    public async Task SignOutCookieAsync(CancellationToken cancellationToken = default)
    {
        await _signInManager.SignOutAsync();
    }

    public async Task<Result<UserInfoDto>> GetUserInfoAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null)
        {
            return Result.Failure<UserInfoDto>(
                Error.NotFound("Auth.UserNotFound", "The user was not found."));
        }

        var (roles, permissions) = await GetRolesAndPermissionsAsync(user);
        return Result.Success(BuildUserInfo(user, roles, permissions));
    }

    private async Task<(IReadOnlyList<string> Roles, IReadOnlyList<string> Permissions)> GetRolesAndPermissionsAsync(
        ApplicationUser user)
    {
        var roles = await _userManager.GetRolesAsync(user);
        var permissions = new HashSet<string>(StringComparer.Ordinal);

        foreach (var roleName in roles)
        {
            var role = await _roleManager.FindByNameAsync(roleName);
            if (role is null)
            {
                continue;
            }

            var claims = await _roleManager.GetClaimsAsync(role);
            foreach (var claim in claims.Where(claim => claim.Type == AppPermissions.ClaimType))
            {
                permissions.Add(claim.Value);
            }
        }

        return (roles.ToList(), permissions.ToList());
    }

    private static UserInfoDto BuildUserInfo(
        ApplicationUser user,
        IReadOnlyList<string> roles,
        IReadOnlyList<string> permissions) =>
        new()
        {
            Id = user.Id,
            Email = user.Email ?? string.Empty,
            DisplayName = user.DisplayName,
            Roles = roles,
            Permissions = permissions,
        };

    private static Error InvalidCredentials() =>
        Error.Unauthorized("Auth.InvalidCredentials", "Invalid email or password.");

    private static string DescribeIdentityErrors(IdentityResult result) =>
        string.Join(" ", result.Errors.Select(error => error.Description));
}
`;
  }

  return `using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using ${ns}.Application.Abstractions.Authentication;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Authorization;
using ${ns}.Application.Common.Results;
using ${dtoNs};
using ${ns}.Infrastructure.Authentication.Services;
using ${ns}.Infrastructure.Identity.Entities;

namespace ${ns}.Infrastructure.Identity.Services;

public sealed class IdentityService : IIdentityService
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly RoleManager<ApplicationRole> _roleManager;
    private readonly IJwtTokenService _jwtTokenService;
    private readonly IRefreshTokenService _refreshTokenService;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public IdentityService(
        UserManager<ApplicationUser> userManager,
        RoleManager<ApplicationRole> roleManager,
        IJwtTokenService jwtTokenService,
        IRefreshTokenService refreshTokenService,
        IHttpContextAccessor httpContextAccessor)
    {
        _userManager = userManager;
        _roleManager = roleManager;
        _jwtTokenService = jwtTokenService;
        _refreshTokenService = refreshTokenService;
        _httpContextAccessor = httpContextAccessor;
    }

    private string? RequestIp =>
        _httpContextAccessor.HttpContext?.Connection.RemoteIpAddress?.ToString();

    public async Task<Result<Guid>> RegisterAsync(
        string email,
        string password,
        string displayName,
        string role,
        CancellationToken cancellationToken = default)
    {
        var existing = await _userManager.FindByEmailAsync(email);
        if (existing is not null)
        {
            return Result.Failure<Guid>(
                Error.Conflict("Auth.EmailInUse", "An account with this email already exists."));
        }

        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            Email = email,
            UserName = email,
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? email : displayName,
        };

        var createResult = await _userManager.CreateAsync(user, password);
        if (!createResult.Succeeded)
        {
            return Result.Failure<Guid>(
                Error.Validation("Auth.RegistrationFailed", DescribeIdentityErrors(createResult)));
        }

        if (await _roleManager.RoleExistsAsync(role))
        {
            await _userManager.AddToRoleAsync(user, role);
        }

        return Result.Success(user.Id);
    }

    public async Task<Result<AuthTokens>> PasswordSignInAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        var user = await _userManager.FindByEmailAsync(email);
        if (user is null || !await _userManager.CheckPasswordAsync(user, password))
        {
            return Result.Failure<AuthTokens>(InvalidCredentials());
        }

        var tokens = await BuildTokensAsync(user, issueRefreshToken: true, existingRefresh: null, cancellationToken);
        return Result.Success(tokens);
    }

    public async Task<Result<AuthTokens>> RefreshAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default)
    {
        var rotation = await _refreshTokenService.RotateAsync(rawRefreshToken, RequestIp, cancellationToken);
        if (!rotation.Succeeded)
        {
            return Result.Failure<AuthTokens>(
                Error.Unauthorized("Auth.InvalidRefreshToken", "The refresh token is invalid or expired."));
        }

        var user = await _userManager.FindByIdAsync(rotation.UserId.ToString());
        if (user is null)
        {
            return Result.Failure<AuthTokens>(
                Error.Unauthorized("Auth.InvalidRefreshToken", "The refresh token is invalid or expired."));
        }

        var refresh = new RefreshTokenIssueResult(rotation.RawToken, rotation.ExpiresAtUtc);
        var tokens = await BuildTokensAsync(user, issueRefreshToken: false, existingRefresh: refresh, cancellationToken);
        return Result.Success(tokens);
    }

    public Task RevokeRefreshTokenAsync(string rawRefreshToken, CancellationToken cancellationToken = default) =>
        _refreshTokenService.RevokeAsync(rawRefreshToken, RequestIp, cancellationToken);

    public async Task<Result<UserInfoDto>> GetUserInfoAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await _userManager.FindByIdAsync(userId.ToString());
        if (user is null)
        {
            return Result.Failure<UserInfoDto>(
                Error.NotFound("Auth.UserNotFound", "The user was not found."));
        }

        var (roles, permissions) = await GetRolesAndPermissionsAsync(user);
        return Result.Success(BuildUserInfo(user, roles, permissions));
    }

    private async Task<AuthTokens> BuildTokensAsync(
        ApplicationUser user,
        bool issueRefreshToken,
        RefreshTokenIssueResult? existingRefresh,
        CancellationToken cancellationToken)
    {
        var (roles, permissions) = await GetRolesAndPermissionsAsync(user);
        var access = _jwtTokenService.CreateAccessToken(user.Id, user.Email ?? string.Empty, roles, permissions);

        var refresh = issueRefreshToken
            ? await _refreshTokenService.IssueAsync(user.Id, RequestIp, cancellationToken)
            : existingRefresh ?? throw new InvalidOperationException("A rotated refresh token is required.");

        return new AuthTokens
        {
            AccessToken = access.AccessToken,
            ExpiresAtUtc = access.ExpiresAtUtc,
            RefreshToken = refresh.RawToken,
            RefreshExpiresAtUtc = refresh.ExpiresAtUtc,
            User = BuildUserInfo(user, roles, permissions),
        };
    }

    private async Task<(IReadOnlyList<string> Roles, IReadOnlyList<string> Permissions)> GetRolesAndPermissionsAsync(
        ApplicationUser user)
    {
        var roles = await _userManager.GetRolesAsync(user);
        var permissions = new HashSet<string>(StringComparer.Ordinal);

        foreach (var roleName in roles)
        {
            var role = await _roleManager.FindByNameAsync(roleName);
            if (role is null)
            {
                continue;
            }

            var claims = await _roleManager.GetClaimsAsync(role);
            foreach (var claim in claims.Where(claim => claim.Type == AppPermissions.ClaimType))
            {
                permissions.Add(claim.Value);
            }
        }

        return (roles.ToList(), permissions.ToList());
    }

    private static UserInfoDto BuildUserInfo(
        ApplicationUser user,
        IReadOnlyList<string> roles,
        IReadOnlyList<string> permissions) =>
        new()
        {
            Id = user.Id,
            Email = user.Email ?? string.Empty,
            DisplayName = user.DisplayName,
            Roles = roles,
            Permissions = permissions,
        };

    private static Error InvalidCredentials() =>
        Error.Unauthorized("Auth.InvalidCredentials", "Invalid email or password.");

    private static string DescribeIdentityErrors(IdentityResult result) =>
        string.Join(" ", result.Errors.Select(error => error.Description));
}
`;
}

/** @param {{ ns: string }} ctx */
function renderDevelopmentEmailSender({ ns }) {
  return `using Microsoft.Extensions.Logging;
using ${ns}.Application.Abstractions.Email;

namespace ${ns}.Infrastructure.Email.Services;

/// <summary>
/// A no-op email sender for local development. It deliberately never logs
/// message bodies, links, or tokens — only the recipient and subject.
/// </summary>
public sealed class DevelopmentEmailSender : IEmailSender
{
    private readonly ILogger<DevelopmentEmailSender> _logger;

    public DevelopmentEmailSender(ILogger<DevelopmentEmailSender> logger)
    {
        _logger = logger;
    }

    public Task SendEmailAsync(
        string to,
        string subject,
        string htmlBody,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation(
            "Email suppressed in development. Recipient: {Recipient}, Subject: {Subject}",
            to,
            subject);
        return Task.CompletedTask;
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderDatabaseSeeder({ ns }) {
  return `using Microsoft.Extensions.Logging;
using ${ns}.Infrastructure.Seeders.Identity;

namespace ${ns}.Infrastructure.Seeders;

public sealed class DatabaseSeeder
{
    private readonly RoleSeeder? _roleSeeder;
    private readonly PermissionSeeder? _permissionSeeder;
    private readonly AdminUserSeeder? _adminUserSeeder;
    private readonly ILogger<DatabaseSeeder> _logger;

    public DatabaseSeeder(
        ILogger<DatabaseSeeder> logger,
        RoleSeeder? roleSeeder = null,
        PermissionSeeder? permissionSeeder = null,
        AdminUserSeeder? adminUserSeeder = null)
    {
        _logger = logger;
        _roleSeeder = roleSeeder;
        _permissionSeeder = permissionSeeder;
        _adminUserSeeder = adminUserSeeder;
    }

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting database seeding...");

        if (_roleSeeder is not null)
        {
            await _roleSeeder.SeedAsync(cancellationToken);
        }

        if (_permissionSeeder is not null)
        {
            await _permissionSeeder.SeedAsync(cancellationToken);
        }

        if (_adminUserSeeder is not null)
        {
            await _adminUserSeeder.SeedAsync(cancellationToken);
        }

        _logger.LogInformation("Database seeding completed.");
    }
}
`;
}

/** @param {{ ns: string, roles: string[], defaultRole: string }} ctx */
function renderRoleSeeder(ctx) {
  const { ns } = ctx;
  return `using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using ${ns}.Application.Common.Authorization;
using ${ns}.Infrastructure.Identity.Entities;

namespace ${ns}.Infrastructure.Seeders.Identity;

public sealed class RoleSeeder
{
    private readonly RoleManager<ApplicationRole> _roleManager;
    private readonly ILogger<RoleSeeder> _logger;

    public RoleSeeder(
        RoleManager<ApplicationRole> roleManager,
        ILogger<RoleSeeder> logger)
    {
        _roleManager = roleManager;
        _logger = logger;
    }

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        foreach (var roleName in AppRoles.All)
        {
            if (await _roleManager.RoleExistsAsync(roleName))
            {
                continue;
            }

            var role = new ApplicationRole(roleName);
            var result = await _roleManager.CreateAsync(role);
            if (!result.Succeeded)
            {
                _logger.LogError("Failed to create role {Role}.", roleName);
            }
            else
            {
                _logger.LogInformation("Seeded role {Role}.", roleName);
            }
        }
    }
}
`;
}

/** @param {{ ns: string, roles: string[], defaultRole: string }} ctx */
function renderPermissionSeeder(ctx) {
  const { ns } = ctx;
  const adminConst = adminRoleConst(ctx);
  return `using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using ${ns}.Application.Common.Authorization;
using ${ns}.Infrastructure.Identity.Entities;

namespace ${ns}.Infrastructure.Seeders.Identity;

public sealed class PermissionSeeder
{
    private readonly RoleManager<ApplicationRole> _roleManager;
    private readonly ILogger<PermissionSeeder> _logger;

    public PermissionSeeder(
        RoleManager<ApplicationRole> roleManager,
        ILogger<PermissionSeeder> logger)
    {
        _roleManager = roleManager;
        _logger = logger;
    }

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        var adminRole = await _roleManager.FindByNameAsync(AppRoles.${adminConst});
        if (adminRole is null)
        {
            _logger.LogWarning("Admin role {Role} not found for permission seeding.", AppRoles.${adminConst});
            return;
        }

        var existingClaims = await _roleManager.GetClaimsAsync(adminRole);
        var existingPermissions = existingClaims
            .Where(claim => claim.Type == AppPermissions.ClaimType)
            .Select(claim => claim.Value)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var permission in AppPermissions.All)
        {
            if (!existingPermissions.Contains(permission))
            {
                await _roleManager.AddClaimAsync(adminRole, new Claim(AppPermissions.ClaimType, permission));
                _logger.LogInformation("Granted permission {Permission} to role {Role}.", permission, AppRoles.${adminConst});
            }
        }
    }
}
`;
}

/** @param {{ ns: string, roles: string[], defaultRole: string }} ctx */
function renderAdminUserSeeder(ctx) {
  const { ns } = ctx;
  const adminConst = adminRoleConst(ctx);
  return `using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using ${ns}.Application.Common.Authorization;
using ${ns}.Infrastructure.Identity.Entities;

namespace ${ns}.Infrastructure.Seeders.Identity;

public sealed class AdminUserSeeder
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AdminUserSeeder> _logger;

    public AdminUserSeeder(
        UserManager<ApplicationUser> userManager,
        IConfiguration configuration,
        ILogger<AdminUserSeeder> logger)
    {
        _userManager = userManager;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        var enabled = _configuration.GetValue<bool>("Auth:SeedAdmin:Enabled");
        if (!enabled)
        {
            return;
        }

        var email = _configuration["Auth:SeedAdmin:Email"];
        var password = _configuration["Auth:SeedAdmin:Password"];

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            _logger.LogWarning(
                "Auth:SeedAdmin is enabled but Email/Password are not configured. Skipping admin seed.");
            return;
        }

        var existing = await _userManager.FindByEmailAsync(email);
        if (existing is not null)
        {
            return;
        }

        var admin = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            Email = email,
            UserName = email,
            DisplayName = "Administrator",
            EmailConfirmed = true,
        };

        var result = await _userManager.CreateAsync(admin, password);
        if (!result.Succeeded)
        {
            _logger.LogError("Failed to seed administrator account: {Errors}", string.Join(", ", result.Errors.Select(e => e.Description)));
            return;
        }

        await _userManager.AddToRoleAsync(admin, AppRoles.${adminConst});
        _logger.LogInformation("Seeded administrator account {Email}.", email);
    }
}
`;
}

/** @param {{ ns: string, isJwt: boolean, isCookieAuth: boolean, architecture: string }} ctx */
function renderAuthDependencyInjection(ctx) {
  const { ns, isJwt, isCookieAuth, architecture } = ctx;
  const isServices = architecture === 'services';

  if (isCookieAuth) {
    return `using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ${ns}.Application.Abstractions.Email;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Authorization;
${isServices ? `using ${ns}.Application.Modules.Authentication.Interfaces;\nusing ${ns}.Application.Modules.Authentication.Services;` : ''}
using ${ns}.Infrastructure.Email.Services;
using ${ns}.Infrastructure.Identity.Entities;
using ${ns}.Infrastructure.Identity.Services;
using ${ns}.Infrastructure.Persistence;
using ${ns}.Infrastructure.Seeders;
using ${ns}.Infrastructure.Seeders.Identity;

namespace ${ns}.Infrastructure.DependencyInjection;

public static class AuthenticationServiceExtensions
{
    public static IServiceCollection AddAuthModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddHttpContextAccessor();

        services
            .AddIdentity<ApplicationUser, ApplicationRole>(options =>
            {
                options.User.RequireUniqueEmail = true;
                options.Password.RequiredLength = 8;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = false;
            })
            .AddEntityFrameworkStores<ApplicationDbContext>()
            .AddDefaultTokenProviders();

        services.ConfigureApplicationCookie(options =>
        {
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.ExpireTimeSpan = TimeSpan.FromDays(7);
            options.SlidingExpiration = true;
            options.Events.OnRedirectToLogin = context =>
            {
                if (context.Request.Path.StartsWithSegments("/api"))
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                }
                context.Response.Redirect(context.RedirectUri);
                return Task.CompletedTask;
            };
            options.Events.OnRedirectToAccessDenied = context =>
            {
                if (context.Request.Path.StartsWithSegments("/api"))
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                }
                context.Response.Redirect(context.RedirectUri);
                return Task.CompletedTask;
            };
        });

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddFixedWindowLimiter("auth", limiter =>
            {
                limiter.PermitLimit = 30;
                limiter.Window = TimeSpan.FromMinutes(1);
                limiter.QueueLimit = 0;
            });
        });

        services.AddScoped<IIdentityService, IdentityService>();
        services.AddScoped<IEmailSender, DevelopmentEmailSender>();
        services.AddScoped<RoleSeeder>();
        services.AddScoped<PermissionSeeder>();
        services.AddScoped<AdminUserSeeder>();
        services.AddScoped<DatabaseSeeder>();
${isServices ? `        services.AddScoped<IAuthService, AuthService>();` : ''}

        return services;
    }
}
`;
  }

  return `using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using ${ns}.Application.Abstractions.Authentication;
using ${ns}.Application.Abstractions.Email;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Authorization;
${isServices ? `using ${ns}.Application.Modules.Authentication.Interfaces;\nusing ${ns}.Application.Modules.Authentication.Services;` : ''}
using ${ns}.Infrastructure.Authentication.Options;
using ${ns}.Infrastructure.Authentication.Services;
using ${ns}.Infrastructure.Email.Services;
using ${ns}.Infrastructure.Identity.Entities;
using ${ns}.Infrastructure.Identity.Services;
using ${ns}.Infrastructure.Persistence;
using ${ns}.Infrastructure.Seeders;
using ${ns}.Infrastructure.Seeders.Identity;

namespace ${ns}.Infrastructure.DependencyInjection;

public static class AuthenticationServiceExtensions
{
    public static IServiceCollection AddAuthModule(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddHttpContextAccessor();

        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));

        services
            .AddIdentityCore<ApplicationUser>(options =>
            {
                options.User.RequireUniqueEmail = true;
                options.Password.RequiredLength = 8;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = false;
            })
            .AddRoles<ApplicationRole>()
            .AddEntityFrameworkStores<ApplicationDbContext>()
            .AddDefaultTokenProviders();

        var jwtOptions = configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>()
            ?? new JwtOptions();
        var signingKey = string.IsNullOrWhiteSpace(jwtOptions.SigningKey)
            ? "development-only-signing-key-change-me-32b"
            : jwtOptions.SigningKey;

        services
            .AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            })
            .AddJwtBearer(options =>
            {
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = jwtOptions.Issuer,
                    ValidAudience = jwtOptions.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = JwtRegisteredClaimNames.Sub,
                    RoleClaimType = ClaimTypes.Role,
                };
            });

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddFixedWindowLimiter("auth", limiter =>
            {
                limiter.PermitLimit = 30;
                limiter.Window = TimeSpan.FromMinutes(1);
                limiter.QueueLimit = 0;
            });
        });

        services.AddScoped<IJwtTokenService, JwtTokenService>();
        services.AddScoped<IRefreshTokenService, RefreshTokenService>();
        services.AddScoped<IIdentityService, IdentityService>();
        services.AddScoped<IEmailSender, DevelopmentEmailSender>();
        services.AddScoped<RoleSeeder>();
        services.AddScoped<PermissionSeeder>();
        services.AddScoped<AdminUserSeeder>();
        services.AddScoped<DatabaseSeeder>();
${isServices ? `        services.AddScoped<IAuthService, AuthService>();` : ''}

        return services;
    }
}
`;
}


/** @param {{ ns: string }} ctx */
function renderAuthApplicationBuilderExtensions({ ns }) {
  return `using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using ${ns}.Infrastructure.Seeders;

namespace ${ns}.Infrastructure.DependencyInjection;

public static class AuthApplicationBuilderExtensions
{
    /// <summary>
    /// Adds authentication + authorization middleware. Call before MapControllers.
    /// </summary>
    public static IApplicationBuilder UseAuthModule(this IApplicationBuilder app)
    {
        app.UseAuthentication();
        app.UseAuthorization();
        return app;
    }

    /// <summary>
    /// Idempotently seeds roles, permission claims, and the optional admin user.
    /// </summary>
    public static async Task SeedAuthModuleAsync(
        this IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        using var scope = services.CreateScope();
        var seeder = scope.ServiceProvider.GetRequiredService<DatabaseSeeder>();
        await seeder.SeedAsync(cancellationToken);
    }
}
`;
}

/* ====================================================================== */
/* Infrastructure/Persistence renderers                                   */
/* ====================================================================== */

/** @param {{ ns: string }} ctx */
function renderRefreshTokenEntity({ ns }) {
  return `namespace ${ns}.Infrastructure.Persistence.Entities;

public sealed class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }

    /// <summary>SHA-256 hash of the raw token. The raw token is never stored.</summary>
    public string TokenHash { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; }

    public DateTime ExpiresAtUtc { get; set; }

    public DateTime? RevokedAtUtc { get; set; }

    public Guid? ReplacedByTokenId { get; set; }

    public string? CreatedByIp { get; set; }

    public string? RevokedByIp { get; set; }

    public bool IsRevoked => RevokedAtUtc is not null;

    public bool IsExpired => DateTime.UtcNow >= ExpiresAtUtc;

    public bool IsActive => !IsRevoked && !IsExpired;
}
`;
}

/** @param {{ ns: string }} ctx */
function renderRefreshTokenConfiguration({ ns }) {
  return `using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ${ns}.Infrastructure.Persistence.Entities;

namespace ${ns}.Infrastructure.Persistence.Configurations;

public sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.ToTable("RefreshTokens");
        builder.HasKey(token => token.Id);

        builder.Property(token => token.TokenHash)
            .IsRequired()
            .HasMaxLength(128);

        builder.HasIndex(token => token.TokenHash).IsUnique();
        builder.HasIndex(token => token.UserId);

        builder.Property(token => token.CreatedByIp).HasMaxLength(64);
        builder.Property(token => token.RevokedByIp).HasMaxLength(64);

        builder.Ignore(token => token.IsRevoked);
        builder.Ignore(token => token.IsExpired);
        builder.Ignore(token => token.IsActive);
    }
}
`;
}

/* ====================================================================== */
/* Application/Abstractions renderers                                      */
/* ====================================================================== */

/** @param {{ ns: string }} ctx */
function renderICurrentUser({ ns }) {
  return `namespace ${ns}.Application.Abstractions.Identity;

public interface ICurrentUser
{
    Guid? UserId { get; }

    bool IsAuthenticated { get; }

    string? Email { get; }

    IReadOnlyList<string> Roles { get; }

    IReadOnlyList<string> Permissions { get; }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderIEmailSender({ ns }) {
  return `namespace ${ns}.Application.Abstractions.Email;

public interface IEmailSender
{
    Task SendEmailAsync(
        string to,
        string subject,
        string htmlBody,
        CancellationToken cancellationToken = default);
}
`;
}

/** @param {{ ns: string, isJwt: boolean, isCookieAuth: boolean, architecture: string }} ctx */
function renderIIdentityService(ctx) {
  const { ns, isJwt, architecture } = ctx;
  const dtoNs = `${ns}.Application.${architecture === 'services' ? 'Modules' : 'Features'}.Authentication.DTOs`;

  return `${isJwt ? `using ${ns}.Application.Abstractions.Authentication;\n` : ''}using ${ns}.Application.Common.Results;
using ${dtoNs};

namespace ${ns}.Application.Abstractions.Identity;

public interface IIdentityService
{
    Task<Result<Guid>> RegisterAsync(
        string email,
        string password,
        string displayName,
        string role,
        CancellationToken cancellationToken = default);
${isJwt ? `
    Task<Result<AuthTokens>> PasswordSignInAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default);

    Task<Result<AuthTokens>> RefreshAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default);

    Task RevokeRefreshTokenAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default);
` : `
    Task<Result<UserInfoDto>> SignInCookieAsync(
        string email,
        string password,
        bool isPersistent,
        CancellationToken cancellationToken = default);

    Task SignOutCookieAsync(CancellationToken cancellationToken = default);
`}
    Task<Result<UserInfoDto>> GetUserInfoAsync(Guid userId, CancellationToken cancellationToken = default);
}
`;
}

/** @param {{ ns: string }} ctx */
function renderIAuthCookieService({ ns }) {
  return `namespace ${ns}.Application.Abstractions.Authentication;

public interface IAuthCookieService
{
    string? ReadRefreshToken();

    void WriteRefreshToken(string rawToken, DateTime expiresAtUtc);

    void DeleteRefreshToken();
}
`;
}

/** @param {{ ns: string, architecture: string }} ctx */
function renderAuthTokens({ ns, architecture }) {
  const dtoNs = `${ns}.Application.${architecture === 'services' ? 'Modules' : 'Features'}.Authentication.DTOs`;

  return `using ${dtoNs};

namespace ${ns}.Application.Abstractions.Authentication;

/// <summary>
/// Internal transport for a freshly minted access token plus its paired raw
/// refresh token. The raw refresh token is only ever written to an HttpOnly
/// cookie — it must never be serialized into an API response body.
/// </summary>
public sealed record AuthTokens
{
    public string AccessToken { get; init; } = string.Empty;

    public DateTime ExpiresAtUtc { get; init; }

    public string RefreshToken { get; init; } = string.Empty;

    public DateTime RefreshExpiresAtUtc { get; init; }

    public UserInfoDto User { get; init; } = new();
}
`;
}

/* ====================================================================== */
/* Application/Common/Authorization renderers                             */
/* ====================================================================== */

/** @param {{ ns: string, roles: string[] }} ctx */
function renderAppRoles({ ns, roles }) {
  const constants = roles
    .map((role) => `    public const string ${toRoleConst(role)} = "${role}";`)
    .join('\n\n');
  const allEntries = roles.map((role) => `        ${toRoleConst(role)},`).join('\n');

  return `namespace ${ns}.Application.Common.Authorization;

public static class AppRoles
{
${constants}

    public static readonly IReadOnlyList<string> All = new[]
    {
${allEntries}
    };
}
`;
}

/** @param {{ ns: string }} ctx */
function renderAppPermissions({ ns }) {
  return `namespace ${ns}.Application.Common.Authorization;

public static class AppPermissions
{
    /// <summary>Claim type used to carry permissions on the access token.</summary>
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

    /// <summary>Compose a permission string from a feature and an action.</summary>
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
    public const string UsersView = "Users.View";
    public const string UsersManage = "Users.Manage";
    public const string NotificationsSend = "Notifications.Send";
    public const string AuditView = "Audit.View";

    public static readonly IReadOnlyList<string> All = new[]
    {
        UsersView,
        UsersManage,
        NotificationsSend,
        AuditView,
    };
}
`;
}

/** @param {{ ns: string, presentation: string }} ctx */
function renderPermissionRequirement({ ns, presentation }) {
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const targetNs = isWeb ? `${ns}.Web.Authorization` : `${ns}.API.Authorization`;
  return `using Microsoft.AspNetCore.Authorization;

namespace ${targetNs};

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

/** @param {{ ns: string, presentation: string }} ctx */
function renderPermissionAuthorizationHandler({ ns, presentation }) {
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const targetNs = isWeb ? `${ns}.Web.Authorization` : `${ns}.API.Authorization`;
  return `using Microsoft.AspNetCore.Authorization;
using ${ns}.Application.Common.Authorization;

namespace ${targetNs};

public sealed class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PermissionRequirement requirement)
    {
        var hasPermission = context.User.Claims.Any(claim =>
            claim.Type == AppPermissions.ClaimType &&
            string.Equals(claim.Value, requirement.Permission, StringComparison.Ordinal));

        if (hasPermission)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
`;
}

/** @param {{ ns: string, presentation: string }} ctx */
function renderPermissionPolicyProvider({ ns, presentation }) {
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const targetNs = isWeb ? `${ns}.Web.Authorization` : `${ns}.API.Authorization`;
  return `using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace ${targetNs};

/// <summary>
/// Dynamically materializes an authorization policy for any policy name that
/// starts with the permission prefix, so features can require permissions
/// without pre-registering a policy for each one.
/// </summary>
public sealed class PermissionPolicyProvider : IAuthorizationPolicyProvider
{
    public const string PolicyPrefix = "perm:";

    private readonly DefaultAuthorizationPolicyProvider _fallbackPolicyProvider;

    public PermissionPolicyProvider(IOptions<AuthorizationOptions> options)
    {
        _fallbackPolicyProvider = new DefaultAuthorizationPolicyProvider(options);
    }

    public Task<AuthorizationPolicy> GetDefaultPolicyAsync() =>
        _fallbackPolicyProvider.GetDefaultPolicyAsync();

    public Task<AuthorizationPolicy?> GetFallbackPolicyAsync() =>
        _fallbackPolicyProvider.GetFallbackPolicyAsync();

    public Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        if (policyName.StartsWith(PolicyPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var permission = policyName[PolicyPrefix.Length..];
            var policy = new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .AddRequirements(new PermissionRequirement(permission))
                .Build();
            return Task.FromResult<AuthorizationPolicy?>(policy);
        }

        return _fallbackPolicyProvider.GetPolicyAsync(policyName);
    }
}
`;
}

/** @param {{ ns: string, presentation: string }} ctx */
function renderHasPermissionAttribute({ ns, presentation }) {
  const isWeb = presentation === 'mvc' || presentation === 'razor-pages';
  const targetNs = isWeb ? `${ns}.Web.Attributes` : `${ns}.API.Attributes`;
  const authzNs = isWeb ? `${ns}.Web.Authorization` : `${ns}.API.Authorization`;
  return `using Microsoft.AspNetCore.Authorization;
using ${authzNs};

namespace ${targetNs};

/// <summary>
/// Requires the caller to hold the given permission, e.g.
/// [HasPermission(AppPermissions.Users.Manage)].
/// </summary>
public sealed class HasPermissionAttribute : AuthorizeAttribute
{
    public HasPermissionAttribute(string permission)
        : base(PermissionPolicyProvider.PolicyPrefix + permission)
    {
    }
}
`;
}

/* ====================================================================== */
/* Application/Features/Auth renderers                                     */
/* ====================================================================== */

/** @param {{ ns: string, architecture: string }} ctx */
function renderUserInfoDto({ ns, architecture }) {
  const layer = architecture === 'services' ? 'Modules' : 'Features';
  return `namespace ${ns}.Application.${layer}.Authentication.DTOs;

public sealed record UserInfoDto
{
    public Guid Id { get; init; }

    public string Email { get; init; } = string.Empty;

    public string DisplayName { get; init; } = string.Empty;

    public IReadOnlyList<string> Roles { get; init; } = Array.Empty<string>();

    public IReadOnlyList<string> Permissions { get; init; } = Array.Empty<string>();
}
`;
}

/** @param {{ ns: string, architecture: string }} ctx */
function renderAuthResponseDto({ ns, architecture }) {
  const layer = architecture === 'services' ? 'Modules' : 'Features';
  return `namespace ${ns}.Application.${layer}.Authentication.DTOs;

/// <summary>
/// The JSON response for login/refresh. It intentionally does NOT include the
/// refresh token — that value only lives in an HttpOnly cookie.
/// </summary>
public sealed record AuthResponseDto
{
    public string AccessToken { get; init; } = string.Empty;

    public DateTime ExpiresAtUtc { get; init; }

    public UserInfoDto User { get; init; } = new();
}
`;
}

/** @param {{ ns: string }} ctx */
function renderRegisterCommand({ ns }) {
  return `using MediatR;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Authentication.Commands.Register;

public sealed record RegisterCommand : IRequest<Result>
{
    public string Email { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;

    public string DisplayName { get; init; } = string.Empty;
}
`;
}

/** @param {{ ns: string, defaultRole: string }} ctx */
function renderRegisterHandler(ctx) {
  const { ns } = ctx;
  const defaultConst = toRoleConst(ctx.defaultRole);
  return `using MediatR;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Authorization;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Authentication.Commands.Register;

public sealed class RegisterCommandHandler : IRequestHandler<RegisterCommand, Result>
{
    private readonly IIdentityService _identityService;

    public RegisterCommandHandler(IIdentityService identityService)
    {
        _identityService = identityService;
    }

    public async Task<Result> Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        // Registration never auto-logs the user in; it only creates the account.
        var result = await _identityService.RegisterAsync(
            request.Email,
            request.Password,
            request.DisplayName,
            AppRoles.${defaultConst},
            cancellationToken);

        return result.IsSuccess ? Result.Success() : Result.Failure(result.Error);
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderRegisterValidator({ ns }) {
  return `using FluentValidation;

namespace ${ns}.Application.Features.Authentication.Commands.Register;

public sealed class RegisterCommandValidator : AbstractValidator<RegisterCommand>
{
    public RegisterCommandValidator()
    {
        RuleFor(command => command.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(256);

        RuleFor(command => command.Password)
            .NotEmpty()
            .MinimumLength(8)
            .MaximumLength(128);

        RuleFor(command => command.DisplayName)
            .MaximumLength(128);
    }
}
`;
}

/** @param {{ ns: string, isJwt: boolean }} ctx */
function renderLoginCommand({ ns, isJwt }) {
  if (!isJwt) {
    return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Authentication.DTOs;

namespace ${ns}.Application.Features.Authentication.Commands.Login;

public sealed record LoginCommand : IRequest<Result<UserInfoDto>>
{
    public string Email { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;

    public bool RememberMe { get; init; }
}
`;
  }

  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Authentication.DTOs;

namespace ${ns}.Application.Features.Authentication.Commands.Login;

public sealed record LoginCommand : IRequest<Result<AuthResponseDto>>
{
    public string Email { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;
}
`;
}

/** @param {{ ns: string, isJwt: boolean }} ctx */
function renderLoginHandler({ ns, isJwt }) {
  if (!isJwt) {
    return `using MediatR;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Authentication.DTOs;

namespace ${ns}.Application.Features.Authentication.Commands.Login;

public sealed class LoginCommandHandler : IRequestHandler<LoginCommand, Result<UserInfoDto>>
{
    private readonly IIdentityService _identityService;

    public LoginCommandHandler(IIdentityService identityService)
    {
        _identityService = identityService;
    }

    public async Task<Result<UserInfoDto>> Handle(
        LoginCommand request,
        CancellationToken cancellationToken)
    {
        return await _identityService.SignInCookieAsync(
            request.Email,
            request.Password,
            request.RememberMe,
            cancellationToken);
    }
}
`;
  }

  return `using MediatR;
using ${ns}.Application.Abstractions.Authentication;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Authentication.DTOs;

namespace ${ns}.Application.Features.Authentication.Commands.Login;

public sealed class LoginCommandHandler : IRequestHandler<LoginCommand, Result<AuthResponseDto>>
{
    private readonly IIdentityService _identityService;
    private readonly IAuthCookieService _cookieService;

    public LoginCommandHandler(IIdentityService identityService, IAuthCookieService cookieService)
    {
        _identityService = identityService;
        _cookieService = cookieService;
    }

    public async Task<Result<AuthResponseDto>> Handle(
        LoginCommand request,
        CancellationToken cancellationToken)
    {
        var result = await _identityService.PasswordSignInAsync(
            request.Email,
            request.Password,
            cancellationToken);

        if (result.IsFailure)
        {
            return Result.Failure<AuthResponseDto>(result.Error);
        }

        var tokens = result.Value;

        // The refresh token only leaves the server as an HttpOnly cookie.
        _cookieService.WriteRefreshToken(tokens.RefreshToken, tokens.RefreshExpiresAtUtc);

        return Result.Success(new AuthResponseDto
        {
            AccessToken = tokens.AccessToken,
            ExpiresAtUtc = tokens.ExpiresAtUtc,
            User = tokens.User,
        });
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderLoginValidator({ ns }) {
  return `using FluentValidation;

namespace ${ns}.Application.Features.Authentication.Commands.Login;

public sealed class LoginCommandValidator : AbstractValidator<LoginCommand>
{
    public LoginCommandValidator()
    {
        RuleFor(command => command.Email)
            .NotEmpty()
            .EmailAddress();

        RuleFor(command => command.Password)
            .NotEmpty();
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderRefreshCommand({ ns }) {
  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Authentication.DTOs;

namespace ${ns}.Application.Features.Authentication.Commands.RefreshToken;

public sealed record RefreshTokenCommand : IRequest<Result<AuthResponseDto>>;
`;
}

/** @param {{ ns: string }} ctx */
function renderRefreshHandler({ ns }) {
  return `using MediatR;
using ${ns}.Application.Abstractions.Authentication;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Authentication.DTOs;

namespace ${ns}.Application.Features.Authentication.Commands.RefreshToken;

public sealed class RefreshTokenCommandHandler : IRequestHandler<RefreshTokenCommand, Result<AuthResponseDto>>
{
    private readonly IIdentityService _identityService;
    private readonly IAuthCookieService _cookieService;

    public RefreshTokenCommandHandler(IIdentityService identityService, IAuthCookieService cookieService)
    {
        _identityService = identityService;
        _cookieService = cookieService;
    }

    public async Task<Result<AuthResponseDto>> Handle(
        RefreshTokenCommand request,
        CancellationToken cancellationToken)
    {
        var rawToken = _cookieService.ReadRefreshToken();
        if (string.IsNullOrWhiteSpace(rawToken))
        {
            return Result.Failure<AuthResponseDto>(
                Error.Unauthorized("Auth.MissingRefreshToken", "No refresh token was provided."));
        }

        var result = await _identityService.RefreshAsync(rawToken, cancellationToken);
        if (result.IsFailure)
        {
            _cookieService.DeleteRefreshToken();
            return Result.Failure<AuthResponseDto>(result.Error);
        }

        var tokens = result.Value;
        _cookieService.WriteRefreshToken(tokens.RefreshToken, tokens.RefreshExpiresAtUtc);

        return Result.Success(new AuthResponseDto
        {
            AccessToken = tokens.AccessToken,
            ExpiresAtUtc = tokens.ExpiresAtUtc,
            User = tokens.User,
        });
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderLogoutCommand({ ns }) {
  return `using MediatR;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Authentication.Commands.Logout;

public sealed record LogoutCommand : IRequest<Result>;
`;
}

/** @param {{ ns: string, isJwt: boolean }} ctx */
function renderLogoutHandler({ ns, isJwt }) {
  if (!isJwt) {
    return `using MediatR;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Authentication.Commands.Logout;

public sealed class LogoutCommandHandler : IRequestHandler<LogoutCommand, Result>
{
    private readonly IIdentityService _identityService;

    public LogoutCommandHandler(IIdentityService identityService)
    {
        _identityService = identityService;
    }

    public async Task<Result> Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        await _identityService.SignOutCookieAsync(cancellationToken);
        return Result.Success();
    }
}
`;
  }

  return `using MediatR;
using ${ns}.Application.Abstractions.Authentication;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;

namespace ${ns}.Application.Features.Authentication.Commands.Logout;

public sealed class LogoutCommandHandler : IRequestHandler<LogoutCommand, Result>
{
    private readonly IIdentityService _identityService;
    private readonly IAuthCookieService _cookieService;

    public LogoutCommandHandler(IIdentityService identityService, IAuthCookieService cookieService)
    {
        _identityService = identityService;
        _cookieService = cookieService;
    }

    public async Task<Result> Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        var rawToken = _cookieService.ReadRefreshToken();
        if (!string.IsNullOrWhiteSpace(rawToken))
        {
            await _identityService.RevokeRefreshTokenAsync(rawToken, cancellationToken);
        }

        _cookieService.DeleteRefreshToken();
        return Result.Success();
    }
}
`;
}

/** @param {{ ns: string, architecture: string }} ctx */
function renderGetMeQuery({ ns, architecture }) {
  const layer = architecture === 'services' ? 'Modules' : 'Features';
  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.${layer}.Authentication.DTOs;

namespace ${ns}.Application.Features.Authentication.Queries.GetMe;

public sealed record GetMeQuery : IRequest<Result<UserInfoDto>>;
`;
}

/** @param {{ ns: string, architecture: string }} ctx */
function renderGetMeHandler({ ns, architecture }) {
  const layer = architecture === 'services' ? 'Modules' : 'Features';
  return `using MediatR;
using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Results;
using ${ns}.Application.${layer}.Authentication.DTOs;

namespace ${ns}.Application.Features.Authentication.Queries.GetMe;

public sealed class GetMeQueryHandler : IRequestHandler<GetMeQuery, Result<UserInfoDto>>
{
    private readonly ICurrentUser _currentUser;
    private readonly IIdentityService _identityService;

    public GetMeQueryHandler(ICurrentUser currentUser, IIdentityService identityService)
    {
        _currentUser = currentUser;
        _identityService = identityService;
    }

    public async Task<Result<UserInfoDto>> Handle(GetMeQuery request, CancellationToken cancellationToken)
    {
        if (!_currentUser.IsAuthenticated || _currentUser.UserId is null)
        {
            return Result.Failure<UserInfoDto>(
                Error.Unauthorized("Auth.NotAuthenticated", "You are not authenticated."));
        }

        return await _identityService.GetUserInfoAsync(_currentUser.UserId.Value, cancellationToken);
    }
}
`;
}

/* ====================================================================== */
/* Application Services DTOs & Services                                   */
/* ====================================================================== */

/** @param {{ ns: string }} ctx */
function renderRegisterRequestDto({ ns }) {
  return `namespace ${ns}.Application.Modules.Authentication.DTOs;

public sealed record RegisterRequestDto
{
    public string Email { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;

    public string DisplayName { get; init; } = string.Empty;
}
`;
}

/** @param {{ ns: string }} ctx */
function renderLoginRequestDto({ ns }) {
  return `namespace ${ns}.Application.Modules.Authentication.DTOs;

public sealed record LoginRequestDto
{
    public string Email { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;

    public bool RememberMe { get; init; }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderRegisterRequestValidator({ ns }) {
  return `using FluentValidation;
using ${ns}.Application.Modules.Authentication.DTOs;

namespace ${ns}.Application.Modules.Authentication.Validators;

public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequestDto>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(256);

        RuleFor(x => x.Password)
            .NotEmpty()
            .MinimumLength(8)
            .MaximumLength(128);

        RuleFor(x => x.DisplayName)
            .MaximumLength(128);
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderLoginRequestValidator({ ns }) {
  return `using FluentValidation;
using ${ns}.Application.Modules.Authentication.DTOs;

namespace ${ns}.Application.Modules.Authentication.Validators;

public sealed class LoginRequestValidator : AbstractValidator<LoginRequestDto>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress();

        RuleFor(x => x.Password)
            .NotEmpty();
    }
}
`;
}

/** @param {{ ns: string, isJwt: boolean }} ctx */
function renderIAuthService({ ns, isJwt }) {
  return `using ${ns}.Application.Common.Results;
using ${ns}.Application.Modules.Authentication.DTOs;

namespace ${ns}.Application.Modules.Authentication.Interfaces;

public interface IAuthService
{
    Task<Result<Guid>> RegisterAsync(RegisterRequestDto request, CancellationToken cancellationToken = default);
${isJwt ? `
    Task<Result<AuthResponseDto>> LoginAsync(LoginRequestDto request, CancellationToken cancellationToken = default);

    Task<Result<AuthResponseDto>> RefreshAsync(CancellationToken cancellationToken = default);
` : `
    Task<Result<UserInfoDto>> LoginAsync(LoginRequestDto request, CancellationToken cancellationToken = default);
`}
    Task<Result> LogoutAsync(CancellationToken cancellationToken = default);

    Task<Result<UserInfoDto>> GetMeAsync(CancellationToken cancellationToken = default);
}
`;
}

/** @param {{ ns: string, isJwt: boolean, defaultRole: string }} ctx */
function renderAuthService(ctx) {
  const { ns, isJwt, defaultRole } = ctx;
  const defaultConst = toRoleConst(defaultRole);

  return `${isJwt ? `using ${ns}.Application.Abstractions.Authentication;\n` : ''}using ${ns}.Application.Abstractions.Identity;
using ${ns}.Application.Common.Authorization;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Modules.Authentication.DTOs;
using ${ns}.Application.Modules.Authentication.Interfaces;

namespace ${ns}.Application.Modules.Authentication.Services;

public sealed class AuthService : IAuthService
{
    private readonly IIdentityService _identityService;
    private readonly ICurrentUser _currentUser;
${isJwt ? `    private readonly IAuthCookieService _cookieService;` : ''}

    public AuthService(
        IIdentityService identityService,
        ICurrentUser currentUser${isJwt ? ',\n        IAuthCookieService cookieService' : ''})
    {
        _identityService = identityService;
        _currentUser = currentUser;
${isJwt ? `        _cookieService = cookieService;` : ''}
    }

    public async Task<Result<Guid>> RegisterAsync(RegisterRequestDto request, CancellationToken cancellationToken = default)
    {
        return await _identityService.RegisterAsync(
            request.Email,
            request.Password,
            request.DisplayName,
            AppRoles.${defaultConst},
            cancellationToken);
    }
${isJwt ? `
    public async Task<Result<AuthResponseDto>> LoginAsync(LoginRequestDto request, CancellationToken cancellationToken = default)
    {
        var result = await _identityService.PasswordSignInAsync(request.Email, request.Password, cancellationToken);
        if (result.IsFailure)
        {
            return Result.Failure<AuthResponseDto>(result.Error);
        }

        var tokens = result.Value;
        _cookieService.WriteRefreshToken(tokens.RefreshToken, tokens.RefreshExpiresAtUtc);

        return Result.Success(new AuthResponseDto
        {
            AccessToken = tokens.AccessToken,
            ExpiresAtUtc = tokens.ExpiresAtUtc,
            User = tokens.User,
        });
    }

    public async Task<Result<AuthResponseDto>> RefreshAsync(CancellationToken cancellationToken = default)
    {
        var rawToken = _cookieService.ReadRefreshToken();
        if (string.IsNullOrWhiteSpace(rawToken))
        {
            return Result.Failure<AuthResponseDto>(
                Error.Unauthorized("Auth.MissingRefreshToken", "No refresh token was provided."));
        }

        var result = await _identityService.RefreshAsync(rawToken, cancellationToken);
        if (result.IsFailure)
        {
            _cookieService.DeleteRefreshToken();
            return Result.Failure<AuthResponseDto>(result.Error);
        }

        var tokens = result.Value;
        _cookieService.WriteRefreshToken(tokens.RefreshToken, tokens.RefreshExpiresAtUtc);

        return Result.Success(new AuthResponseDto
        {
            AccessToken = tokens.AccessToken,
            ExpiresAtUtc = tokens.ExpiresAtUtc,
            User = tokens.User,
        });
    }

    public async Task<Result> LogoutAsync(CancellationToken cancellationToken = default)
    {
        var rawToken = _cookieService.ReadRefreshToken();
        if (!string.IsNullOrWhiteSpace(rawToken))
        {
            await _identityService.RevokeRefreshTokenAsync(rawToken, cancellationToken);
        }

        _cookieService.DeleteRefreshToken();
        return Result.Success();
    }
` : `
    public async Task<Result<UserInfoDto>> LoginAsync(LoginRequestDto request, CancellationToken cancellationToken = default)
    {
        return await _identityService.SignInCookieAsync(request.Email, request.Password, request.RememberMe, cancellationToken);
    }

    public async Task<Result> LogoutAsync(CancellationToken cancellationToken = default)
    {
        await _identityService.SignOutCookieAsync(cancellationToken);
        return Result.Success();
    }
`}
    public async Task<Result<UserInfoDto>> GetMeAsync(CancellationToken cancellationToken = default)
    {
        if (!_currentUser.IsAuthenticated || _currentUser.UserId is null)
        {
            return Result.Failure<UserInfoDto>(
                Error.Unauthorized("Auth.NotAuthenticated", "You are not authenticated."));
        }

        return await _identityService.GetUserInfoAsync(_currentUser.UserId.Value, cancellationToken);
    }
}
`;
}

/* ====================================================================== */
/* API / Controllers / Endpoints / Views renderers                        */
/* ====================================================================== */

/** @param {{ ns: string, isJwt: boolean, architecture: string }} ctx */
function renderAuthController({ ns, isJwt, architecture }) {
  const isServices = architecture === 'services';

  if (isServices) {
    return `using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using ${ns}.API.Contracts;
using ${ns}.Application.Modules.Authentication.DTOs;
using ${ns}.Application.Modules.Authentication.Interfaces;

namespace ${ns}.API.Controllers;

[ApiController]
public sealed class AuthController : ApiControllerBase
{
    private readonly IAuthService _authService;

    public AuthController(IAuthService authService)
    {
        _authService = authService;
    }

    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    [HttpPost(Router.Authentication.Register)]
    public async Task<IActionResult> Register(
        [FromBody] RegisterRequestDto dto,
        CancellationToken cancellationToken)
    {
        var result = await _authService.RegisterAsync(dto, cancellationToken);
        return ToActionResult(result);
    }

    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    [HttpPost(Router.Authentication.Login)]
    public async Task<IActionResult> Login(
        [FromBody] LoginRequestDto dto,
        CancellationToken cancellationToken)
    {
        var result = await _authService.LoginAsync(dto, cancellationToken);
        return ToActionResult(result);
    }
${isJwt ? `
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    [HttpPost(Router.Authentication.Refresh)]
    public async Task<IActionResult> Refresh(CancellationToken cancellationToken)
    {
        var result = await _authService.RefreshAsync(cancellationToken);
        return ToActionResult(result);
    }
` : ''}
    [Authorize]
    [HttpPost(Router.Authentication.Logout)]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        var result = await _authService.LogoutAsync(cancellationToken);
        return ToActionResult(result);
    }

    [Authorize]
    [HttpGet(Router.Authentication.Me)]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var result = await _authService.GetMeAsync(cancellationToken);
        return ToActionResult(result);
    }
}
`;
  }

  return `using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using ${ns}.API.Contracts;
using ${ns}.Application.Features.Authentication.Commands.Login;
using ${ns}.Application.Features.Authentication.Commands.Logout;
using ${ns}.Application.Features.Authentication.Queries.GetMe;
${isJwt ? `using ${ns}.Application.Features.Authentication.Commands.RefreshToken;\n` : ''}using ${ns}.Application.Features.Authentication.Commands.Register;

namespace ${ns}.API.Controllers;

[ApiController]
public sealed class AuthController : ApiControllerBase
{
    private readonly ISender _sender;

    public AuthController(ISender sender)
    {
        _sender = sender;
    }

    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    [HttpPost(Router.Authentication.Register)]
    public async Task<IActionResult> Register(
        [FromBody] RegisterCommand command,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(command, cancellationToken);
        return ToActionResult(result);
    }

    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    [HttpPost(Router.Authentication.Login)]
    public async Task<IActionResult> Login(
        [FromBody] LoginCommand command,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(command, cancellationToken);
        return ToActionResult(result);
    }
${isJwt ? `
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    [HttpPost(Router.Authentication.Refresh)]
    public async Task<IActionResult> Refresh(CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new RefreshTokenCommand(), cancellationToken);
        return ToActionResult(result);
    }
` : ''}
    [Authorize]
    [HttpPost(Router.Authentication.Logout)]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new LogoutCommand(), cancellationToken);
        return ToActionResult(result);
    }

    [Authorize]
    [HttpGet(Router.Authentication.Me)]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetMeQuery(), cancellationToken);
        return ToActionResult(result);
    }
}
`;
}

/** @param {{ ns: string, isJwt: boolean, architecture: string }} ctx */
function renderMinimalApiAuthEndpoints({ ns, isJwt, architecture }) {
  const isServices = architecture === 'services';

  if (isServices) {
    return `using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using ${ns}.API.Contracts;
using ${ns}.Application.Modules.Authentication.DTOs;
using ${ns}.Application.Modules.Authentication.Interfaces;

namespace ${ns}.API.Endpoints.Authentication;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthenticationEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost(Router.Authentication.Register, async (RegisterRequestDto dto, IAuthService authService, CancellationToken ct) =>
        {
            var result = await authService.RegisterAsync(dto, ct);
            return result.IsSuccess ? Results.Ok() : Results.BadRequest(result.Error);
        })
        .AllowAnonymous()
        .RequireRateLimiting("auth")
        .WithName("Register");

        app.MapPost(Router.Authentication.Login, async (LoginRequestDto dto, IAuthService authService, CancellationToken ct) =>
        {
            var result = await authService.LoginAsync(dto, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.BadRequest(result.Error);
        })
        .AllowAnonymous()
        .RequireRateLimiting("auth")
        .WithName("Login");
${isJwt ? `
        app.MapPost(Router.Authentication.Refresh, async (IAuthService authService, CancellationToken ct) =>
        {
            var result = await authService.RefreshAsync(ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Unauthorized();
        })
        .AllowAnonymous()
        .RequireRateLimiting("auth")
        .WithName("Refresh");
` : ''}
        app.MapPost(Router.Authentication.Logout, async (IAuthService authService, CancellationToken ct) =>
        {
            var result = await authService.LogoutAsync(ct);
            return result.IsSuccess ? Results.Ok() : Results.BadRequest(result.Error);
        })
        .RequireAuthorization()
        .WithName("Logout");

        app.MapGet(Router.Authentication.Me, async (IAuthService authService, CancellationToken ct) =>
        {
            var result = await authService.GetMeAsync(ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Unauthorized();
        })
        .RequireAuthorization()
        .WithName("GetMe");

        return app;
    }
}
`;
  }

  return `using MediatR;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using ${ns}.API.Contracts;
using ${ns}.Application.Features.Authentication.Commands.Login;
using ${ns}.Application.Features.Authentication.Commands.Logout;
using ${ns}.Application.Features.Authentication.Queries.GetMe;
${isJwt ? `using ${ns}.Application.Features.Authentication.Commands.RefreshToken;\n` : ''}using ${ns}.Application.Features.Authentication.Commands.Register;

namespace ${ns}.API.Endpoints.Authentication;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthenticationEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost(Router.Authentication.Register, async (RegisterCommand command, ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(command, ct);
            return result.IsSuccess ? Results.Ok() : Results.BadRequest(result.Error);
        })
        .AllowAnonymous()
        .RequireRateLimiting("auth")
        .WithName("Register");

        app.MapPost(Router.Authentication.Login, async (LoginCommand command, ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.BadRequest(result.Error);
        })
        .AllowAnonymous()
        .RequireRateLimiting("auth")
        .WithName("Login");
${isJwt ? `
        app.MapPost(Router.Authentication.Refresh, async (ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(new RefreshTokenCommand(), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Unauthorized();
        })
        .AllowAnonymous()
        .RequireRateLimiting("auth")
        .WithName("Refresh");
` : ''}
        app.MapPost(Router.Authentication.Logout, async (ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(new LogoutCommand(), ct);
            return result.IsSuccess ? Results.Ok() : Results.BadRequest(result.Error);
        })
        .RequireAuthorization()
        .WithName("Logout");

        app.MapGet(Router.Authentication.Me, async (ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(new GetMeQuery(), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Unauthorized();
        })
        .RequireAuthorization()
        .WithName("GetMe");

        return app;
    }
}
`;
}

/** @param {{ ns: string, architecture: string }} ctx */
function renderMvcAccountController({ ns, architecture }) {
  const isServices = architecture === 'services';

  if (isServices) {
    return `using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ${ns}.Application.Modules.Authentication.DTOs;
using ${ns}.Application.Modules.Authentication.Interfaces;
using ${ns}.Web.ViewModels.Account;

namespace ${ns}.Web.Controllers;

public sealed class AccountController : Controller
{
    private readonly IAuthService _authService;

    public AccountController(IAuthService authService)
    {
        _authService = authService;
    }

    [HttpGet]
    [AllowAnonymous]
    public IActionResult Login(string? returnUrl = null)
    {
        return View(new LoginViewModel { ReturnUrl = returnUrl });
    }

    [HttpPost]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Login(LoginViewModel model, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var result = await _authService.LoginAsync(
            new LoginRequestDto { Email = model.Email, Password = model.Password, RememberMe = model.RememberMe },
            cancellationToken);

        if (result.IsFailure)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message ?? "Invalid login attempt.");
            return View(model);
        }

        if (!string.IsNullOrEmpty(model.ReturnUrl) && Url.IsLocalUrl(model.ReturnUrl))
        {
            return Redirect(model.ReturnUrl);
        }

        return RedirectToAction("Index", "Home");
    }

    [HttpGet]
    [AllowAnonymous]
    public IActionResult Register()
    {
        return View(new RegisterViewModel());
    }

    [HttpPost]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Register(RegisterViewModel model, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var result = await _authService.RegisterAsync(
            new RegisterRequestDto { Email = model.Email, Password = model.Password, DisplayName = model.DisplayName },
            cancellationToken);

        if (result.IsFailure)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message ?? "Registration failed.");
            return View(model);
        }

        return RedirectToAction(nameof(Login));
    }

    [HttpPost]
    [Authorize]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        await _authService.LogoutAsync(cancellationToken);
        return RedirectToAction("Index", "Home");
    }
}
`;
  }

  return `using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ${ns}.Application.Features.Authentication.Commands.Login;
using ${ns}.Application.Features.Authentication.Commands.Logout;
using ${ns}.Application.Features.Authentication.Commands.Register;
using ${ns}.Web.ViewModels.Account;

namespace ${ns}.Web.Controllers;

public sealed class AccountController : Controller
{
    private readonly ISender _sender;

    public AccountController(ISender sender)
    {
        _sender = sender;
    }

    [HttpGet]
    [AllowAnonymous]
    public IActionResult Login(string? returnUrl = null)
    {
        return View(new LoginViewModel { ReturnUrl = returnUrl });
    }

    [HttpPost]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Login(LoginViewModel model, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var result = await _sender.Send(
            new LoginCommand { Email = model.Email, Password = model.Password, RememberMe = model.RememberMe },
            cancellationToken);

        if (result.IsFailure)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message ?? "Invalid login attempt.");
            return View(model);
        }

        if (!string.IsNullOrEmpty(model.ReturnUrl) && Url.IsLocalUrl(model.ReturnUrl))
        {
            return Redirect(model.ReturnUrl);
        }

        return RedirectToAction("Index", "Home");
    }

    [HttpGet]
    [AllowAnonymous]
    public IActionResult Register()
    {
        return View(new RegisterViewModel());
    }

    [HttpPost]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Register(RegisterViewModel model, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var result = await _sender.Send(
            new RegisterCommand { Email = model.Email, Password = model.Password, DisplayName = model.DisplayName },
            cancellationToken);

        if (result.IsFailure)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message ?? "Registration failed.");
            return View(model);
        }

        return RedirectToAction(nameof(Login));
    }

    [HttpPost]
    [Authorize]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        await _sender.Send(new LogoutCommand(), cancellationToken);
        return RedirectToAction("Index", "Home");
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderLoginViewModel({ ns }) {
  return `using System.ComponentModel.DataAnnotations;

namespace ${ns}.Web.ViewModels.Account;

public sealed class LoginViewModel
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [DataType(DataType.Password)]
    public string Password { get; set; } = string.Empty;

    public bool RememberMe { get; set; }

    public string? ReturnUrl { get; set; }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderRegisterViewModel({ ns }) {
  return `using System.ComponentModel.DataAnnotations;

namespace ${ns}.Web.ViewModels.Account;

public sealed class RegisterViewModel
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [StringLength(100, MinimumLength = 8)]
    [DataType(DataType.Password)]
    public string Password { get; set; } = string.Empty;

    [DataType(DataType.Password)]
    [Compare("Password", ErrorMessage = "The password and confirmation password do not match.")]
    public string ConfirmPassword { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;
}
`;
}

/** @param {{ ns: string }} ctx */
function renderLoginView({ ns }) {
  return `@model ${ns}.Web.ViewModels.Account.LoginViewModel
@{
    ViewData["Title"] = "Log In";
}

<div class="row justify-content-center">
    <div class="col-md-5">
        <h2 class="mb-4">Log In</h2>
        <form asp-action="Login" method="post">
            <input type="hidden" asp-for="ReturnUrl" />
            <div asp-validation-summary="All" class="text-danger mb-3"></div>
            <div class="mb-3">
                <label asp-for="Email" class="form-label"></label>
                <input asp-for="Email" class="form-control" />
                <span asp-validation-for="Email" class="text-danger"></span>
            </div>
            <div class="mb-3">
                <label asp-for="Password" class="form-label"></label>
                <input asp-for="Password" class="form-control" />
                <span asp-validation-for="Password" class="text-danger"></span>
            </div>
            <div class="mb-3 form-check">
                <input asp-for="RememberMe" class="form-check-input" />
                <label asp-for="RememberMe" class="form-check-label"></label>
            </div>
            <button type="submit" class="btn btn-primary w-100">Log In</button>
        </form>
    </div>
</div>
`;
}

/** @param {{ ns: string }} ctx */
function renderRegisterView({ ns }) {
  return `@model ${ns}.Web.ViewModels.Account.RegisterViewModel
@{
    ViewData["Title"] = "Register";
}

<div class="row justify-content-center">
    <div class="col-md-5">
        <h2 class="mb-4">Create Account</h2>
        <form asp-action="Register" method="post">
            <div asp-validation-summary="All" class="text-danger mb-3"></div>
            <div class="mb-3">
                <label asp-for="DisplayName" class="form-label"></label>
                <input asp-for="DisplayName" class="form-control" />
                <span asp-validation-for="DisplayName" class="text-danger"></span>
            </div>
            <div class="mb-3">
                <label asp-for="Email" class="form-label"></label>
                <input asp-for="Email" class="form-control" />
                <span asp-validation-for="Email" class="text-danger"></span>
            </div>
            <div class="mb-3">
                <label asp-for="Password" class="form-label"></label>
                <input asp-for="Password" class="form-control" />
                <span asp-validation-for="Password" class="text-danger"></span>
            </div>
            <div class="mb-3">
                <label asp-for="ConfirmPassword" class="form-label"></label>
                <input asp-for="ConfirmPassword" class="form-control" />
                <span asp-validation-for="ConfirmPassword" class="text-danger"></span>
            </div>
            <button type="submit" class="btn btn-primary w-100">Register</button>
        </form>
    </div>
</div>
`;
}

/** @param {{ ns: string }} ctx */
function renderRazorLoginPage({ ns }) {
  return `@page
@model ${ns}.Web.Pages.Account.LoginModel
@{
    ViewData["Title"] = "Log In";
}

<div class="row justify-content-center">
    <div class="col-md-5">
        <h2 class="mb-4">Log In</h2>
        <form method="post">
            <div asp-validation-summary="All" class="text-danger mb-3"></div>
            <div class="mb-3">
                <label asp-for="Input.Email" class="form-label"></label>
                <input asp-for="Input.Email" class="form-control" />
                <span asp-validation-for="Input.Email" class="text-danger"></span>
            </div>
            <div class="mb-3">
                <label asp-for="Input.Password" class="form-label"></label>
                <input asp-for="Input.Password" class="form-control" />
                <span asp-validation-for="Input.Password" class="text-danger"></span>
            </div>
            <div class="mb-3 form-check">
                <input asp-for="Input.RememberMe" class="form-check-input" />
                <label asp-for="Input.RememberMe" class="form-check-label"></label>
            </div>
            <button type="submit" class="btn btn-primary w-100">Log In</button>
        </form>
    </div>
</div>
`;
}

/** @param {{ ns: string, architecture: string }} ctx */
function renderRazorLoginPageModel({ ns, architecture }) {
  const isServices = architecture === 'services';

  if (isServices) {
    return `using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ${ns}.Application.Modules.Authentication.DTOs;
using ${ns}.Application.Modules.Authentication.Interfaces;

namespace ${ns}.Web.Pages.Account;

public sealed class LoginModel : PageModel
{
    private readonly IAuthService _authService;

    public LoginModel(IAuthService authService)
    {
        _authService = authService;
    }

    [BindProperty]
    public InputModel Input { get; set; } = new();

    public string? ReturnUrl { get; set; }

    public class InputModel
    {
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;

        [Required]
        [DataType(DataType.Password)]
        public string Password { get; set; } = string.Empty;

        public bool RememberMe { get; set; }
    }

    public void OnGet(string? returnUrl = null)
    {
        ReturnUrl = returnUrl;
    }

    public async Task<IActionResult> OnPostAsync(string? returnUrl = null, CancellationToken cancellationToken = default)
    {
        ReturnUrl = returnUrl;
        if (!ModelState.IsValid)
        {
            return Page();
        }

        var result = await _authService.LoginAsync(
            new LoginRequestDto { Email = Input.Email, Password = Input.Password, RememberMe = Input.RememberMe },
            cancellationToken);

        if (result.IsFailure)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message ?? "Invalid login attempt.");
            return Page();
        }

        if (!string.IsNullOrEmpty(returnUrl) && Url.IsLocalUrl(returnUrl))
        {
            return Redirect(returnUrl);
        }

        return RedirectToPage("/Index");
    }
}
`;
  }

  return `using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ${ns}.Application.Features.Authentication.Commands.Login;

namespace ${ns}.Web.Pages.Account;

public sealed class LoginModel : PageModel
{
    private readonly ISender _sender;

    public LoginModel(ISender sender)
    {
        _sender = sender;
    }

    [BindProperty]
    public InputModel Input { get; set; } = new();

    public string? ReturnUrl { get; set; }

    public class InputModel
    {
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;

        [Required]
        [DataType(DataType.Password)]
        public string Password { get; set; } = string.Empty;

        public bool RememberMe { get; set; }
    }

    public void OnGet(string? returnUrl = null)
    {
        ReturnUrl = returnUrl;
    }

    public async Task<IActionResult> OnPostAsync(string? returnUrl = null, CancellationToken cancellationToken = default)
    {
        ReturnUrl = returnUrl;
        if (!ModelState.IsValid)
        {
            return Page();
        }

        var result = await _sender.Send(
            new LoginCommand { Email = Input.Email, Password = Input.Password, RememberMe = Input.RememberMe },
            cancellationToken);

        if (result.IsFailure)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message ?? "Invalid login attempt.");
            return Page();
        }

        if (!string.IsNullOrEmpty(returnUrl) && Url.IsLocalUrl(returnUrl))
        {
            return Redirect(returnUrl);
        }

        return RedirectToPage("/Index");
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderRazorRegisterPage({ ns }) {
  return `@page
@model ${ns}.Web.Pages.Account.RegisterModel
@{
    ViewData["Title"] = "Register";
}

<div class="row justify-content-center">
    <div class="col-md-5">
        <h2 class="mb-4">Create Account</h2>
        <form method="post">
            <div asp-validation-summary="All" class="text-danger mb-3"></div>
            <div class="mb-3">
                <label asp-for="Input.DisplayName" class="form-label"></label>
                <input asp-for="Input.DisplayName" class="form-control" />
                <span asp-validation-for="Input.DisplayName" class="text-danger"></span>
            </div>
            <div class="mb-3">
                <label asp-for="Input.Email" class="form-label"></label>
                <input asp-for="Input.Email" class="form-control" />
                <span asp-validation-for="Input.Email" class="text-danger"></span>
            </div>
            <div class="mb-3">
                <label asp-for="Input.Password" class="form-label"></label>
                <input asp-for="Input.Password" class="form-control" />
                <span asp-validation-for="Input.Password" class="text-danger"></span>
            </div>
            <div class="mb-3">
                <label asp-for="Input.ConfirmPassword" class="form-label"></label>
                <input asp-for="Input.ConfirmPassword" class="form-control" />
                <span asp-validation-for="Input.ConfirmPassword" class="text-danger"></span>
            </div>
            <button type="submit" class="btn btn-primary w-100">Register</button>
        </form>
    </div>
</div>
`;
}

/** @param {{ ns: string, architecture: string }} ctx */
function renderRazorRegisterPageModel({ ns, architecture }) {
  const isServices = architecture === 'services';

  if (isServices) {
    return `using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ${ns}.Application.Modules.Authentication.DTOs;
using ${ns}.Application.Modules.Authentication.Interfaces;

namespace ${ns}.Web.Pages.Account;

public sealed class RegisterModel : PageModel
{
    private readonly IAuthService _authService;

    public RegisterModel(IAuthService authService)
    {
        _authService = authService;
    }

    [BindProperty]
    public InputModel Input { get; set; } = new();

    public class InputModel
    {
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;

        [Required]
        [StringLength(100, MinimumLength = 8)]
        [DataType(DataType.Password)]
        public string Password { get; set; } = string.Empty;

        [DataType(DataType.Password)]
        [Compare("Password", ErrorMessage = "The password and confirmation password do not match.")]
        public string ConfirmPassword { get; set; } = string.Empty;

        public string DisplayName { get; set; } = string.Empty;
    }

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync(CancellationToken cancellationToken = default)
    {
        if (!ModelState.IsValid)
        {
            return Page();
        }

        var result = await _authService.RegisterAsync(
            new RegisterRequestDto { Email = Input.Email, Password = Input.Password, DisplayName = Input.DisplayName },
            cancellationToken);

        if (result.IsFailure)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message ?? "Registration failed.");
            return Page();
        }

        return RedirectToPage("/Account/Login");
    }
}
`;
  }

  return `using System.ComponentModel.DataAnnotations;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ${ns}.Application.Features.Authentication.Commands.Register;

namespace ${ns}.Web.Pages.Account;

public sealed class RegisterModel : PageModel
{
    private readonly ISender _sender;

    public RegisterModel(ISender sender)
    {
        _sender = sender;
    }

    [BindProperty]
    public InputModel Input { get; set; } = new();

    public class InputModel
    {
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;

        [Required]
        [StringLength(100, MinimumLength = 8)]
        [DataType(DataType.Password)]
        public string Password { get; set; } = string.Empty;

        [DataType(DataType.Password)]
        [Compare("Password", ErrorMessage = "The password and confirmation password do not match.")]
        public string ConfirmPassword { get; set; } = string.Empty;

        public string DisplayName { get; set; } = string.Empty;
    }

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync(CancellationToken cancellationToken = default)
    {
        if (!ModelState.IsValid)
        {
            return Page();
        }

        var result = await _sender.Send(
            new RegisterCommand { Email = Input.Email, Password = Input.Password, DisplayName = Input.DisplayName },
            cancellationToken);

        if (result.IsFailure)
        {
            ModelState.AddModelError(string.Empty, result.Error.Message ?? "Registration failed.");
            return Page();
        }

        return RedirectToPage("/Account/Login");
    }
}
`;
}

/** @param {{ ns: string }} ctx */
function renderRazorLogoutPage({ ns }) {
  return `@page
@model ${ns}.Web.Pages.Account.LogoutModel
@{
    ViewData["Title"] = "Log out";
}

<div class="row justify-content-center">
    <div class="col-md-5">
        <h2 class="mb-4">Log Out</h2>
        <form method="post">
            <p>Are you sure you want to log out?</p>
            <button type="submit" class="btn btn-danger w-100">Log Out</button>
        </form>
    </div>
</div>
`;
}

/** @param {{ ns: string, architecture: string }} ctx */
function renderRazorLogoutPageModel({ ns, architecture }) {
  const isServices = architecture === 'services';

  if (isServices) {
    return `using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ${ns}.Application.Modules.Authentication.Interfaces;

namespace ${ns}.Web.Pages.Account;

public sealed class LogoutModel : PageModel
{
    private readonly IAuthService _authService;

    public LogoutModel(IAuthService authService)
    {
        _authService = authService;
    }

    public async Task<IActionResult> OnPostAsync(CancellationToken cancellationToken = default)
    {
        await _authService.LogoutAsync(cancellationToken);
        return RedirectToPage("/Index");
    }
}
`;
  }

  return `using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using ${ns}.Application.Features.Authentication.Commands.Logout;

namespace ${ns}.Web.Pages.Account;

public sealed class LogoutModel : PageModel
{
    private readonly ISender _sender;

    public LogoutModel(ISender sender)
    {
        _sender = sender;
    }

    public async Task<IActionResult> OnPostAsync(CancellationToken cancellationToken = default)
    {
        await _sender.Send(new LogoutCommand(), cancellationToken);
        return RedirectToPage("/Index");
    }
}
`;
}
