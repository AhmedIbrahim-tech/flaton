import { getBackendFilePath } from '../../utils/project-paths.js';
import { isDapperOnly, isServicesArchitecture } from './architecture.js';
import { upsertServiceRegistration } from './application-services.generator.js';
import { upsertInfrastructureRegistration } from './dapper-persistence.generator.js';
import {
  applicationDiPath,
  infrastructureDiPath,
  planDbSetUpdates,
  planRouterUpdate,
} from './clean-architecture.js';

export const DEFAULT_MAX_UPLOAD_BYTES = 52428800; // 50 MB

/**
 * Plan the shared file-storage infrastructure. These files are only meant to be
 * created the first time a feature declares a file/image field, so every plan
 * uses `writeMode: 'ifMissing'` and will never overwrite existing code.
 *
 * @param {string} projectName - root namespace of the backend project
 * @param {object} [config]
 * @returns {{ relativePath: string, contents: string, writeMode: string }[]}
 */
export function planFileStorageInfrastructure(projectName, config = {}) {
  const ns = projectName;
  const servicesMode = isServicesArchitecture(config.architecture);
  const dapperOnly = isDapperOnly(config.orm);

  /** @param {string} contents */
  const infra = (projectFolder, segments, contents) => ({
    relativePath: getBackendFilePath(config, projectFolder, ...segments),
    contents,
    writeMode: 'ifMissing',
  });

  const files = [
    infra('Domain', ['Entities', 'StoredFile.cs'], renderStoredFileEntity(ns)),
    infra('Application', ['Abstractions', 'Storage', 'IFileStorageService.cs'], renderStorageAbstraction(ns)),
    infra('Application', ['Features', 'Files', 'DTOs', 'StoredFileDto.cs'], renderStoredFileDto(ns)),
    infra('Infrastructure', ['Services', 'LocalFileStorageService.cs'], renderLocalStorageService(ns)),
    infra('Infrastructure', ['Services', 'FileStorageRegistration.cs'], renderStorageRegistration(ns)),
  ];

  if (dapperOnly) {
    files.push(
      infra('Application', ['Abstractions', 'Persistence', 'IFilesRepository.cs'], renderFilesRepositoryInterface(ns)),
      infra('Infrastructure', ['Persistence', 'Repositories', 'FilesRepository.cs'], renderFilesRepository(ns, config.database)),
    );
  } else {
    files.push(
      infra('Infrastructure', ['Persistence', 'Configurations', 'StoredFileConfiguration.cs'], renderStoredFileConfiguration(ns)),
    );
  }

  if (servicesMode) {
    files.push(
      infra('Application', ['Features', 'Files', 'Interfaces', 'IFilesService.cs'], renderFilesServiceInterface(ns)),
      infra('Application', ['Features', 'Files', 'FilesService.cs'], renderFilesService(ns, dapperOnly)),
      infra('API', ['Controllers', 'FilesController.cs'], renderFilesServiceController(ns)),
    );
  } else {
    files.push(
      infra('Application', ['Features', 'Files', 'Commands', 'Upload', 'UploadFileCommand.cs'], renderUploadCommand(ns)),
      infra('Application', ['Features', 'Files', 'Commands', 'Upload', 'UploadFileCommandHandler.cs'], renderUploadHandler(ns, dapperOnly)),
      infra('API', ['Controllers', 'FilesController.cs'], renderFilesController(ns)),
    );
  }

  return files;
}

/**
 * @param {object} config
 */
export function planFileStorageRegistry(config) {
  const ns = config.projectName;
  /** @type {{ relativePath: string, update: (existing: string) => string }[]} */
  const updates = [
    planRouterUpdate(config, ns, 'Files', 'Files', [{ name: 'Upload' }]),
  ];

  if (!isDapperOnly(config.orm)) {
    updates.push(...planDbSetUpdates(config, ns, 'StoredFile', 'StoredFiles'));
  }

  updates.push({
    relativePath: infrastructureDiPath(config),
    update: (existing) =>
      upsertInfrastructureRegistration(
        existing,
        ns,
        `using ${ns}.Infrastructure.Services;`,
        '',
        '        services.AddFileStorage();',
      ),
  });

  if (isServicesArchitecture(config.architecture)) {
    updates.push({
      relativePath: applicationDiPath(config),
      update: (existing) => upsertServiceRegistration(existing, ns, 'Files', 'Files'),
    });
  }

  if (isDapperOnly(config.orm)) {
    updates.push({
      relativePath: infrastructureDiPath(config),
      update: (existing) =>
        upsertInfrastructureRegistration(
          existing,
          ns,
          `using ${ns}.Application.Abstractions.Persistence;`,
          `using ${ns}.Infrastructure.Persistence.Repositories;`,
          '        services.AddScoped<IFilesRepository, FilesRepository>();',
        ),
    });
  }

  return updates;
}

/**
 * @param {string} ns
 */
function renderStoredFileEntity(ns) {
  return `using ${ns}.Domain.Common;

namespace ${ns}.Domain.Entities;

public sealed class StoredFile : BaseEntity
{
    public string FileName { get; set; } = string.Empty;

    public string ContentType { get; set; } = string.Empty;

    public long Size { get; set; }

    public string StoragePath { get; set; } = string.Empty;
}
`;
}

/**
 * @param {string} ns
 */
function renderStorageAbstraction(ns) {
  return `namespace ${ns}.Application.Abstractions.Storage;

public interface IFileStorageService
{
    Task<StoredFileResult> SaveAsync(
        Stream content,
        string fileName,
        string contentType,
        CancellationToken cancellationToken);

    Task<Stream?> OpenReadAsync(string storagePath, CancellationToken cancellationToken);

    Task DeleteAsync(string storagePath, CancellationToken cancellationToken);
}

public sealed record StoredFileResult(string StoragePath, long Size);
`;
}

/**
 * @param {string} ns
 */
function renderDbContextInterface(ns) {
  return `using Microsoft.EntityFrameworkCore;
using ${ns}.Domain.Entities;

namespace ${ns}.Application.Abstractions.Persistence;

public partial interface IApplicationDbContext
{
    DbSet<StoredFile> Files { get; }
}
`;
}

/**
 * @param {string} ns
 */
function renderStoredFileDto(ns) {
  return `namespace ${ns}.Application.Features.Files.DTOs;

public sealed record StoredFileDto
{
    public Guid Id { get; init; }

    public string FileName { get; init; } = string.Empty;

    public string ContentType { get; init; } = string.Empty;

    public long Size { get; init; }
}
`;
}

/**
 * @param {string} ns
 */
function renderUploadCommand(ns) {
  return `using MediatR;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Files.DTOs;

namespace ${ns}.Application.Features.Files.Commands.Upload;

public sealed record UploadFileCommand(
    Stream Content,
    string FileName,
    string ContentType,
    long Length) : IRequest<Result<StoredFileDto>>;
`;
}

/**
 * @param {string} ns
 */
function renderUploadHandler(ns, dapperOnly = false) {
  if (dapperOnly) {
    return `using MediatR;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Abstractions.Storage;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Files.DTOs;
using ${ns}.Domain.Entities;

namespace ${ns}.Application.Features.Files.Commands.Upload;

public sealed class UploadFileCommandHandler
    : IRequestHandler<UploadFileCommand, Result<StoredFileDto>>
{
    private readonly IFilesRepository _files;
    private readonly IFileStorageService _storage;

    public UploadFileCommandHandler(
        IFilesRepository files,
        IFileStorageService storage)
    {
        _files = files;
        _storage = storage;
    }

    public async Task<Result<StoredFileDto>> Handle(
        UploadFileCommand request,
        CancellationToken cancellationToken)
    {
        var saved = await _storage.SaveAsync(
            request.Content,
            request.FileName,
            request.ContentType,
            cancellationToken);

        var entity = new StoredFile
        {
            FileName = request.FileName,
            ContentType = request.ContentType,
            Size = saved.Size,
            StoragePath = saved.StoragePath,
        };

        await _files.InsertAsync(entity, cancellationToken);

        var dto = new StoredFileDto
        {
            Id = entity.Id,
            FileName = entity.FileName,
            ContentType = entity.ContentType,
            Size = entity.Size,
        };

        return Result.Success(dto);
    }
}
`;
  }

  return `using MediatR;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Abstractions.Storage;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Files.DTOs;
using ${ns}.Domain.Entities;

namespace ${ns}.Application.Features.Files.Commands.Upload;

public sealed class UploadFileCommandHandler
    : IRequestHandler<UploadFileCommand, Result<StoredFileDto>>
{
    private readonly IApplicationDbContext _dbContext;
    private readonly IFileStorageService _storage;

    public UploadFileCommandHandler(
        IApplicationDbContext dbContext,
        IFileStorageService storage)
    {
        _dbContext = dbContext;
        _storage = storage;
    }

    public async Task<Result<StoredFileDto>> Handle(
        UploadFileCommand request,
        CancellationToken cancellationToken)
    {
        var saved = await _storage.SaveAsync(
            request.Content,
            request.FileName,
            request.ContentType,
            cancellationToken);

        var entity = new StoredFile
        {
            FileName = request.FileName,
            ContentType = request.ContentType,
            Size = saved.Size,
            StoragePath = saved.StoragePath,
        };

        _dbContext.Files.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var dto = new StoredFileDto
        {
            Id = entity.Id,
            FileName = entity.FileName,
            ContentType = entity.ContentType,
            Size = entity.Size,
        };

        return Result.Success(dto);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderLocalStorageService(ns) {
  return `using ${ns}.Application.Abstractions.Storage;

namespace ${ns}.Infrastructure.Services;

public sealed class LocalFileStorageService : IFileStorageService
{
    private readonly string _root;

    public LocalFileStorageService()
    {
        _root = Path.Combine(Directory.GetCurrentDirectory(), "App_Data", "uploads");
        Directory.CreateDirectory(_root);
    }

    public async Task<StoredFileResult> SaveAsync(
        Stream content,
        string fileName,
        string contentType,
        CancellationToken cancellationToken)
    {
        var safeName = $"{Guid.NewGuid():N}_{Path.GetFileName(fileName)}";
        var fullPath = Path.Combine(_root, safeName);

        await using var target = File.Create(fullPath);
        await content.CopyToAsync(target, cancellationToken);

        return new StoredFileResult(safeName, target.Length);
    }

    public Task<Stream?> OpenReadAsync(string storagePath, CancellationToken cancellationToken)
    {
        var fullPath = Path.Combine(_root, storagePath);
        if (!File.Exists(fullPath))
        {
            return Task.FromResult<Stream?>(null);
        }

        Stream stream = File.OpenRead(fullPath);
        return Task.FromResult<Stream?>(stream);
    }

    public Task DeleteAsync(string storagePath, CancellationToken cancellationToken)
    {
        var fullPath = Path.Combine(_root, storagePath);
        if (File.Exists(fullPath))
        {
            File.Delete(fullPath);
        }

        return Task.CompletedTask;
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderStorageRegistration(ns) {
  return `using Microsoft.Extensions.DependencyInjection;
using ${ns}.Application.Abstractions.Storage;

namespace ${ns}.Infrastructure.Services;

public static class FileStorageRegistration
{
    public static IServiceCollection AddFileStorage(this IServiceCollection services)
    {
        services.AddScoped<IFileStorageService, LocalFileStorageService>();
        return services;
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderGeneratedDi(ns, dapperOnly = false) {
  const extraUsings = dapperOnly
    ? `\nusing ${ns}.Application.Abstractions.Persistence;\nusing ${ns}.Infrastructure.Persistence.Repositories;`
    : '';
  const extraRegs = dapperOnly
    ? `\n        services.AddScoped<IFilesRepository, FilesRepository>();`
    : '';

  return `// AUTO-GENERATED BY create-fullstack-feature
// DO NOT EDIT MANUALLY

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ${ns}.Infrastructure.Storage;${extraUsings}

namespace ${ns}.Infrastructure;

public static partial class DependencyInjection
{
    static partial void RegisterGeneratedInfrastructure(
        IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddFileStorage();${extraRegs}
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderDbContextImplementation(ns) {
  return `using Microsoft.EntityFrameworkCore;
using ${ns}.Domain.Entities;

namespace ${ns}.Infrastructure.Persistence;

public partial class ApplicationDbContext
{
    public DbSet<StoredFile> Files => Set<StoredFile>();
}
`;
}

/**
 * @param {string} ns
 */
function renderStoredFileConfiguration(ns) {
  return `using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ${ns}.Domain.Entities;

namespace ${ns}.Infrastructure.Persistence.Configurations;

public sealed class StoredFileConfiguration : IEntityTypeConfiguration<StoredFile>
{
    public void Configure(EntityTypeBuilder<StoredFile> builder)
    {
        builder.ToTable("Files");
        builder.HasKey(entity => entity.Id);

        builder.Property(entity => entity.FileName)
            .IsRequired()
            .HasMaxLength(260);

        builder.Property(entity => entity.ContentType)
            .IsRequired()
            .HasMaxLength(128);

        builder.Property(entity => entity.StoragePath)
            .IsRequired()
            .HasMaxLength(512);
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
    public static class Files
    {
        public const string Root = Rule + "/Files";
        public const string Upload = Root;
        public const string Download = Root + "/{id:guid}";
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderFilesController(ns) {
  return `using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ${ns}.API.Contracts;
using ${ns}.Application.Features.Files.Commands.Upload;

namespace ${ns}.API.Controllers;

[ApiController]
public sealed class FilesController : ApiControllerBase
{
    private readonly ISender _sender;

    public FilesController(ISender sender)
    {
        _sender = sender;
    }

    [HttpPost(Router.Files.Upload)]
    [RequestSizeLimit(${DEFAULT_MAX_UPLOAD_BYTES})]
    public async Task<IActionResult> Upload(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest("A non-empty file is required.");
        }

        await using var stream = file.OpenReadStream();
        var command = new UploadFileCommand(
            stream,
            file.FileName,
            file.ContentType,
            file.Length);

        var result = await _sender.Send(command, cancellationToken);
        return ToActionResult(result);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderFilesServiceInterface(ns) {
  return `using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Files.DTOs;

namespace ${ns}.Application.Features.Files.Interfaces;

public interface IFilesService
{
    Task<Result<StoredFileDto>> UploadAsync(
        Stream content,
        string fileName,
        string contentType,
        long length,
        CancellationToken cancellationToken);
}
`;
}

/**
 * @param {string} ns
 */
function renderFilesService(ns, dapperOnly = false) {
  if (dapperOnly) {
    return `using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Abstractions.Storage;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Files.DTOs;
using ${ns}.Application.Features.Files.Interfaces;
using ${ns}.Domain.Entities;

namespace ${ns}.Application.Features.Files;

public sealed class FilesService : IFilesService
{
    private readonly IFilesRepository _files;
    private readonly IFileStorageService _storage;

    public FilesService(IFilesRepository files, IFileStorageService storage)
    {
        _files = files;
        _storage = storage;
    }

    public async Task<Result<StoredFileDto>> UploadAsync(
        Stream content,
        string fileName,
        string contentType,
        long length,
        CancellationToken cancellationToken)
    {
        var saved = await _storage.SaveAsync(
            content,
            fileName,
            contentType,
            cancellationToken);

        var entity = new StoredFile
        {
            FileName = fileName,
            ContentType = contentType,
            Size = saved.Size,
            StoragePath = saved.StoragePath,
        };

        await _files.InsertAsync(entity, cancellationToken);

        var dto = new StoredFileDto
        {
            Id = entity.Id,
            FileName = entity.FileName,
            ContentType = entity.ContentType,
            Size = entity.Size,
        };

        return Result.Success(dto);
    }
}
`;
  }

  return `using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Application.Abstractions.Storage;
using ${ns}.Application.Common.Results;
using ${ns}.Application.Features.Files.DTOs;
using ${ns}.Application.Features.Files.Interfaces;
using ${ns}.Domain.Entities;

namespace ${ns}.Application.Features.Files;

public sealed class FilesService : IFilesService
{
    private readonly IApplicationDbContext _dbContext;
    private readonly IFileStorageService _storage;

    public FilesService(IApplicationDbContext dbContext, IFileStorageService storage)
    {
        _dbContext = dbContext;
        _storage = storage;
    }

    public async Task<Result<StoredFileDto>> UploadAsync(
        Stream content,
        string fileName,
        string contentType,
        long length,
        CancellationToken cancellationToken)
    {
        var saved = await _storage.SaveAsync(
            content,
            fileName,
            contentType,
            cancellationToken);

        var entity = new StoredFile
        {
            FileName = fileName,
            ContentType = contentType,
            Size = saved.Size,
            StoragePath = saved.StoragePath,
        };

        _dbContext.Files.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var dto = new StoredFileDto
        {
            Id = entity.Id,
            FileName = entity.FileName,
            ContentType = entity.ContentType,
            Size = entity.Size,
        };

        return Result.Success(dto);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderFilesServiceController(ns) {
  return `using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ${ns}.API.Contracts;
using ${ns}.Application.Features.Files.Interfaces;

namespace ${ns}.API.Controllers;

[ApiController]
public sealed class FilesController : ApiControllerBase
{
    private readonly IFilesService _service;

    public FilesController(IFilesService service)
    {
        _service = service;
    }

    [HttpPost(Router.Files.Upload)]
    [RequestSizeLimit(${DEFAULT_MAX_UPLOAD_BYTES})]
    public async Task<IActionResult> Upload(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest("A non-empty file is required.");
        }

        await using var stream = file.OpenReadStream();
        var result = await _service.UploadAsync(
            stream,
            file.FileName,
            file.ContentType,
            file.Length,
            cancellationToken);
        return ToActionResult(result);
    }
}
`;
}

/**
 * @param {string} ns
 */
function renderFilesRepositoryInterface(ns) {
  return `using ${ns}.Domain.Entities;

namespace ${ns}.Application.Abstractions.Persistence;

public interface IFilesRepository
{
    Task InsertAsync(StoredFile entity, CancellationToken cancellationToken);
}
`;
}

/**
 * @param {string} ns
 * @param {string} [database]
 */
function renderFilesRepository(ns, database = 'sqlserver') {
  const table = database === 'sqlserver' ? '[Files]' : '"Files"';
  const q = (name) => (database === 'sqlserver' ? `[${name}]` : `"${name}"`);

  return `using Dapper;
using ${ns}.Application.Abstractions.Persistence;
using ${ns}.Domain.Entities;

namespace ${ns}.Infrastructure.Persistence.Repositories;

public sealed class FilesRepository : IFilesRepository
{
    private readonly IDbConnectionFactory _connections;

    public FilesRepository(IDbConnectionFactory connections)
    {
        _connections = connections;
    }

    public async Task InsertAsync(StoredFile entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        entity.CreatedAtUtc = DateTime.UtcNow;
        entity.IsDeleted = false;
        using var connection = _connections.CreateConnection();
        await connection.ExecuteAsync(
            $"INSERT INTO ${table} (${q('Id')}, ${q('CreatedAtUtc')}, ${q('IsDeleted')}, ${q('FileName')}, ${q('ContentType')}, ${q('Size')}, ${q('StoragePath')}) VALUES (@Id, @CreatedAtUtc, @IsDeleted, @FileName, @ContentType, @Size, @StoragePath)",
            entity);
    }
}
`;
}
