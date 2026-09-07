using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Npgsql;
using PokeFolio.Api.Auth;
using PokeFolio.Domain.Abstractions;
using PokeFolio.Domain.Collection;
using PokeFolio.Infrastructure.Catalog;
using PokeFolio.Infrastructure.Identity;
using PokeFolio.Infrastructure.Persistence;
using PokeFolio.Infrastructure.Sync;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class PostgreSqlIsolationTests
{
    private static readonly byte[] ApiSigningKey = Enumerable.Range(1, 32)
        .Select(value => (byte)value)
        .ToArray();

    [TestMethod]
    [TestCategory("PostgreSQL")]
    public async Task MigrationEnforcesOwnershipFiltersAndNullableHoldingIdentity()
    {
        string? serverConnectionString = Environment.GetEnvironmentVariable("POKEFOLIO_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(serverConnectionString))
        {
            Assert.Inconclusive(
                "Set POKEFOLIO_TEST_POSTGRES to run the isolated PostgreSQL integration test.");
            return;
        }

        string databaseName = $"pokefolio_test_{Guid.NewGuid():N}";
        string testConnectionString = await CreateDatabaseAsync(serverConnectionString, databaseName);

        try
        {
            await using (PokeFolioDbContext migrationContext = CreateContext(testConnectionString, null))
            {
                await migrationContext.Database.MigrateAsync();
            }

            Guid userAId = Guid.NewGuid();
            Guid userBId = Guid.NewGuid();
            Guid cardId = Guid.NewGuid();
            Guid userADeviceId = Guid.NewGuid();
            Guid userAHoldingId = Guid.NewGuid();
            Guid userBHoldingId = Guid.NewGuid();
            DateTimeOffset now = DateTimeOffset.UtcNow;

            await using (PokeFolioDbContext seedContext = CreateContext(testConnectionString, null))
            {
                seedContext.Users.AddRange(
                    CreateUser(userAId, "user-a@example.test", now),
                    CreateUser(userBId, "user-b@example.test", now));
                seedContext.Cards.Add(new CatalogCard
                {
                    Id = cardId,
                    Tcg = "pokemon",
                    Provider = "integration-test",
                    ProviderCardId = "sv-test-001",
                    Name = "Isolation Test Card",
                    SetCode = "SVT",
                    Number = "001/100",
                    CreatedAt = now,
                    UpdatedAt = now
                });
                seedContext.DeviceSessions.Add(new DeviceSession
                {
                    Id = userADeviceId,
                    UserId = userAId,
                    TokenFamilyId = Guid.NewGuid(),
                    RefreshTokenHash = new string('a', 64),
                    DeviceName = "Integration test device",
                    Platform = "test",
                    CreatedAt = now,
                    LastSeenAt = now,
                    ExpiresAt = now.AddDays(1)
                });
                seedContext.CollectionHoldings.AddRange(
                    CreateHolding(userAHoldingId, userAId, cardId, now),
                    CreateHolding(userBHoldingId, userBId, cardId, now));
                await seedContext.SaveChangesAsync();
            }

            await AssertUserCanOnlySeeOwnHoldingAsync(
                testConnectionString,
                userAId,
                userAHoldingId,
                userBHoldingId);
            await AssertUserCanOnlySeeOwnHoldingAsync(
                testConnectionString,
                userBId,
                userBHoldingId,
                userAHoldingId);

            await using (PokeFolioDbContext anonymousContext = CreateContext(testConnectionString, null))
            {
                Assert.AreEqual(0, await anonymousContext.CollectionHoldings.CountAsync());
            }

            await using (PokeFolioDbContext duplicateContext = CreateContext(testConnectionString, userAId))
            {
                duplicateContext.CollectionHoldings.Add(
                    CreateHolding(Guid.NewGuid(), userAId, cardId, now.AddSeconds(1)));
                await Assert.ThrowsExactlyAsync<DbUpdateException>(
                    async () => await duplicateContext.SaveChangesAsync());
            }

            await using (PokeFolioDbContext crossUserOperationContext =
                CreateContext(testConnectionString, userBId))
            {
                crossUserOperationContext.ProcessedSyncOperations.Add(new ProcessedSyncOperation
                {
                    UserId = userBId,
                    DeviceSessionId = userADeviceId,
                    OperationId = Guid.NewGuid(),
                    Status = "applied",
                    ProcessedAt = now.AddSeconds(2)
                });
                await Assert.ThrowsExactlyAsync<DbUpdateException>(
                    async () => await crossUserOperationContext.SaveChangesAsync());
            }
        }
        finally
        {
            await DropDatabaseAsync(serverConnectionString, databaseName);
        }
    }

    [TestMethod]
    [TestCategory("PostgreSQL")]
    public async Task AuthenticationFlowRotatesRefreshTokensAndIsolatesDeviceSessions()
    {
        string? serverConnectionString = Environment.GetEnvironmentVariable("POKEFOLIO_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(serverConnectionString))
        {
            Assert.Inconclusive(
                "Set POKEFOLIO_TEST_POSTGRES to run the isolated PostgreSQL authentication test.");
            return;
        }

        string databaseName = $"pokefolio_test_{Guid.NewGuid():N}";
        string testConnectionString = await CreateDatabaseAsync(serverConnectionString, databaseName);

        try
        {
            await using (PokeFolioDbContext migrationContext = CreateContext(testConnectionString, null))
            {
                await migrationContext.Database.MigrateAsync();
            }

            using var factory = new PokeFolioApiFactory(testConnectionString);
            using HttpClient client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false
            });

            using (HttpResponseMessage unauthenticated = await client.PostAsync(
                       "/api/v1/auth/logout",
                       content: null))
            {
                Assert.AreEqual(HttpStatusCode.Unauthorized, unauthenticated.StatusCode);
                Assert.AreEqual(
                    "application/problem+json",
                    unauthenticated.Content.Headers.ContentType?.MediaType);
            }

            AuthSessionResponse userA = await RegisterAsync(
                client,
                "auth-a@example.test",
                "Pixel Phone");
            AuthSessionResponse userB = await RegisterAsync(
                client,
                "auth-b@example.test",
                "Windows PC");

            await AssertDeviceIsolationAsync(
                testConnectionString,
                "auth-a@example.test",
                userA.Device.Id,
                userB.Device.Id);
            await AssertDeviceIsolationAsync(
                testConnectionString,
                "auth-b@example.test",
                userB.Device.Id,
                userA.Device.Id);

            using HttpResponseMessage invalidLogin = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new LoginCommand(
                    "auth-a@example.test",
                    "Wrong password 1!",
                    "Attacker",
                    "windows"));
            Assert.AreEqual(HttpStatusCode.Unauthorized, invalidLogin.StatusCode);

            AuthSessionResponse rotated = await RefreshAsync(client, userA.RefreshToken);
            Assert.AreNotEqual(userA.RefreshToken, rotated.RefreshToken);
            Assert.AreEqual(userA.Device.Id, rotated.Device.Id);

            using HttpResponseMessage replay = await client.PostAsJsonAsync(
                "/api/v1/auth/refresh",
                new RefreshCommand(userA.RefreshToken));
            Assert.AreEqual(HttpStatusCode.Unauthorized, replay.StatusCode);

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", rotated.AccessToken);
            using HttpResponseMessage revokedAccess = await client.PostAsync(
                "/api/v1/auth/logout",
                content: null);
            Assert.AreEqual(HttpStatusCode.Unauthorized, revokedAccess.StatusCode);

            client.DefaultRequestHeaders.Authorization = null;
            using HttpResponseMessage loginResponse = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new LoginCommand(
                    "auth-a@example.test",
                    "A secure PokeFolio password 1!",
                    "Pixel Phone 2",
                    "android"));
            Assert.AreEqual(HttpStatusCode.OK, loginResponse.StatusCode);
            AuthSessionResponse? relogged = await loginResponse.Content
                .ReadFromJsonAsync<AuthSessionResponse>();
            Assert.IsNotNull(relogged);

            client.DefaultRequestHeaders.Authorization = null;
            using HttpResponseMessage otherLoginResponse = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new LoginCommand(
                    "auth-a@example.test",
                    "A secure PokeFolio password 1!",
                    "Windows Laptop",
                    "windows"));
            Assert.AreEqual(HttpStatusCode.OK, otherLoginResponse.StatusCode);
            AuthSessionResponse? otherSession = await otherLoginResponse.Content
                .ReadFromJsonAsync<AuthSessionResponse>();
            Assert.IsNotNull(otherSession);

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", relogged.AccessToken);
            using (HttpResponseMessage devicesResponse = await client.GetAsync("/api/v1/devices"))
            {
                Assert.AreEqual(HttpStatusCode.OK, devicesResponse.StatusCode);
                DeviceResponse[]? devices = await devicesResponse.Content
                    .ReadFromJsonAsync<DeviceResponse[]>();
                Assert.IsNotNull(devices);
                Assert.HasCount(2, devices);
                Assert.AreEqual(1, devices.Count(device => device.Current));
                Assert.IsTrue(devices.Single(device => device.Current).Id == relogged.Device.Id);
                Assert.IsTrue(devices.Any(device => device.Id == otherSession.Device.Id));
            }

            using (HttpResponseMessage currentDeviceDelete = await client.DeleteAsync(
                       $"/api/v1/devices/{relogged.Device.Id}"))
            {
                Assert.AreEqual(HttpStatusCode.Conflict, currentDeviceDelete.StatusCode);
                Assert.AreEqual(
                    "application/problem+json",
                    currentDeviceDelete.Content.Headers.ContentType?.MediaType);
            }

            using (HttpResponseMessage crossUserDelete = await client.DeleteAsync(
                       $"/api/v1/devices/{userB.Device.Id}"))
            {
                Assert.AreEqual(HttpStatusCode.NotFound, crossUserDelete.StatusCode);
            }

            using (HttpResponseMessage targetDelete = await client.DeleteAsync(
                       $"/api/v1/devices/{otherSession.Device.Id}"))
            {
                Assert.AreEqual(HttpStatusCode.NoContent, targetDelete.StatusCode);
            }

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", otherSession.AccessToken);
            using (HttpResponseMessage targetRevoked = await client.GetAsync("/api/v1/devices"))
            {
                Assert.AreEqual(HttpStatusCode.Unauthorized, targetRevoked.StatusCode);
            }

            client.DefaultRequestHeaders.Authorization = null;
            using HttpResponseMessage thirdLoginResponse = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new LoginCommand(
                    "auth-a@example.test",
                    "A secure PokeFolio password 1!",
                    "Tablet",
                    "android"));
            Assert.AreEqual(HttpStatusCode.OK, thirdLoginResponse.StatusCode);
            AuthSessionResponse? thirdSession = await thirdLoginResponse.Content
                .ReadFromJsonAsync<AuthSessionResponse>();
            Assert.IsNotNull(thirdSession);

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", relogged.AccessToken);
            using (HttpResponseMessage revokeOthers = await client.DeleteAsync("/api/v1/devices"))
            {
                Assert.AreEqual(HttpStatusCode.NoContent, revokeOthers.StatusCode);
            }

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", thirdSession.AccessToken);
            using (HttpResponseMessage otherDevicesRevoked = await client.GetAsync("/api/v1/devices"))
            {
                Assert.AreEqual(HttpStatusCode.Unauthorized, otherDevicesRevoked.StatusCode);
            }

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", relogged.AccessToken);
            using HttpResponseMessage logout = await client.PostAsync(
                "/api/v1/auth/logout",
                content: null);
            Assert.AreEqual(HttpStatusCode.NoContent, logout.StatusCode);

            using HttpResponseMessage loggedOutAccess = await client.PostAsync(
                "/api/v1/auth/logout",
                content: null);
            Assert.AreEqual(HttpStatusCode.Unauthorized, loggedOutAccess.StatusCode);
        }
        finally
        {
            await DropDatabaseAsync(serverConnectionString, databaseName);
        }
    }

    private static async Task<AuthSessionResponse> RegisterAsync(
        HttpClient client,
        string email,
        string deviceName)
    {
        using HttpResponseMessage response = await client.PostAsJsonAsync(
            "/api/v1/auth/register",
            new RegisterCommand(
                email,
                "A secure PokeFolio password 1!",
                deviceName,
                deviceName.StartsWith("Windows", StringComparison.Ordinal) ? "windows" : "android"));
        Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
        AuthSessionResponse? session = await response.Content.ReadFromJsonAsync<AuthSessionResponse>();
        Assert.IsNotNull(session);
        return session;
    }

    private static async Task<AuthSessionResponse> RefreshAsync(HttpClient client, string refreshToken)
    {
        using HttpResponseMessage response = await client.PostAsJsonAsync(
            "/api/v1/auth/refresh",
            new RefreshCommand(refreshToken));
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        AuthSessionResponse? session = await response.Content.ReadFromJsonAsync<AuthSessionResponse>();
        Assert.IsNotNull(session);
        return session;
    }

    private static async Task AssertDeviceIsolationAsync(
        string connectionString,
        string email,
        Guid ownDeviceId,
        Guid otherDeviceId)
    {
        Guid userId;
        await using (PokeFolioDbContext lookupContext = CreateContext(connectionString, null))
        {
            userId = await lookupContext.Users
                .Where(user => user.Email == email)
                .Select(user => user.Id)
                .SingleAsync();
        }

        await using PokeFolioDbContext userContext = CreateContext(connectionString, userId);
        DeviceSession[] visible = await userContext.DeviceSessions.AsNoTracking().ToArrayAsync();
        Assert.HasCount(1, visible);
        Assert.AreEqual(ownDeviceId, visible[0].Id);
        Assert.IsNull(await userContext.DeviceSessions.AsNoTracking()
            .SingleOrDefaultAsync(device => device.Id == otherDeviceId));
    }

    private static async Task AssertUserCanOnlySeeOwnHoldingAsync(
        string connectionString,
        Guid userId,
        Guid ownHoldingId,
        Guid otherHoldingId)
    {
        await using PokeFolioDbContext context = CreateContext(connectionString, userId);
        CollectionHolding[] visible = await context.CollectionHoldings.AsNoTracking().ToArrayAsync();
        Assert.HasCount(1, visible);
        Assert.AreEqual(ownHoldingId, visible[0].Id);
        Assert.IsNull(await context.CollectionHoldings.AsNoTracking()
            .SingleOrDefaultAsync(holding => holding.Id == otherHoldingId));
    }

    private static ApplicationUser CreateUser(Guid id, string email, DateTimeOffset now) => new()
    {
        Id = id,
        UserName = email,
        NormalizedUserName = email.ToUpperInvariant(),
        Email = email,
        NormalizedEmail = email.ToUpperInvariant(),
        SecurityStamp = Guid.NewGuid().ToString("N"),
        CreatedAt = now,
        UpdatedAt = now
    };

    private static CollectionHolding CreateHolding(
        Guid id,
        Guid userId,
        Guid cardId,
        DateTimeOffset now) =>
        CollectionHolding.Create(
            id,
            userId,
            cardId,
            variantId: null,
            language: "en",
            variant: "normal",
            condition: "near-mint",
            quantity: 1,
            notes: null,
            now);

    private static PokeFolioDbContext CreateContext(string connectionString, Guid? userId)
    {
        var options = new DbContextOptionsBuilder<PokeFolioDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        return new PokeFolioDbContext(options, new StubUserContext(userId));
    }

    private static async Task<string> CreateDatabaseAsync(
        string serverConnectionString,
        string databaseName)
    {
        var adminBuilder = new NpgsqlConnectionStringBuilder(serverConnectionString)
        {
            Database = "postgres",
            Pooling = false
        };
        await using var connection = new NpgsqlConnection(adminBuilder.ConnectionString);
        await connection.OpenAsync();
        await using NpgsqlCommand command = connection.CreateCommand();
#pragma warning disable CA2100 // The identifier is generated locally and safely quoted.
        command.CommandText = $"CREATE DATABASE {QuoteIdentifier(databaseName)}";
#pragma warning restore CA2100
        await command.ExecuteNonQueryAsync();

        var testBuilder = new NpgsqlConnectionStringBuilder(serverConnectionString)
        {
            Database = databaseName,
            Pooling = false
        };
        return testBuilder.ConnectionString;
    }

    private static async Task DropDatabaseAsync(string serverConnectionString, string databaseName)
    {
        NpgsqlConnection.ClearAllPools();
        var adminBuilder = new NpgsqlConnectionStringBuilder(serverConnectionString)
        {
            Database = "postgres",
            Pooling = false
        };
        await using var connection = new NpgsqlConnection(adminBuilder.ConnectionString);
        await connection.OpenAsync();

        await using (NpgsqlCommand terminate = connection.CreateCommand())
        {
            terminate.CommandText = """
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = @database_name AND pid <> pg_backend_pid();
                """;
            terminate.Parameters.AddWithValue("database_name", databaseName);
            await terminate.ExecuteNonQueryAsync();
        }

        await using NpgsqlCommand drop = connection.CreateCommand();
#pragma warning disable CA2100 // The identifier is generated locally and safely quoted.
        drop.CommandText = $"DROP DATABASE IF EXISTS {QuoteIdentifier(databaseName)}";
#pragma warning restore CA2100
        await drop.ExecuteNonQueryAsync();
    }

    private static string QuoteIdentifier(string identifier)
    {
        using var builder = new NpgsqlCommandBuilder();
        return builder.QuoteIdentifier(identifier);
    }

    private sealed record StubUserContext(Guid? UserId) : IUserContext;

    private sealed class PokeFolioApiFactory(string connectionString)
        : WebApplicationFactory<global::Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, configuration) =>
            {
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:PokeFolio"] = connectionString,
                    ["Auth:Issuer"] = "pokefolio-integration-tests",
                    ["Auth:Audience"] = "pokefolio-test-clients",
                    ["Auth:SigningKey"] = Convert.ToBase64String(ApiSigningKey),
                    ["Auth:SigningKeyId"] = "integration-test-key",
                    ["Auth:AccessTokenMinutes"] = "10",
                    ["Auth:RefreshTokenDays"] = "30"
                });
            });
        }
    }
}
