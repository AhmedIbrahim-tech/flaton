using Microsoft.Extensions.Logging;

namespace __PASCAL_NAME__.Infrastructure.Seeders;

public sealed class DatabaseSeeder
{
    private readonly ILogger<DatabaseSeeder> _logger;

    public DatabaseSeeder(ILogger<DatabaseSeeder> logger)
    {
        _logger = logger;
    }

    public Task SeedAsync(CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Database seeding completed.");
        return Task.CompletedTask;
    }
}
