using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Api.Auth;
using PokeFolio.Api.Cards;
using PokeFolio.Api.Collection;
using PokeFolio.Api.Sync;
using PokeFolio.Infrastructure.Persistence;

namespace PokeFolio.Backend.Tests;

public sealed partial class PostgreSqlIsolationTests
{
    private static readonly string[] AppliedWindowsMutationStatuses = ["applied", "applied"];

    [TestMethod]
    [TestCategory("EndToEnd")]
    [TestCategory("PostgreSQL")]
    public async Task AndroidAndWindowsSynchronizeOneAccountWithoutLeakingIntoAnother()
    {
        string? serverConnectionString = Environment.GetEnvironmentVariable("POKEFOLIO_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(serverConnectionString))
        {
            Assert.Inconclusive(
                "Set POKEFOLIO_TEST_POSTGRES to run the multi-device end-to-end test.");
            return;
        }

        const int scannedCardCount = 20;
        string databaseName = $"pokefolio_test_{Guid.NewGuid():N}";
        string testConnectionString = await CreateDatabaseAsync(serverConnectionString, databaseName);

        try
        {
            await using (PokeFolioDbContext migrationContext =
                CreateContext(testConnectionString, null))
            {
                await migrationContext.Database.MigrateAsync();
            }

            using var factory = new PokeFolioApiFactory(testConnectionString);
            using HttpClient android = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false
            });
            using HttpClient windows = factory.CreateClient();
            using HttpClient userB = factory.CreateClient();

            AuthSessionResponse androidSession = await RegisterAsync(
                android,
                "e2e-user-a@example.test",
                "Android Scanner");
            using HttpResponseMessage windowsLoginResponse = await windows.PostAsJsonAsync(
                "/api/v1/auth/login",
                new LoginCommand(
                    "e2e-user-a@example.test",
                    "A secure PokeFolio password 1!",
                    "Windows Desktop",
                    "windows"));
            Assert.AreEqual(HttpStatusCode.OK, windowsLoginResponse.StatusCode);
            AuthSessionResponse? windowsSession = await windowsLoginResponse.Content
                .ReadFromJsonAsync<AuthSessionResponse>();
            Assert.IsNotNull(windowsSession);
            Assert.AreEqual(androidSession.UserId, windowsSession.UserId);
            Assert.AreNotEqual(androidSession.Device.Id, windowsSession.Device.Id);

            AuthSessionResponse userBSession = await RegisterAsync(
                userB,
                "e2e-user-b@example.test",
                "Other Android");
            Assert.AreNotEqual(androidSession.UserId, userBSession.UserId);

            android.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", androidSession.AccessToken);
            windows.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", windowsSession.AccessToken);
            userB.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", userBSession.AccessToken);

            var cards = new List<CatalogCardResponse>(scannedCardCount);
            for (int index = 1; index <= scannedCardCount; index++)
            {
                using HttpResponseMessage resolutionResponse = await android.PostAsJsonAsync(
                    "/api/v1/cards/resolve",
                    new ResolveCatalogCardCommand(
                        "tcgdex",
                        $"e2e-card-{index:D2}",
                        "pokemon",
                        $"End-to-end card {index:D2}",
                        "E2E",
                        $"{index:D3}/020"));
                Assert.AreEqual(HttpStatusCode.Created, resolutionResponse.StatusCode);
                CatalogCardResolutionResponse? resolution = await resolutionResponse.Content
                    .ReadFromJsonAsync<CatalogCardResolutionResponse>();
                Assert.IsNotNull(resolution);
                cards.Add(resolution.Card);
            }

            Guid[] holdingIds = Enumerable.Range(0, scannedCardCount)
                .Select(_ => Guid.NewGuid())
                .ToArray();
            SyncOperationCommand?[] scannedCreates = cards
                .Select((card, index) => (SyncOperationCommand?)new SyncHoldingCreateOperationCommand(
                    Guid.NewGuid(),
                    new CreateHoldingCommand(
                        holdingIds[index],
                        card.Id,
                        null,
                        "de",
                        "normal",
                        "near-mint",
                        1,
                        "Scanned on Android")))
                .ToArray();

            using (HttpResponseMessage pushedScans = await android.PostAsJsonAsync(
                       "/api/v1/sync/operations",
                       new SyncOperationBatchCommand(scannedCreates)))
            {
                Assert.AreEqual(HttpStatusCode.OK, pushedScans.StatusCode);
                SyncOperationResultBatchResponse? result = await pushedScans.Content
                    .ReadFromJsonAsync<SyncOperationResultBatchResponse>();
                Assert.IsNotNull(result);
                Assert.HasCount(scannedCardCount, result.Results);
                Assert.IsTrue(result.Results.All(item => item.Status == "applied"));
            }

            string androidCursor;
            using (HttpResponseMessage androidConfirmation = await android.GetAsync(
                       "/api/v1/sync/changes?limit=100"))
            {
                Assert.AreEqual(HttpStatusCode.OK, androidConfirmation.StatusCode);
                SyncChangePageResponse? page = await androidConfirmation.Content
                    .ReadFromJsonAsync<SyncChangePageResponse>();
                Assert.IsNotNull(page);
                Assert.HasCount(scannedCardCount, page.Changes);
                Assert.IsTrue(page.Changes.All(change =>
                    change.Action == "upsert" && change.Version == 1));
                Assert.IsFalse(page.HasMore);
                androidCursor = page.NextCursor;
            }

            using (HttpResponseMessage windowsCollectionResponse = await windows.GetAsync(
                       "/api/v1/collection?limit=100"))
            {
                Assert.AreEqual(HttpStatusCode.OK, windowsCollectionResponse.StatusCode);
                CollectionPageResponse? collection = await windowsCollectionResponse.Content
                    .ReadFromJsonAsync<CollectionPageResponse>();
                Assert.IsNotNull(collection);
                Assert.HasCount(scannedCardCount, collection.Items);
                CollectionAssert.AreEquivalent(
                    holdingIds,
                    collection.Items.Select(item => item.Id).ToArray());
                Assert.IsTrue(collection.Items.All(item => item.Quantity == 1));
            }

            Guid editedHoldingId = holdingIds[0];
            var windowsMutations = new SyncOperationBatchCommand(
                new SyncOperationCommand?[]
                {
                    new SyncHoldingUpdateOperationCommand(
                        Guid.NewGuid(),
                        editedHoldingId,
                        1,
                        JsonSerializer.SerializeToElement(new
                        {
                            condition = "excellent",
                            notes = "Checked on Windows"
                        })),
                    new SyncQuantityDeltaOperationCommand(
                        Guid.NewGuid(),
                        editedHoldingId,
                        1)
                });
            using (HttpResponseMessage windowsPush = await windows.PostAsJsonAsync(
                       "/api/v1/sync/operations",
                       windowsMutations))
            {
                Assert.AreEqual(HttpStatusCode.OK, windowsPush.StatusCode);
                SyncOperationResultBatchResponse? result = await windowsPush.Content
                    .ReadFromJsonAsync<SyncOperationResultBatchResponse>();
                Assert.IsNotNull(result);
                CollectionAssert.AreEqual(
                    AppliedWindowsMutationStatuses,
                    result.Results.Select(item => item.Status).ToArray());
                Assert.AreEqual(3L, result.Results[^1].Entity?.Version);
                Assert.AreEqual(2, result.Results[^1].Entity?.Quantity);
            }

            using (HttpResponseMessage androidRefresh = await android.GetAsync(
                       $"/api/v1/sync/changes?cursor={Uri.EscapeDataString(androidCursor)}"))
            {
                Assert.AreEqual(HttpStatusCode.OK, androidRefresh.StatusCode);
                SyncChangePageResponse? page = await androidRefresh.Content
                    .ReadFromJsonAsync<SyncChangePageResponse>();
                Assert.IsNotNull(page);
                Assert.HasCount(2, page.Changes);
                Assert.IsTrue(page.Changes.All(change => change.EntityId == editedHoldingId));
                SyncChangeResponse finalChange = page.Changes.Single(change => change.Version == 3);
                Assert.AreEqual("upsert", finalChange.Action);
                Assert.IsNotNull(finalChange.Payload);
                JsonElement payload = finalChange.Payload.Value;
                Assert.AreEqual(2, payload.GetProperty("quantity").GetInt32());
                Assert.AreEqual("excellent", payload.GetProperty("condition").GetString());
                Assert.AreEqual("Checked on Windows", payload.GetProperty("notes").GetString());
            }

            using (HttpResponseMessage androidRead = await android.GetAsync(
                       $"/api/v1/collection/{editedHoldingId}"))
            {
                Assert.AreEqual(HttpStatusCode.OK, androidRead.StatusCode);
                CollectionHoldingResponse? holding = await androidRead.Content
                    .ReadFromJsonAsync<CollectionHoldingResponse>();
                Assert.IsNotNull(holding);
                Assert.AreEqual(2, holding.Quantity);
                Assert.AreEqual("excellent", holding.Condition);
                Assert.AreEqual("Checked on Windows", holding.Notes);
                Assert.AreEqual(3L, holding.Version);
            }

            using (HttpResponseMessage userBCollectionResponse = await userB.GetAsync(
                       $"/api/v1/collection?limit=100&user_id={androidSession.UserId}"))
            {
                Assert.AreEqual(HttpStatusCode.OK, userBCollectionResponse.StatusCode);
                CollectionPageResponse? collection = await userBCollectionResponse.Content
                    .ReadFromJsonAsync<CollectionPageResponse>();
                Assert.IsNotNull(collection);
                Assert.HasCount(0, collection.Items);
            }
            using (HttpResponseMessage userBRead = await userB.GetAsync(
                       $"/api/v1/collection/{editedHoldingId}"))
            {
                Assert.AreEqual(HttpStatusCode.NotFound, userBRead.StatusCode);
            }
            using (HttpResponseMessage userBPush = await userB.PostAsJsonAsync(
                       "/api/v1/sync/operations",
                       new SyncOperationBatchCommand(
                           new SyncOperationCommand?[]
                           {
                               new SyncQuantityDeltaOperationCommand(
                                   Guid.NewGuid(),
                                   editedHoldingId,
                                   1)
                           })))
            {
                Assert.AreEqual(HttpStatusCode.OK, userBPush.StatusCode);
                SyncOperationResultBatchResponse? result = await userBPush.Content
                    .ReadFromJsonAsync<SyncOperationResultBatchResponse>();
                Assert.IsNotNull(result);
                Assert.AreEqual("rejected", result.Results.Single().Status);
                Assert.AreEqual("holding_not_found", result.Results.Single().Problem?.Code);
            }
            using (HttpResponseMessage userBChanges = await userB.GetAsync(
                       $"/api/v1/sync/changes?limit=100&user_id={androidSession.UserId}"))
            {
                Assert.AreEqual(HttpStatusCode.OK, userBChanges.StatusCode);
                SyncChangePageResponse? page = await userBChanges.Content
                    .ReadFromJsonAsync<SyncChangePageResponse>();
                Assert.IsNotNull(page);
                Assert.HasCount(0, page.Changes);
            }
        }
        finally
        {
            await DropDatabaseAsync(serverConnectionString, databaseName);
        }
    }
}
