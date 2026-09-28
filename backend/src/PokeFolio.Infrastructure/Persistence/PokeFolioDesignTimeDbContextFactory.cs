using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using PokeFolio.Domain.Abstractions;

namespace PokeFolio.Infrastructure.Persistence;

public sealed class PokeFolioDesignTimeDbContextFactory : IDesignTimeDbContextFactory<PokeFolioDbContext>
{
    public PokeFolioDbContext CreateDbContext(string[] args)
    {
        string connectionString = Environment.GetEnvironmentVariable("POKEFOLIO_DB_CONNECTION")
            ?? throw new InvalidOperationException(
                "Set POKEFOLIO_DB_CONNECTION before creating or inspecting database migrations.");
        var options = new DbContextOptionsBuilder<PokeFolioDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        return new PokeFolioDbContext(options, DesignTimeUserContext.Instance);
    }

    private sealed class DesignTimeUserContext : IUserContext
    {
        public static readonly DesignTimeUserContext Instance = new();
        public Guid? UserId => null;
    }
}
