using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Backend;
using PokeFolio.Desktop.Bridge;
using PokeFolio.Desktop.Capture;
using PokeFolio.Desktop.Recognition;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class PokeNativeBridgeTests
{
    [TestMethod]
    public async Task RecognitionBridgeReturnsNativeCompatibleStructuredResult()
    {
        var context = CreateContext();
        await using var disposable = context;
        context.Bridge.recognizeCardProfiled(SyntheticCard.DataUrl(), "ocr-1", "de", "pokemon");
        var callback = await context.Callbacks.NextAsync();
        Assert.AreEqual("onNativeOcrResult", callback.Name);
        using var json = JsonDocument.Parse(callback.Json);
        Assert.IsTrue(json.RootElement.GetProperty("ok").GetBoolean());
        Assert.AreEqual("windows", json.RootElement.GetProperty("platform").GetString());
        Assert.AreEqual("050/195", json.RootElement.GetProperty("identifier")
            .GetProperty("collectorNumber").GetString());
    }

    [TestMethod]
    public async Task PreparedImageBridgeReturnsRealNormalizedCropMetadata()
    {
        var context = CreateContext();
        await using var disposable = context;
        context.Bridge.prepareCardImage(SyntheticCard.DataUrl(), "prepare-1");
        var callback = await context.Callbacks.NextAsync();
        Assert.AreEqual("onNativePreparedCard", callback.Name);
        using var json = JsonDocument.Parse(callback.Json);
        Assert.IsTrue(json.RootElement.GetProperty("ok").GetBoolean());
        Assert.AreEqual(CardPerspectiveCorrector.NormalizedWidth,
            json.RootElement.GetProperty("width").GetInt32());
        Assert.IsTrue(json.RootElement.GetProperty("fourCornersDetected").GetBoolean());
        StringAssert.StartsWith(json.RootElement.GetProperty("dataUrl").GetString()!,
            "data:image/jpeg;base64,");
    }

    [TestMethod]
    public async Task VisualBridgeReturnsCompatibleRegionalScores()
    {
        var context = CreateContext();
        await using var disposable = context;
        context.Bridge.comparePreparedCardImage(SyntheticCard.DataUrl(),
            "data:image/jpeg;base64,ignored", "visual-1", true, "test");
        var callback = await context.Callbacks.NextAsync();
        Assert.AreEqual("onNativeVisualResult", callback.Name);
        using var json = JsonDocument.Parse(callback.Json);
        Assert.IsTrue(json.RootElement.GetProperty("ok").GetBoolean());
        Assert.AreEqual(.91, json.RootElement.GetProperty("similarity").GetDouble(), .001);
    }

    [TestMethod]
    public async Task AccountLoginCallbackContainsStatusButNeverCredentialsOrTokens()
    {
        Guid deviceId = Guid.NewGuid();
        var account = new FakeCloudService(deviceId);
        var context = CreateContext(account);
        await using var disposable = context;

        context.Bridge.loginAccount(
            "owner@example.test",
            "never-return-this-password",
            "Desktop test",
            "account-1");

        var callback = await context.Callbacks.NextAsync();
        Assert.AreEqual("onDesktopAccountResult", callback.Name);
        Assert.IsFalse(callback.Json.Contains("never-return-this-password", StringComparison.Ordinal));
        Assert.IsFalse(callback.Json.Contains("access-token", StringComparison.Ordinal));
        Assert.IsFalse(callback.Json.Contains("refresh-token", StringComparison.Ordinal));
        using var json = JsonDocument.Parse(callback.Json);
        Assert.IsTrue(json.RootElement.GetProperty("ok").GetBoolean());
        Assert.IsTrue(json.RootElement.GetProperty("status")
            .GetProperty("authenticated").GetBoolean());
        Assert.AreEqual(
            deviceId,
            json.RootElement.GetProperty("status")
                .GetProperty("session")
                .GetProperty("device")
                .GetProperty("id")
                .GetGuid());
        Assert.AreEqual(
            FakeCloudService.UserId,
            json.RootElement.GetProperty("status")
                .GetProperty("session")
                .GetProperty("userId")
                .GetGuid());
        Assert.AreEqual("owner@example.test", account.LoginEmail);
    }

    [TestMethod]
    public async Task AccountStatusIsTokenFreeWhenBackendIsNotConfigured()
    {
        var context = CreateContext();
        await using var disposable = context;

        string status = context.Bridge.getAccountStatus();

        using var json = JsonDocument.Parse(status);
        Assert.IsFalse(json.RootElement.GetProperty("configured").GetBoolean());
        Assert.IsFalse(json.RootElement.GetProperty("authenticated").GetBoolean());
        Assert.IsFalse(status.Contains("Token", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public async Task StartingEosLiveViewKeepsAccountBridgeAvailable()
    {
        var context = CreateContext();
        await using var disposable = context;

        context.Bridge.startEosLiveView("live-account-regression");
        Callback callback = await context.Callbacks.NextAsync();

        Assert.AreEqual("onDesktopEosLiveStatus", callback.Name);
        string accountStatus = context.Bridge.getAccountStatus();
        using var json = JsonDocument.Parse(accountStatus);
        Assert.IsFalse(json.RootElement.GetProperty("configured").GetBoolean());
        context.Bridge.stopEosLiveView("live-account-stop");
    }

    [TestMethod]
    public async Task SyncPushCallbackReturnsStructuredDataWithoutCredentials()
    {
        var cloud = new FakeCloudService(Guid.NewGuid());
        var context = CreateContext(cloud);
        await using var disposable = context;
        const string batch =
            "{\"operations\":[{\"operationId\":\"10000000-0000-0000-0000-000000000001\",\"kind\":\"holding.quantityDelta\",\"holdingId\":\"20000000-0000-0000-0000-000000000001\",\"delta\":1}]}";

        context.Bridge.pushSyncOperations(batch, "sync-push-1");

        Callback callback = await context.Callbacks.NextAsync();
        Assert.AreEqual("onDesktopSyncResult", callback.Name);
        Assert.AreEqual(batch, cloud.LastPushJson);
        Assert.IsFalse(callback.Json.Contains("access-token", StringComparison.Ordinal));
        Assert.IsFalse(callback.Json.Contains("refresh-token", StringComparison.Ordinal));
        using var json = JsonDocument.Parse(callback.Json);
        Assert.IsTrue(json.RootElement.GetProperty("ok").GetBoolean());
        Assert.AreEqual("push", json.RootElement.GetProperty("operation").GetString());
        Assert.AreEqual(200, json.RootElement.GetProperty("status").GetInt32());
        Assert.AreEqual("applied", json.RootElement.GetProperty("data")
            .GetProperty("results")[0]
            .GetProperty("status")
            .GetString());
    }

    [TestMethod]
    public async Task SyncPullForwardsCursorAndLimitToSharedCloudSession()
    {
        var cloud = new FakeCloudService(Guid.NewGuid());
        var context = CreateContext(cloud);
        await using var disposable = context;

        context.Bridge.pullSyncChanges("opaque-cursor", 250, "sync-pull-1");

        Callback callback = await context.Callbacks.NextAsync();
        Assert.AreEqual("onDesktopSyncResult", callback.Name);
        Assert.AreEqual("opaque-cursor", cloud.LastCursor);
        Assert.AreEqual(250, cloud.LastLimit);
        using var json = JsonDocument.Parse(callback.Json);
        Assert.IsTrue(json.RootElement.GetProperty("ok").GetBoolean());
        Assert.AreEqual("pull", json.RootElement.GetProperty("operation").GetString());
        Assert.AreEqual("next-cursor", json.RootElement.GetProperty("data")
            .GetProperty("nextCursor")
            .GetString());
    }

    [TestMethod]
    public async Task InvalidSuccessfulSyncResponseFailsClosed()
    {
        var cloud = new FakeCloudService(Guid.NewGuid())
        {
            PushResponse = new PokeFolioApiResponse(200, "not-json")
        };
        var context = CreateContext(cloud);
        await using var disposable = context;

        context.Bridge.pushSyncOperations("{\"operations\":[]}", "sync-invalid-1");

        Callback callback = await context.Callbacks.NextAsync();
        using var json = JsonDocument.Parse(callback.Json);
        Assert.IsFalse(json.RootElement.GetProperty("ok").GetBoolean());
        Assert.AreEqual(0, json.RootElement.GetProperty("status").GetInt32());
        Assert.AreEqual("invalid-response", json.RootElement.GetProperty("errorType").GetString());
        Assert.AreEqual(JsonValueKind.Null, json.RootElement.GetProperty("data").ValueKind);
    }

    [TestMethod]
    public async Task CatalogBridgeReturnsValidatedTokenFreeResolutionAndLookup()
    {
        var cloud = new FakeCloudService(Guid.NewGuid());
        var context = CreateContext(cloud);
        await using var disposable = context;
        const string reference =
            "{\"provider\":\"tcgdex\",\"providerCardId\":\"sv8-141\",\"tcg\":\"pokemon\",\"name\":\"Pikachu ex\",\"setCode\":\"SV8\",\"number\":\"219/191\"}";

        context.Bridge.resolveCatalogCard(reference, "catalog-resolve-1");

        Callback resolved = await context.Callbacks.NextAsync();
        Assert.AreEqual("onDesktopCatalogResult", resolved.Name);
        Assert.AreEqual(reference, cloud.LastCatalogReferenceJson);
        Assert.IsFalse(resolved.Json.Contains("access-token", StringComparison.Ordinal));
        Assert.IsFalse(resolved.Json.Contains("refresh-token", StringComparison.Ordinal));
        using (JsonDocument json = JsonDocument.Parse(resolved.Json))
        {
            Assert.IsTrue(json.RootElement.GetProperty("ok").GetBoolean());
            Assert.AreEqual("resolve", json.RootElement.GetProperty("operation").GetString());
            Assert.AreEqual(FakeCloudService.CatalogCardId, json.RootElement
                .GetProperty("data")
                .GetProperty("card")
                .GetProperty("id")
                .GetGuid());
        }

        context.Bridge.getCatalogCard(
            FakeCloudService.CatalogCardId.ToString("D"),
            "catalog-get-1");

        Callback loaded = await context.Callbacks.NextAsync();
        Assert.AreEqual("onDesktopCatalogResult", loaded.Name);
        Assert.AreEqual(FakeCloudService.CatalogCardId, cloud.LastCatalogCardId);
        using JsonDocument loadedJson = JsonDocument.Parse(loaded.Json);
        Assert.IsTrue(loadedJson.RootElement.GetProperty("ok").GetBoolean());
        Assert.AreEqual("get", loadedJson.RootElement.GetProperty("operation").GetString());
        Assert.AreEqual("Pikachu ex", loadedJson.RootElement
            .GetProperty("data")
            .GetProperty("name")
            .GetString());
    }

    [TestMethod]
    public async Task CatalogBridgeFailsClosedForInvalidIdOrSuccessfulResponseShape()
    {
        var cloud = new FakeCloudService(Guid.NewGuid())
        {
            ResolveResponse = new PokeFolioApiResponse(
                201,
                FakeCloudService.CatalogResolutionBody(created: false))
        };
        var context = CreateContext(cloud);
        await using var disposable = context;

        context.Bridge.getCatalogCard("not-a-uuid", "catalog-invalid-id");
        Callback invalidId = await context.Callbacks.NextAsync();
        using (JsonDocument json = JsonDocument.Parse(invalidId.Json))
        {
            Assert.IsFalse(json.RootElement.GetProperty("ok").GetBoolean());
            Assert.AreEqual("validation", json.RootElement.GetProperty("errorType").GetString());
        }
        Assert.IsNull(cloud.LastCatalogCardId);

        context.Bridge.resolveCatalogCard("{}", "catalog-invalid-response");
        Callback invalidResponse = await context.Callbacks.NextAsync();
        using JsonDocument responseJson = JsonDocument.Parse(invalidResponse.Json);
        Assert.IsFalse(responseJson.RootElement.GetProperty("ok").GetBoolean());
        Assert.AreEqual(
            "invalid-response",
            responseJson.RootElement.GetProperty("errorType").GetString());

        string validResolution = FakeCloudService.CatalogResolutionBody(created: true);
        cloud.ResolveResponse = new PokeFolioApiResponse(
            201,
            validResolution[..^1] + ",\"accessToken\":\"must-not-leak\"}");
        context.Bridge.resolveCatalogCard("{}", "catalog-extra-field");
        Callback extraField = await context.Callbacks.NextAsync();
        Assert.IsFalse(extraField.Json.Contains("must-not-leak", StringComparison.Ordinal));
        using JsonDocument extraFieldJson = JsonDocument.Parse(extraField.Json);
        Assert.IsFalse(extraFieldJson.RootElement.GetProperty("ok").GetBoolean());
        Assert.AreEqual(
            "invalid-response",
            extraFieldJson.RootElement.GetProperty("errorType").GetString());
    }

    [TestMethod]
    public async Task BridgeOwnsAndDisposesSharedCloudSessionExactlyOnce()
    {
        var cloud = new FakeCloudService(Guid.NewGuid());
        var context = CreateContext(cloud);

        context.Bridge.Dispose();
        context.Bridge.Dispose();

        Assert.AreEqual(1, cloud.DisposeCount);
        await context.DisposeAsync();
        Assert.AreEqual(1, cloud.DisposeCount);
    }

    private static BridgeContext CreateContext(IPokeFolioCloudService? cloud = null)
    {
        var callbacks = new RecordingDispatcher();
        var http = new HttpBridgeService();
        var root = Path.Combine(Path.GetTempPath(), "pokefolio-bridge-test-" + Guid.NewGuid().ToString("N"));
        var fileCapture = new WindowsFileCapture(_ => Task.FromResult<string?>(null));
        var canon = new CanonEosCapture();
        var codec = new ImageDataUrlCodec();
        var vision = new WindowsVisionPipeline();
        var recognition = new FakeRecognitionService(FakeRecognitionService.ExactPokemon());
        var bridge = new PokeNativeBridge(callbacks, http, new LocalDataService(root),
            new DesktopStatusService(), fileCapture, new ICardCaptureDevice[] { fileCapture, canon },
            vision, codec, recognition, new FakeVisualComparisonService(), canon, cloud);
        return new BridgeContext(callbacks, bridge, http, canon, root);
    }

    private sealed class RecordingDispatcher : IJavaScriptCallbackDispatcher
    {
        private readonly ConcurrentQueue<Callback> queue = new();
        private readonly SemaphoreSlim signal = new(0);

        public Task SendAsync(string callbackName, object payload)
        {
            queue.Enqueue(new Callback(callbackName, JsonSerializer.Serialize(payload)));
            signal.Release();
            return Task.CompletedTask;
        }

        public async Task<Callback> NextAsync()
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await signal.WaitAsync(timeout.Token);
            Assert.IsTrue(queue.TryDequeue(out var callback));
            return callback!;
        }
    }

    private sealed record Callback(string Name, string Json);

    private sealed class FakeCloudService(Guid deviceId) : IPokeFolioCloudService
    {
        public static readonly Guid UserId =
            Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        public static readonly Guid CatalogCardId =
            Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
        private readonly PokeFolioSession session = new(
            UserId,
            new PokeFolioDevice(
                deviceId,
                "Desktop test",
                "windows",
                DateTimeOffset.Parse("2026-09-10T00:00:00Z"),
                DateTimeOffset.Parse("2026-09-10T00:00:00Z")),
            DateTimeOffset.Parse("2030-01-01T00:00:00Z"));

        public string? LoginEmail { get; private set; }
        public string? LastPushJson { get; private set; }
        public string? LastCursor { get; private set; }
        public string? LastCatalogReferenceJson { get; private set; }
        public Guid? LastCatalogCardId { get; private set; }
        public int LastLimit { get; private set; }
        public int DisposeCount { get; private set; }
        public PokeFolioApiResponse PushResponse { get; set; } = new(
            200,
            "{\"results\":[{\"operationId\":\"10000000-0000-0000-0000-000000000001\",\"status\":\"applied\",\"entity\":null,\"problem\":null}]}");
        public PokeFolioApiResponse PullResponse { get; set; } = new(
            200,
            "{\"changes\":[],\"nextCursor\":\"next-cursor\",\"hasMore\":false}");
        public PokeFolioApiResponse ResolveResponse { get; set; } = new(
            201,
            CatalogResolutionBody(created: true));
        public PokeFolioApiResponse GetCardResponse { get; set; } = new(
            200,
            CatalogCardBody());

        public PokeFolioAccountStatus GetStatus() => new(
            Configured: true,
            Authenticated: LoginEmail is not null,
            BackendOrigin: "https://api.pokefolio.example/",
            Session: LoginEmail is null ? null : session,
            ConfigurationError: null);

        public Task<PokeFolioAuthenticationResult> RegisterAsync(
            string email,
            string password,
            string deviceName,
            CancellationToken cancellationToken = default) =>
            LoginAsync(email, password, deviceName, cancellationToken);

        public Task<PokeFolioAuthenticationResult> LoginAsync(
            string email,
            string password,
            string deviceName,
            CancellationToken cancellationToken = default)
        {
            LoginEmail = email;
            return Task.FromResult(PokeFolioAuthenticationResult.Success(session));
        }

        public Task<PokeFolioAuthenticationResult> RestoreSessionAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult(PokeFolioAuthenticationResult.Success(session));

        public Task<PokeFolioLogoutResult> LogoutAsync(
            CancellationToken cancellationToken = default)
        {
            LoginEmail = null;
            return Task.FromResult(new PokeFolioLogoutResult(true));
        }

        public Task<PokeFolioApiResponse> PushSyncOperationsAsync(
            string operationBatchJson,
            CancellationToken cancellationToken = default)
        {
            LastPushJson = operationBatchJson;
            return Task.FromResult(PushResponse);
        }

        public Task<PokeFolioApiResponse> PullSyncChangesAsync(
            string? cursor = null,
            int limit = 100,
            CancellationToken cancellationToken = default)
        {
            LastCursor = cursor;
            LastLimit = limit;
            return Task.FromResult(PullResponse);
        }

        public Task<PokeFolioApiResponse> ResolveCatalogCardAsync(
            string cardReferenceJson,
            CancellationToken cancellationToken = default)
        {
            LastCatalogReferenceJson = cardReferenceJson;
            return Task.FromResult(ResolveResponse);
        }

        public Task<PokeFolioApiResponse> GetCatalogCardAsync(
            Guid cardId,
            CancellationToken cancellationToken = default)
        {
            LastCatalogCardId = cardId;
            return Task.FromResult(GetCardResponse);
        }

        public static string CatalogResolutionBody(bool created) =>
            $"{{\"card\":{CatalogCardBody()},\"created\":{created.ToString().ToLowerInvariant()},\"metadataMatched\":true}}";

        private static string CatalogCardBody() =>
            $$"""
            {"id":"{{CatalogCardId:D}}","provider":"tcgdex","providerCardId":"sv8-141","tcg":"pokemon","name":"Pikachu ex","setCode":"SV8","number":"219/191","createdAt":"2026-09-12T00:00:00+00:00","updatedAt":"2026-09-12T00:00:00+00:00"}
            """;

        public void Dispose()
        {
            DisposeCount += 1;
        }
    }

    private sealed class BridgeContext(
        RecordingDispatcher callbacks,
        PokeNativeBridge bridge,
        HttpBridgeService http,
        CanonEosCapture canon,
        string root) : IAsyncDisposable
    {
        public RecordingDispatcher Callbacks { get; } = callbacks;
        public PokeNativeBridge Bridge { get; } = bridge;

        public async ValueTask DisposeAsync()
        {
            Bridge.Dispose();
            http.Dispose();
            await canon.DisposeAsync();
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
