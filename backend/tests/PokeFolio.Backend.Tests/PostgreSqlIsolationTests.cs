using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Npgsql;
using PokeFolio.Api.Auth;
using PokeFolio.Api.Collection;
using PokeFolio.Api.Sync;
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
    private static readonly string[] CanonicalizedLegacyActions =
        ["upsert", "upsert", "delete"];
    private static readonly string[] LegacyActions =
        ["created", "updated", "deleted"];
    private static readonly string[] InitialBatchStatuses =
        ["applied", "duplicate", "conflict", "applied", "applied", "conflict", "rejected", "applied"];
    private static readonly string[] RetryBatchStatuses =
        ["duplicate", "duplicate", "conflict", "duplicate", "duplicate", "rejected", "rejected", "duplicate"];

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

            await using (PokeFolioDbContext quantityConstraintContext =
                CreateContext(testConnectionString, userAId))
            {
                int invalidQuantity = CollectionHolding.MaximumQuantity + 1;
                await Assert.ThrowsExactlyAsync<PostgresException>(async () =>
                    await quantityConstraintContext.Database.ExecuteSqlInterpolatedAsync(
                        $"UPDATE collection.holdings SET quantity = {invalidQuantity} WHERE id = {userAHoldingId}"));
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
    public async Task QuantityConstraintUpgradePreservesLegacyValuesWithoutBlockingDeployment()
    {
        string? serverConnectionString = Environment.GetEnvironmentVariable("POKEFOLIO_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(serverConnectionString))
        {
            Assert.Inconclusive(
                "Set POKEFOLIO_TEST_POSTGRES to run the PostgreSQL migration upgrade test.");
            return;
        }

        string databaseName = $"pokefolio_test_{Guid.NewGuid():N}";
        string testConnectionString = await CreateDatabaseAsync(serverConnectionString, databaseName);

        try
        {
            Guid userId = Guid.NewGuid();
            Guid cardId = Guid.NewGuid();
            Guid holdingId = Guid.NewGuid();
            DateTimeOffset now = DateTimeOffset.UtcNow;
            await using (PokeFolioDbContext upgrade = CreateContext(testConnectionString, null))
            {
                IMigrator migrator = upgrade.Database.GetService<IMigrator>();
                await migrator.MigrateAsync("20260907165006_AddRefreshTokenReplayTracking");
                upgrade.Users.Add(CreateUser(userId, "legacy-quantity@example.test", now));
                upgrade.Cards.Add(new CatalogCard
                {
                    Id = cardId,
                    Tcg = "pokemon",
                    Provider = "integration-test",
                    ProviderCardId = "legacy-quantity-card",
                    Name = "Legacy Quantity Card",
                    SetCode = "TEST",
                    Number = "legacy",
                    CreatedAt = now,
                    UpdatedAt = now
                });
                await upgrade.SaveChangesAsync();
                int legacyQuantity = CollectionHolding.MaximumQuantity + 1;
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO collection.holdings
                        (id, user_id, card_id, variant_id, language, variant, condition,
                         quantity, notes, version, created_at, updated_at)
                    VALUES
                        ({holdingId}, {userId}, {cardId}, NULL, {"de"}, {"normal"}, {"near-mint"},
                         {legacyQuantity}, NULL, {1L}, {now}, {now})
                    """);

                await migrator.MigrateAsync();
            }

            await using var connection = new NpgsqlConnection(testConnectionString);
            await connection.OpenAsync();
            await using (NpgsqlCommand quantity = connection.CreateCommand())
            {
                quantity.CommandText =
                    "SELECT quantity FROM collection.holdings WHERE id = @holding_id";
                quantity.Parameters.AddWithValue("holding_id", holdingId);
                Assert.AreEqual(
                    CollectionHolding.MaximumQuantity + 1,
                    (int)(await quantity.ExecuteScalarAsync())!);
            }
            await using (NpgsqlCommand validation = connection.CreateCommand())
            {
                validation.CommandText = """
                    SELECT convalidated
                    FROM pg_constraint
                    WHERE conname = 'ck_holdings_quantity_range';
                    """;
                Assert.AreEqual(false, (bool)(await validation.ExecuteScalarAsync())!);
            }
        }
        finally
        {
            await DropDatabaseAsync(serverConnectionString, databaseName);
        }
    }

    [TestMethod]
    [TestCategory("PostgreSQL")]
    public async Task UnknownLegacyChangeActionStopsUpgradeWithoutMutatingTheRow()
    {
        string? serverConnectionString = Environment.GetEnvironmentVariable("POKEFOLIO_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(serverConnectionString))
        {
            Assert.Inconclusive(
                "Set POKEFOLIO_TEST_POSTGRES to run the PostgreSQL fail-closed upgrade test.");
            return;
        }

        string databaseName = $"pokefolio_test_{Guid.NewGuid():N}";
        string testConnectionString = await CreateDatabaseAsync(serverConnectionString, databaseName);

        try
        {
            Guid userId = Guid.NewGuid();
            Guid entityId = Guid.NewGuid();
            DateTimeOffset now = DateTimeOffset.UtcNow;
            await using (PokeFolioDbContext upgrade = CreateContext(testConnectionString, null))
            {
                IMigrator migrator = upgrade.Database.GetService<IMigrator>();
                await migrator.MigrateAsync("20260908041658_BindIdempotencyPayload");
                upgrade.Users.Add(CreateUser(userId, "unknown-action@example.test", now));
                await upgrade.SaveChangesAsync();
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO sync.changes
                        (user_id, entity_type, entity_id, action, version, payload_json, occurred_at)
                    VALUES
                        ({userId}, {"holding"}, {entityId}, {"legacy-custom"}, {1L}, NULL, {now})
                    """);

                await Assert.ThrowsExactlyAsync<PostgresException>(
                    async () => await migrator.MigrateAsync());
            }

            await using var connection = new NpgsqlConnection(testConnectionString);
            await connection.OpenAsync();
            await using (NpgsqlCommand action = connection.CreateCommand())
            {
                action.CommandText =
                    "SELECT action FROM sync.changes WHERE entity_id = @entity_id";
                action.Parameters.AddWithValue("entity_id", entityId);
                Assert.AreEqual("legacy-custom", (string)(await action.ExecuteScalarAsync())!);
            }
            await using (NpgsqlCommand history = connection.CreateCommand())
            {
                history.CommandText = """
                    SELECT count(*)
                    FROM "__EFMigrationsHistory"
                    WHERE "MigrationId" LIKE '%CanonicalizeChangeActions';
                    """;
                Assert.AreEqual(0L, (long)(await history.ExecuteScalarAsync())!);
            }
        }
        finally
        {
            await DropDatabaseAsync(serverConnectionString, databaseName);
        }
    }

    [TestMethod]
    [TestCategory("PostgreSQL")]
    public async Task TombstoneUpgradePreservesHoldingsAndCanonicalizesKnownLegacyActions()
    {
        string? serverConnectionString = Environment.GetEnvironmentVariable("POKEFOLIO_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(serverConnectionString))
        {
            Assert.Inconclusive(
                "Set POKEFOLIO_TEST_POSTGRES to run the PostgreSQL tombstone upgrade test.");
            return;
        }

        string databaseName = $"pokefolio_test_{Guid.NewGuid():N}";
        string testConnectionString = await CreateDatabaseAsync(serverConnectionString, databaseName);

        try
        {
            Guid userId = Guid.NewGuid();
            Guid cardId = Guid.NewGuid();
            Guid holdingId = Guid.NewGuid();
            DateTimeOffset now = DateTimeOffset.UtcNow;
            await using (PokeFolioDbContext upgrade = CreateContext(testConnectionString, null))
            {
                IMigrator migrator = upgrade.Database.GetService<IMigrator>();
                await migrator.MigrateAsync("20260908041658_BindIdempotencyPayload");
                upgrade.Users.Add(CreateUser(userId, "legacy-actions@example.test", now));
                upgrade.Cards.Add(new CatalogCard
                {
                    Id = cardId,
                    Tcg = "pokemon",
                    Provider = "integration-test",
                    ProviderCardId = "legacy-action-card",
                    Name = "Legacy Action Card",
                    SetCode = "TEST",
                    Number = "actions",
                    CreatedAt = now,
                    UpdatedAt = now
                });
                await upgrade.SaveChangesAsync();
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO collection.holdings
                        (id, user_id, card_id, variant_id, language, variant, condition,
                         quantity, notes, version, created_at, updated_at)
                    VALUES
                        ({holdingId}, {userId}, {cardId}, NULL, {"de"}, {"normal"}, {"near-mint"},
                         {1}, NULL, {1L}, {now}, {now})
                    """);
                foreach (string action in LegacyActions)
                {
                    await upgrade.Database.ExecuteSqlInterpolatedAsync($"""
                        INSERT INTO sync.changes
                            (user_id, entity_type, entity_id, action, version, payload_json, occurred_at)
                        VALUES
                            ({userId}, {"holding"}, {holdingId}, {action}, {1L}, NULL, {now})
                        """);
                }

                await migrator.MigrateAsync();
            }

            await using var connection = new NpgsqlConnection(testConnectionString);
            await connection.OpenAsync();
            await using (NpgsqlCommand tombstoneColumn = connection.CreateCommand())
            {
                tombstoneColumn.CommandText =
                    "SELECT deleted_at FROM collection.holdings WHERE id = @holding_id";
                tombstoneColumn.Parameters.AddWithValue("holding_id", holdingId);
                Assert.AreEqual(DBNull.Value, await tombstoneColumn.ExecuteScalarAsync());
            }
            var actions = new List<string>();
            await using (NpgsqlCommand canonicalActions = connection.CreateCommand())
            {
                canonicalActions.CommandText =
                    "SELECT action FROM sync.changes ORDER BY sequence";
                await using NpgsqlDataReader reader = await canonicalActions.ExecuteReaderAsync();
                while (await reader.ReadAsync()) actions.Add(reader.GetString(0));
            }
            CollectionAssert.AreEqual(CanonicalizedLegacyActions, actions.ToArray());

            await using (NpgsqlCommand validation = connection.CreateCommand())
            {
                validation.CommandText = """
                    SELECT convalidated
                    FROM pg_constraint
                    WHERE conname = 'ck_changes_action';
                    """;
                Assert.AreEqual(true, (bool)(await validation.ExecuteScalarAsync())!);
            }
            await using (NpgsqlCommand rejectedAction = connection.CreateCommand())
            {
                rejectedAction.CommandText = """
                    INSERT INTO sync.changes
                        (user_id, entity_type, entity_id, action, version, payload_json, occurred_at)
                    VALUES
                        (@user_id, 'holding', @entity_id, 'invalid-new-action', 1, NULL, @occurred_at)
                    """;
                rejectedAction.Parameters.AddWithValue("user_id", userId);
                rejectedAction.Parameters.AddWithValue("entity_id", Guid.NewGuid());
                rejectedAction.Parameters.AddWithValue("occurred_at", now);
                await Assert.ThrowsExactlyAsync<PostgresException>(
                    async () => await rejectedAction.ExecuteNonQueryAsync());
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

            client.DefaultRequestHeaders.Authorization = null;
            using HttpResponseMessage passwordPeerLoginResponse = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new LoginCommand(
                    "auth-a@example.test",
                    "A secure PokeFolio password 1!",
                    "Password Peer",
                    "windows"));
            Assert.AreEqual(HttpStatusCode.OK, passwordPeerLoginResponse.StatusCode);
            AuthSessionResponse? passwordPeer = await passwordPeerLoginResponse.Content
                .ReadFromJsonAsync<AuthSessionResponse>();
            Assert.IsNotNull(passwordPeer);

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", relogged.AccessToken);
            using (HttpResponseMessage invalidCurrentPassword = await client.PostAsJsonAsync(
                       "/api/v1/auth/password/change",
                       new ChangePasswordCommand(
                           "Wrong password 1!",
                           "A newer PokeFolio password 2!")))
            {
                Assert.AreEqual(HttpStatusCode.BadRequest, invalidCurrentPassword.StatusCode);
            }

            using (HttpResponseMessage passwordChanged = await client.PostAsJsonAsync(
                       "/api/v1/auth/password/change",
                       new ChangePasswordCommand(
                           "A secure PokeFolio password 1!",
                           "A newer PokeFolio password 2!")))
            {
                Assert.AreEqual(HttpStatusCode.NoContent, passwordChanged.StatusCode);
            }

            using (HttpResponseMessage currentStillActive = await client.GetAsync("/api/v1/devices"))
            {
                Assert.AreEqual(HttpStatusCode.OK, currentStillActive.StatusCode);
            }

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", passwordPeer.AccessToken);
            using (HttpResponseMessage passwordPeerRevoked = await client.GetAsync("/api/v1/devices"))
            {
                Assert.AreEqual(HttpStatusCode.Unauthorized, passwordPeerRevoked.StatusCode);
            }

            client.DefaultRequestHeaders.Authorization = null;
            using HttpResponseMessage newPasswordLogin = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new LoginCommand(
                    "auth-a@example.test",
                    "A newer PokeFolio password 2!",
                    "Password Changed Device",
                    "android"));
            Assert.AreEqual(HttpStatusCode.OK, newPasswordLogin.StatusCode);

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

    [TestMethod]
    [TestCategory("PostgreSQL")]
    public async Task CollectionReadsAreStrictlyIsolatedByAuthenticatedUser()
    {
        string? serverConnectionString = Environment.GetEnvironmentVariable("POKEFOLIO_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(serverConnectionString))
        {
            Assert.Inconclusive(
                "Set POKEFOLIO_TEST_POSTGRES to run the isolated PostgreSQL collection test.");
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
            AuthSessionResponse userA = await RegisterAsync(
                client,
                "collection-a@example.test",
                "Pixel Collection");
            AuthSessionResponse userB = await RegisterAsync(
                client,
                "collection-b@example.test",
                "Windows Collection");

            Guid userAId;
            Guid userBId;
            Guid[] cardIds = [Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()];
            Guid[] userAHoldingIds = [Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()];
            Guid userBHoldingId = Guid.NewGuid();
            DateTimeOffset now = DateTimeOffset.UtcNow;
            await using (PokeFolioDbContext seed = CreateContext(testConnectionString, null))
            {
                userAId = await seed.Users
                    .Where(user => user.Email == "collection-a@example.test")
                    .Select(user => user.Id)
                    .SingleAsync();
                userBId = await seed.Users
                    .Where(user => user.Email == "collection-b@example.test")
                    .Select(user => user.Id)
                    .SingleAsync();
                seed.Cards.AddRange(cardIds.Select((cardId, index) => new CatalogCard
                {
                    Id = cardId,
                    Tcg = "pokemon",
                    Provider = "integration-test",
                    ProviderCardId = $"collection-card-{index}",
                    Name = $"Collection Test Card {index}",
                    SetCode = "TEST",
                    Number = (index + 1).ToString(CultureInfo.InvariantCulture),
                    CreatedAt = now,
                    UpdatedAt = now
                }));
                seed.CollectionHoldings.AddRange(
                    CreateHolding(userAHoldingIds[0], userAId, cardIds[0], now),
                    CreateHolding(userAHoldingIds[1], userAId, cardIds[1], now),
                    CreateHolding(userAHoldingIds[2], userAId, cardIds[2], now),
                    CreateHolding(userBHoldingId, userBId, cardIds[3], now));
                await seed.SaveChangesAsync();
            }

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", userA.AccessToken);
            using HttpResponseMessage firstPageResponse = await client.GetAsync(
                "/api/v1/collection?limit=2");
            Assert.AreEqual(HttpStatusCode.OK, firstPageResponse.StatusCode);
            CollectionPageResponse? firstPage = await firstPageResponse.Content
                .ReadFromJsonAsync<CollectionPageResponse>();
            Assert.IsNotNull(firstPage);
            Assert.HasCount(2, firstPage.Items);
            Assert.IsNotNull(firstPage.NextCursor);

            using HttpResponseMessage secondPageResponse = await client.GetAsync(
                $"/api/v1/collection?limit=2&cursor={firstPage.NextCursor}");
            Assert.AreEqual(HttpStatusCode.OK, secondPageResponse.StatusCode);
            CollectionPageResponse? secondPage = await secondPageResponse.Content
                .ReadFromJsonAsync<CollectionPageResponse>();
            Assert.IsNotNull(secondPage);
            Assert.HasCount(1, secondPage.Items);
            Assert.IsNull(secondPage.NextCursor);
            CollectionAssert.AreEquivalent(
                userAHoldingIds,
                firstPage.Items.Concat(secondPage.Items).Select(item => item.Id).ToArray());

            using (HttpResponseMessage invalidCursor = await client.GetAsync(
                       "/api/v1/collection?cursor=not-a-valid-cursor"))
            {
                Assert.AreEqual(HttpStatusCode.BadRequest, invalidCursor.StatusCode);
            }

            using (HttpResponseMessage owned = await client.GetAsync(
                       $"/api/v1/collection/{userAHoldingIds[0]}"))
            {
                Assert.AreEqual(HttpStatusCode.OK, owned.StatusCode);
                Assert.AreEqual("\"v1\"", owned.Headers.ETag?.Tag);
            }

            using (HttpResponseMessage crossUser = await client.GetAsync(
                       $"/api/v1/collection/{userBHoldingId}"))
            {
                Assert.AreEqual(HttpStatusCode.NotFound, crossUser.StatusCode);
                Assert.AreEqual(
                    "application/problem+json",
                    crossUser.Content.Headers.ContentType?.MediaType);
                using JsonDocument problem = await JsonDocument.ParseAsync(
                    await crossUser.Content.ReadAsStreamAsync());
                Assert.IsTrue(problem.RootElement.TryGetProperty("correlationId", out _));
            }

            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", userB.AccessToken);
            using HttpResponseMessage manipulated = await client.GetAsync(
                $"/api/v1/collection?user_id={userAId}");
            Assert.AreEqual(HttpStatusCode.OK, manipulated.StatusCode);
            CollectionPageResponse? userBPage = await manipulated.Content
                .ReadFromJsonAsync<CollectionPageResponse>();
            Assert.IsNotNull(userBPage);
            Assert.HasCount(1, userBPage.Items);
            Assert.AreEqual(userBHoldingId, userBPage.Items[0].Id);
        }
        finally
        {
            await DropDatabaseAsync(serverConnectionString, databaseName);
        }
    }

    [TestMethod]
    [TestCategory("PostgreSQL")]
    public async Task CollectionWritesAreAtomicIdempotentAndUserScoped()
    {
        string? serverConnectionString = Environment.GetEnvironmentVariable("POKEFOLIO_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(serverConnectionString))
        {
            Assert.Inconclusive(
                "Set POKEFOLIO_TEST_POSTGRES to run the PostgreSQL collection write test.");
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
            using HttpClient android = factory.CreateClient();
            using HttpClient windows = factory.CreateClient();
            using HttpClient otherUser = factory.CreateClient();
            AuthSessionResponse androidSession = await RegisterAsync(
                android,
                "writes-a@example.test",
                "Pixel Writer");

            using HttpResponseMessage windowsLoginResponse = await windows.PostAsJsonAsync(
                "/api/v1/auth/login",
                new LoginCommand(
                    "writes-a@example.test",
                    "A secure PokeFolio password 1!",
                    "Windows Writer",
                    "windows"));
            Assert.AreEqual(HttpStatusCode.OK, windowsLoginResponse.StatusCode);
            AuthSessionResponse? windowsSession = await windowsLoginResponse.Content
                .ReadFromJsonAsync<AuthSessionResponse>();
            Assert.IsNotNull(windowsSession);
            AuthSessionResponse otherSession = await RegisterAsync(
                otherUser,
                "writes-b@example.test",
                "Other Pixel");

            android.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", androidSession.AccessToken);
            windows.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", windowsSession.AccessToken);
            otherUser.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", otherSession.AccessToken);

            Guid cardId = Guid.NewGuid();
            Guid holdingId = Guid.NewGuid();
            Guid userAId;
            DateTimeOffset now = DateTimeOffset.UtcNow;
            await using (PokeFolioDbContext seed = CreateContext(testConnectionString, null))
            {
                userAId = await seed.Users
                    .Where(user => user.Email == "writes-a@example.test")
                    .Select(user => user.Id)
                    .SingleAsync();
                seed.Cards.Add(new CatalogCard
                {
                    Id = cardId,
                    Tcg = "pokemon",
                    Provider = "integration-test",
                    ProviderCardId = "write-card",
                    Name = "Write Test Card",
                    SetCode = "TEST",
                    Number = "1",
                    CreatedAt = now,
                    UpdatedAt = now
                });
                await seed.SaveChangesAsync();
            }

            Guid createOperationId = Guid.NewGuid();
            var createCommand = new CreateHoldingCommand(
                holdingId,
                cardId,
                null,
                "de",
                "normal",
                "near-mint",
                1,
                "Created offline");
            using (HttpResponseMessage created = await PostWithIdempotencyAsync(
                       android,
                       "/api/v1/collection",
                       createOperationId,
                       createCommand))
            {
                Assert.AreEqual(HttpStatusCode.Created, created.StatusCode);
                Assert.AreEqual("\"v1\"", created.Headers.ETag?.Tag);
            }
            using (HttpResponseMessage replayedCreate = await PostWithIdempotencyAsync(
                       android,
                       "/api/v1/collection",
                       createOperationId,
                       createCommand))
            {
                Assert.AreEqual(HttpStatusCode.Created, replayedCreate.StatusCode);
            }

            Guid androidDeltaId = Guid.NewGuid();
            Guid windowsDeltaId = Guid.NewGuid();
            Task<HttpResponseMessage> androidDelta = PostWithIdempotencyAsync(
                android,
                $"/api/v1/collection/{holdingId}/quantity-delta",
                androidDeltaId,
                new QuantityDeltaCommand(androidDeltaId, 1));
            Task<HttpResponseMessage> windowsDelta = PostWithIdempotencyAsync(
                windows,
                $"/api/v1/collection/{holdingId}/quantity-delta",
                windowsDeltaId,
                new QuantityDeltaCommand(windowsDeltaId, 1));
            HttpResponseMessage[] deltaResponses = await Task.WhenAll(androidDelta, windowsDelta);
            foreach (HttpResponseMessage response in deltaResponses)
            {
                using (response)
                {
                    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
                }
            }

            Guid sharedOperationId = Guid.NewGuid();
            Task<HttpResponseMessage> firstShared = PostWithIdempotencyAsync(
                android,
                $"/api/v1/collection/{holdingId}/quantity-delta",
                sharedOperationId,
                new QuantityDeltaCommand(sharedOperationId, 1));
            Task<HttpResponseMessage> secondShared = PostWithIdempotencyAsync(
                windows,
                $"/api/v1/collection/{holdingId}/quantity-delta",
                sharedOperationId,
                new QuantityDeltaCommand(sharedOperationId, 1));
            HttpResponseMessage[] sharedResponses = await Task.WhenAll(firstShared, secondShared);
            foreach (HttpResponseMessage response in sharedResponses)
            {
                using (response)
                {
                    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
                }
            }

            using (HttpResponseMessage finalResponse = await android.GetAsync(
                       $"/api/v1/collection/{holdingId}"))
            {
                Assert.AreEqual(HttpStatusCode.OK, finalResponse.StatusCode);
                CollectionHoldingResponse? final = await finalResponse.Content
                    .ReadFromJsonAsync<CollectionHoldingResponse>();
                Assert.IsNotNull(final);
                Assert.AreEqual(4, final.Quantity);
                Assert.AreEqual(4L, final.Version);
                Assert.AreEqual("\"v4\"", finalResponse.Headers.ETag?.Tag);
            }

            using (HttpResponseMessage replayedDelta = await PostWithIdempotencyAsync(
                       android,
                       $"/api/v1/collection/{holdingId}/quantity-delta",
                       androidDeltaId,
                       new QuantityDeltaCommand(androidDeltaId, 1)))
            {
                Assert.AreEqual(HttpStatusCode.OK, replayedDelta.StatusCode);
            }

            using (HttpResponseMessage changedReplay = await PostWithIdempotencyAsync(
                       android,
                       $"/api/v1/collection/{holdingId}/quantity-delta",
                       androidDeltaId,
                       new QuantityDeltaCommand(androidDeltaId, -1)))
            {
                Assert.AreEqual(HttpStatusCode.Conflict, changedReplay.StatusCode);
            }

            Guid legacyOperationId = Guid.NewGuid();
            await using (PokeFolioDbContext legacyOperationContext =
                CreateContext(testConnectionString, userAId))
            {
                legacyOperationContext.ProcessedSyncOperations.Add(new ProcessedSyncOperation
                {
                    UserId = userAId,
                    DeviceSessionId = androidSession.Device.Id,
                    OperationId = legacyOperationId,
                    Status = "applied",
                    ProcessedAt = now
                });
                await legacyOperationContext.SaveChangesAsync();
            }
            using (HttpResponseMessage legacyKeyReuse = await PostWithIdempotencyAsync(
                       android,
                       $"/api/v1/collection/{holdingId}/quantity-delta",
                       legacyOperationId,
                       new QuantityDeltaCommand(legacyOperationId, 1)))
            {
                Assert.AreEqual(HttpStatusCode.Conflict, legacyKeyReuse.StatusCode);
            }

            Guid updateOperationId = Guid.NewGuid();
            using (HttpResponseMessage updated = await PatchWithPreconditionsAsync(
                       windows,
                       $"/api/v1/collection/{holdingId}",
                       updateOperationId,
                       "\"v4\"",
                       """{"condition":"excellent","notes":"Updated on Windows"}"""))
            {
                Assert.AreEqual(HttpStatusCode.OK, updated.StatusCode);
                Assert.AreEqual("\"v5\"", updated.Headers.ETag?.Tag);
                CollectionHoldingResponse? body = await updated.Content
                    .ReadFromJsonAsync<CollectionHoldingResponse>();
                Assert.IsNotNull(body);
                Assert.AreEqual("excellent", body.Condition);
                Assert.AreEqual("Updated on Windows", body.Notes);
                Assert.AreEqual(4, body.Quantity);
            }
            using (HttpResponseMessage replayedUpdate = await PatchWithPreconditionsAsync(
                       android,
                       $"/api/v1/collection/{holdingId}",
                       updateOperationId,
                       "\"v4\"",
                       """{"condition":"excellent","notes":"Updated on Windows"}"""))
            {
                Assert.AreEqual(HttpStatusCode.OK, replayedUpdate.StatusCode);
                Assert.AreEqual("\"v5\"", replayedUpdate.Headers.ETag?.Tag);
            }
            using (HttpResponseMessage changedUpdateReplay = await PatchWithPreconditionsAsync(
                       android,
                       $"/api/v1/collection/{holdingId}",
                       updateOperationId,
                       "\"v4\"",
                       """{"condition":"excellent","notes":"Changed retry"}"""))
            {
                Assert.AreEqual(HttpStatusCode.Conflict, changedUpdateReplay.StatusCode);
            }

            using (HttpResponseMessage staleUpdate = await PatchWithPreconditionsAsync(
                       android,
                       $"/api/v1/collection/{holdingId}",
                       Guid.NewGuid(),
                       "\"v4\"",
                       """{"notes":"stale offline edit"}"""))
            {
                Assert.AreEqual(HttpStatusCode.PreconditionFailed, staleUpdate.StatusCode);
            }

            Guid clearNotesOperationId = Guid.NewGuid();
            using (HttpResponseMessage cleared = await PatchWithPreconditionsAsync(
                       android,
                       $"/api/v1/collection/{holdingId}",
                       clearNotesOperationId,
                       "\"v5\"",
                       """{"notes":null}"""))
            {
                Assert.AreEqual(HttpStatusCode.OK, cleared.StatusCode);
                Assert.AreEqual("\"v6\"", cleared.Headers.ETag?.Tag);
                CollectionHoldingResponse? body = await cleared.Content
                    .ReadFromJsonAsync<CollectionHoldingResponse>();
                Assert.IsNotNull(body);
                Assert.IsNull(body.Notes);
            }

            using (HttpResponseMessage invalidIfMatch = await PatchWithPreconditionsAsync(
                       android,
                       $"/api/v1/collection/{holdingId}",
                       Guid.NewGuid(),
                       "W/\"v6\"",
                       """{"notes":"must not apply"}"""))
            {
                Assert.AreEqual(HttpStatusCode.BadRequest, invalidIfMatch.StatusCode);
            }

            using (HttpResponseMessage crossUserUpdate = await PatchWithPreconditionsAsync(
                       otherUser,
                       $"/api/v1/collection/{holdingId}",
                       Guid.NewGuid(),
                       "\"v6\"",
                       """{"notes":"foreign edit"}"""))
            {
                Assert.AreEqual(HttpStatusCode.NotFound, crossUserUpdate.StatusCode);
            }

            using (HttpResponseMessage staleDelete = await DeleteWithPreconditionsAsync(
                       windows,
                       $"/api/v1/collection/{holdingId}",
                       Guid.NewGuid(),
                       "\"v5\""))
            {
                Assert.AreEqual(HttpStatusCode.PreconditionFailed, staleDelete.StatusCode);
            }

            Guid deleteOperationId = Guid.NewGuid();
            using (HttpResponseMessage deleted = await DeleteWithPreconditionsAsync(
                       windows,
                       $"/api/v1/collection/{holdingId}",
                       deleteOperationId,
                       "\"v6\""))
            {
                Assert.AreEqual(HttpStatusCode.NoContent, deleted.StatusCode);
            }
            using (HttpResponseMessage replayedDelete = await DeleteWithPreconditionsAsync(
                       android,
                       $"/api/v1/collection/{holdingId}",
                       deleteOperationId,
                       "\"v6\""))
            {
                Assert.AreEqual(HttpStatusCode.NoContent, replayedDelete.StatusCode);
            }
            using (HttpResponseMessage deletedRead = await android.GetAsync(
                       $"/api/v1/collection/{holdingId}"))
            {
                Assert.AreEqual(HttpStatusCode.NotFound, deletedRead.StatusCode);
            }

            using (HttpResponseMessage reusedDeletedId = await PostWithIdempotencyAsync(
                       android,
                       "/api/v1/collection",
                       Guid.NewGuid(),
                       createCommand))
            {
                Assert.AreEqual(HttpStatusCode.Conflict, reusedDeletedId.StatusCode);
            }

            Guid replacementHoldingId = Guid.NewGuid();
            CreateHoldingCommand replacementCommand = createCommand with
            {
                Id = replacementHoldingId,
                Notes = "Re-added after deletion"
            };
            using (HttpResponseMessage replacement = await PostWithIdempotencyAsync(
                       android,
                       "/api/v1/collection",
                       Guid.NewGuid(),
                       replacementCommand))
            {
                Assert.AreEqual(HttpStatusCode.Created, replacement.StatusCode);
                Assert.AreEqual("\"v1\"", replacement.Headers.ETag?.Tag);
            }

            Guid foreignOperationId = Guid.NewGuid();
            using (HttpResponseMessage crossUser = await PostWithIdempotencyAsync(
                       otherUser,
                       $"/api/v1/collection/{holdingId}/quantity-delta",
                       foreignOperationId,
                       new QuantityDeltaCommand(foreignOperationId, 1)))
            {
                Assert.AreEqual(HttpStatusCode.NotFound, crossUser.StatusCode);
            }

            using (HttpResponseMessage missingIdempotency = await android.PostAsJsonAsync(
                       $"/api/v1/collection/{holdingId}/quantity-delta",
                       new QuantityDeltaCommand(Guid.NewGuid(), 1)))
            {
                Assert.AreEqual(HttpStatusCode.BadRequest, missingIdempotency.StatusCode);
            }

            var pulledChanges = new List<SyncChangeResponse>();
            string? syncCursor = null;
            bool hasMore;
            do
            {
                string requestUri = "/api/v1/sync/changes?limit=3";
                if (syncCursor is not null)
                {
                    requestUri += $"&cursor={Uri.EscapeDataString(syncCursor)}";
                }
                using HttpResponseMessage pull = await android.GetAsync(requestUri);
                Assert.AreEqual(HttpStatusCode.OK, pull.StatusCode);
                SyncChangePageResponse? page = await pull.Content
                    .ReadFromJsonAsync<SyncChangePageResponse>();
                Assert.IsNotNull(page);
                Assert.IsFalse(string.IsNullOrWhiteSpace(page.NextCursor));
                pulledChanges.AddRange(page.Changes);
                syncCursor = page.NextCursor;
                hasMore = page.HasMore;
            }
            while (hasMore);

            Assert.HasCount(8, pulledChanges);
            for (int index = 1; index < pulledChanges.Count; index++)
            {
                Assert.IsTrue(
                    pulledChanges[index].Sequence > pulledChanges[index - 1].Sequence);
            }
            Assert.AreEqual(7, pulledChanges.Count(change => change.Action == "upsert"));
            Assert.AreEqual(1, pulledChanges.Count(change => change.Action == "delete"));
            Assert.IsTrue(pulledChanges
                .Where(change => change.Action == "upsert")
                .All(change => change.Payload?.ValueKind == JsonValueKind.Object));
            SyncChangeResponse pulledDeletion = pulledChanges.Single(change =>
                change.EntityId == holdingId && change.Action == "delete");
            Assert.AreEqual(7L, pulledDeletion.Version);
            Assert.IsNull(pulledDeletion.Payload);

            using (HttpResponseMessage caughtUp = await android.GetAsync(
                       $"/api/v1/sync/changes?cursor={Uri.EscapeDataString(syncCursor!)}"))
            {
                Assert.AreEqual(HttpStatusCode.OK, caughtUp.StatusCode);
                SyncChangePageResponse? page = await caughtUp.Content
                    .ReadFromJsonAsync<SyncChangePageResponse>();
                Assert.IsNotNull(page);
                Assert.HasCount(0, page.Changes);
                Assert.IsFalse(page.HasMore);
                Assert.AreEqual(syncCursor, page.NextCursor);
            }
            using (HttpResponseMessage invalidSyncCursor = await android.GetAsync(
                       "/api/v1/sync/changes?cursor=not-a-cursor"))
            {
                Assert.AreEqual(HttpStatusCode.BadRequest, invalidSyncCursor.StatusCode);
            }
            using (HttpResponseMessage isolatedPull = await otherUser.GetAsync(
                       $"/api/v1/sync/changes?user_id={userAId}"))
            {
                Assert.AreEqual(HttpStatusCode.OK, isolatedPull.StatusCode);
                SyncChangePageResponse? page = await isolatedPull.Content
                    .ReadFromJsonAsync<SyncChangePageResponse>();
                Assert.IsNotNull(page);
                Assert.HasCount(0, page.Changes);
            }

            Guid batchHoldingId = Guid.NewGuid();
            Guid batchCreateOperationId = Guid.NewGuid();
            Guid batchDeltaOperationId = Guid.NewGuid();
            Guid batchUpdateOperationId = Guid.NewGuid();
            Guid batchStaleDeleteOperationId = Guid.NewGuid();
            Guid batchInvalidOperationId = Guid.NewGuid();
            Guid batchDeleteOperationId = Guid.NewGuid();
            var createOperation = new SyncHoldingCreateOperationCommand(
                batchCreateOperationId,
                new CreateHoldingCommand(
                    batchHoldingId,
                    cardId,
                    null,
                    "de",
                    "normal",
                    "played",
                    1,
                    "Queued offline"));
            var syncBatch = new SyncOperationBatchCommand(
                new SyncOperationCommand?[]
                {
                    createOperation,
                    createOperation,
                    new SyncQuantityDeltaOperationCommand(
                        batchCreateOperationId,
                        replacementHoldingId,
                        1),
                    new SyncQuantityDeltaOperationCommand(
                        batchDeltaOperationId,
                        replacementHoldingId,
                        2),
                    new SyncHoldingUpdateOperationCommand(
                        batchUpdateOperationId,
                        batchHoldingId,
                        1,
                        JsonSerializer.SerializeToElement(new { notes = "Synced note" })),
                    new SyncHoldingDeleteOperationCommand(
                        batchStaleDeleteOperationId,
                        batchHoldingId,
                        1),
                    new SyncQuantityDeltaOperationCommand(
                        batchInvalidOperationId,
                        replacementHoldingId,
                        0),
                    new SyncHoldingDeleteOperationCommand(
                        batchDeleteOperationId,
                        batchHoldingId,
                        2)
                });

            using (HttpResponseMessage pushed = await android.PostAsJsonAsync(
                       "/api/v1/sync/operations",
                       syncBatch))
            {
                Assert.AreEqual(HttpStatusCode.OK, pushed.StatusCode);
                SyncOperationResultBatchResponse? result = await pushed.Content
                    .ReadFromJsonAsync<SyncOperationResultBatchResponse>();
                Assert.IsNotNull(result);
                CollectionAssert.AreEqual(
                    InitialBatchStatuses,
                    result.Results.Select(item => item.Status).ToArray());
                Assert.AreEqual("idempotency_key_reused", result.Results[2].Problem?.Code);
                Assert.AreEqual("version_mismatch", result.Results[5].Problem?.Code);
                Assert.AreEqual("validation_failed", result.Results[6].Problem?.Code);
                Assert.IsFalse(string.IsNullOrWhiteSpace(
                    result.Results[6].Problem?.CorrelationId));
            }
            using (HttpResponseMessage retried = await windows.PostAsJsonAsync(
                       "/api/v1/sync/operations",
                       syncBatch))
            {
                Assert.AreEqual(HttpStatusCode.OK, retried.StatusCode);
                SyncOperationResultBatchResponse? result = await retried.Content
                    .ReadFromJsonAsync<SyncOperationResultBatchResponse>();
                Assert.IsNotNull(result);
                CollectionAssert.AreEqual(
                    RetryBatchStatuses,
                    result.Results.Select(item => item.Status).ToArray());
                Assert.AreEqual("holding_not_found", result.Results[5].Problem?.Code);
            }

            using (HttpResponseMessage foreignBatch = await otherUser.PostAsJsonAsync(
                       "/api/v1/sync/operations",
                       new SyncOperationBatchCommand(
                           new SyncOperationCommand?[]
                           {
                               new SyncQuantityDeltaOperationCommand(
                                   Guid.NewGuid(),
                                   replacementHoldingId,
                                   1)
                           })))
            {
                Assert.AreEqual(HttpStatusCode.OK, foreignBatch.StatusCode);
                SyncOperationResultBatchResponse? result = await foreignBatch.Content
                    .ReadFromJsonAsync<SyncOperationResultBatchResponse>();
                Assert.IsNotNull(result);
                Assert.AreEqual("rejected", result.Results[0].Status);
                Assert.AreEqual("holding_not_found", result.Results[0].Problem?.Code);
            }

            using (HttpResponseMessage malformedBatch = await android.PostAsync(
                       "/api/v1/sync/operations",
                       new StringContent(
                           """{"operations":[{"operationId":"10000000-0000-0000-0000-000000000001","kind":"holding.rename"}]}""",
                           Encoding.UTF8,
                           "application/json")))
            {
                Assert.AreEqual(HttpStatusCode.BadRequest, malformedBatch.StatusCode);
            }

            using (HttpResponseMessage batchChanges = await android.GetAsync(
                       $"/api/v1/sync/changes?cursor={Uri.EscapeDataString(syncCursor!)}"))
            {
                Assert.AreEqual(HttpStatusCode.OK, batchChanges.StatusCode);
                SyncChangePageResponse? page = await batchChanges.Content
                    .ReadFromJsonAsync<SyncChangePageResponse>();
                Assert.IsNotNull(page);
                Assert.HasCount(4, page.Changes);
                Assert.IsFalse(page.HasMore);
            }

            await using PokeFolioDbContext verify = CreateContext(testConnectionString, userAId);
            CollectionHolding[] visibleHoldings = await verify.CollectionHoldings
                .AsNoTracking()
                .ToArrayAsync();
            Assert.HasCount(1, visibleHoldings);
            Assert.AreEqual(replacementHoldingId, visibleHoldings[0].Id);
            Assert.AreEqual(3, visibleHoldings[0].Quantity);

            CollectionHolding tombstone = await verify.CollectionHoldings
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleAsync(holding => holding.UserId == userAId && holding.Id == holdingId);
            Assert.AreEqual(7L, tombstone.Version);
            Assert.IsNotNull(tombstone.DeletedAt);

            Assert.AreEqual(13, await verify.ProcessedSyncOperations.CountAsync());
            Assert.AreEqual(12, await verify.ProcessedSyncOperations
                .CountAsync(operation => operation.Status == "succeeded"));
            Assert.AreEqual(12, await verify.UserChanges.CountAsync());
            Assert.AreEqual(0, await verify.UserChanges.CountAsync(change =>
                change.Action != "upsert" && change.Action != "delete"));
            UserChange deletion = await verify.UserChanges
                .Where(change => change.EntityId == holdingId && change.Action == "delete")
                .SingleAsync();
            Assert.AreEqual(7L, deletion.Version);
            Assert.IsNull(deletion.PayloadJson);
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

    private static async Task<HttpResponseMessage> PostWithIdempotencyAsync<TCommand>(
        HttpClient client,
        string requestUri,
        Guid operationId,
        TCommand command)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
        {
            Content = JsonContent.Create(command)
        };
        request.Headers.Add("Idempotency-Key", operationId.ToString("D"));
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> PatchWithPreconditionsAsync(
        HttpClient client,
        string requestUri,
        Guid operationId,
        string ifMatch,
        string mergePatch)
    {
        using var request = new HttpRequestMessage(HttpMethod.Patch, requestUri)
        {
            Content = new StringContent(
                mergePatch,
                Encoding.UTF8,
                "application/merge-patch+json")
        };
        request.Headers.Add("Idempotency-Key", operationId.ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> DeleteWithPreconditionsAsync(
        HttpClient client,
        string requestUri,
        Guid operationId,
        string ifMatch)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, requestUri);
        request.Headers.Add("Idempotency-Key", operationId.ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return await client.SendAsync(request);
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
