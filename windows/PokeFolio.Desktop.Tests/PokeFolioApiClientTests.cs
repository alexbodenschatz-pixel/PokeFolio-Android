using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Backend;
using PokeFolio.Desktop.Security;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class PokeFolioApiClientTests
{
    private static readonly Guid UserId =
        Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly string FirstAccessToken = "access-" + new string('a', 64);
    private static readonly string RotatedAccessToken = "access-" + new string('b', 64);
    private static readonly string FirstRefreshToken = "refresh-" + new string('c', 64);
    private static readonly string RotatedRefreshToken = "refresh-" + new string('d', 64);

    [TestMethod]
    public void AllowsHttpsAndLoopbackDevelopmentOriginsOnly()
    {
        Assert.IsTrue(PokeFolioApiClient.IsAllowedBackendOrigin(
            new Uri("https://api.pokefolio.example/")));
        Assert.IsTrue(PokeFolioApiClient.IsAllowedBackendOrigin(
            new Uri("http://localhost:5080/")));
        Assert.IsTrue(PokeFolioApiClient.IsAllowedBackendOrigin(
            new Uri("http://127.0.0.1:5080/")));

        Assert.IsFalse(PokeFolioApiClient.IsAllowedBackendOrigin(
            new Uri("http://api.pokefolio.example/")));
        Assert.IsFalse(PokeFolioApiClient.IsAllowedBackendOrigin(
            new Uri("https://api.pokefolio.example/api/")));
        Assert.IsFalse(PokeFolioApiClient.IsAllowedBackendOrigin(
            new Uri("https://api.pokefolio.example/?target=other")));
        Assert.IsFalse(PokeFolioApiClient.IsAllowedBackendOrigin(
            new Uri("https://user:credential@api.pokefolio.example/")));
    }

    [TestMethod]
    public async Task LoginKeepsAccessTokenInMemoryAndPersistsOnlyRotatingCredential()
    {
        Guid deviceId = Guid.NewGuid();
        var store = new MemoryRefreshTokenStore();
        var handler = new RecordingHandler((request, _, _) =>
        {
            Assert.AreEqual(HttpMethod.Post, request.Method);
            Assert.AreEqual("/api/v1/auth/login", request.Uri.AbsolutePath);
            Assert.IsNull(request.AuthorizationParameter);
            using JsonDocument body = JsonDocument.Parse(request.Body);
            Assert.AreEqual("windows", body.RootElement.GetProperty("platform").GetString());
            Assert.AreEqual("Desktop test", body.RootElement.GetProperty("deviceName").GetString());
            return Task.FromResult(JsonResponse(
                HttpStatusCode.OK,
                SessionBody(deviceId, FirstAccessToken, FirstRefreshToken)));
        });
        using var client = CreateClient(store, handler);

        PokeFolioAuthenticationResult result = await client.LoginAsync(
            "owner@example.test",
            "correct horse battery staple",
            "Desktop test");

        Assert.IsTrue(result.Succeeded);
        Assert.AreEqual(UserId, result.Session?.UserId);
        Assert.AreEqual(deviceId, result.Session?.Device.Id);
        Assert.AreEqual(deviceId, client.CurrentSession?.Device.Id);
        Assert.AreEqual(new RefreshTokenCredential(deviceId, FirstRefreshToken), store.Credential);
        Assert.IsFalse(client.CurrentSession!.ToString().Contains(FirstAccessToken, StringComparison.Ordinal));
        Assert.AreEqual(1, store.SaveCount);
    }

    [TestMethod]
    public async Task RestoreRotatesStoredRefreshTokenForTheSameDevice()
    {
        Guid deviceId = Guid.NewGuid();
        var store = new MemoryRefreshTokenStore
        {
            Credential = new RefreshTokenCredential(deviceId, FirstRefreshToken)
        };
        var handler = new RecordingHandler((request, _, _) =>
        {
            Assert.AreEqual("/api/v1/auth/refresh", request.Uri.AbsolutePath);
            Assert.IsNull(request.AuthorizationParameter);
            using JsonDocument body = JsonDocument.Parse(request.Body);
            Assert.AreEqual(
                FirstRefreshToken,
                body.RootElement.GetProperty("refreshToken").GetString());
            return Task.FromResult(JsonResponse(
                HttpStatusCode.OK,
                SessionBody(deviceId, RotatedAccessToken, RotatedRefreshToken)));
        });
        using var client = CreateClient(store, handler);

        PokeFolioAuthenticationResult result = await client.RestoreSessionAsync();

        Assert.IsTrue(result.Succeeded);
        Assert.AreEqual(
            new RefreshTokenCredential(deviceId, RotatedRefreshToken),
            store.Credential);
        Assert.AreEqual(1, store.SaveCount);
    }

    [TestMethod]
    public async Task SyncCallsUseOnlyTheConfiguredOriginAndBearerToken()
    {
        Guid deviceId = Guid.NewGuid();
        var store = new MemoryRefreshTokenStore();
        var handler = new RecordingHandler((request, call, _) => Task.FromResult(call switch
        {
            0 => JsonResponse(
                HttpStatusCode.OK,
                SessionBody(deviceId, FirstAccessToken, FirstRefreshToken)),
            1 => AssertSyncPush(request),
            2 => AssertSyncPull(request),
            _ => throw new AssertFailedException("Unexpected backend request.")
        }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("owner@example.test", "valid-password", "Desktop test");
        const string batch = "{\"operations\":[{\"kind\":\"holding.delete\",\"operationId\":\"10000000-0000-0000-0000-000000000001\",\"holdingId\":\"20000000-0000-0000-0000-000000000002\",\"baseVersion\":3}]}";

        PokeFolioApiResponse pushed = await client.PushSyncOperationsAsync(batch);
        PokeFolioApiResponse pulled = await client.PullSyncChangesAsync("abc+/=", 25);

        Assert.IsTrue(pushed.Succeeded);
        Assert.AreEqual("{\"results\":[]}", pushed.Body);
        Assert.IsTrue(pulled.Succeeded);
        Assert.AreEqual("{\"changes\":[],\"nextCursor\":\"abc\",\"hasMore\":false}", pulled.Body);

        HttpResponseMessage AssertSyncPush(RecordedRequest request)
        {
            Assert.AreEqual("https://api.pokefolio.example/api/v1/sync/operations", request.Uri.AbsoluteUri);
            Assert.AreEqual("Bearer", request.AuthorizationScheme);
            Assert.AreEqual(FirstAccessToken, request.AuthorizationParameter);
            Assert.AreEqual(batch, request.Body);
            return JsonResponse(HttpStatusCode.OK, "{\"results\":[]}");
        }

        static HttpResponseMessage AssertSyncPull(RecordedRequest request)
        {
            Assert.AreEqual("/api/v1/sync/changes", request.Uri.AbsolutePath);
            Assert.IsTrue(request.Uri.Query.Contains("limit=25", StringComparison.Ordinal));
            Assert.IsTrue(request.Uri.Query.Contains("cursor=abc%2B%2F%3D", StringComparison.Ordinal));
            return JsonResponse(
                HttpStatusCode.OK,
                "{\"changes\":[],\"nextCursor\":\"abc\",\"hasMore\":false}");
        }
    }

    [TestMethod]
    public async Task UnauthorizedSyncRefreshesAndReplaysExactlyOnce()
    {
        Guid deviceId = Guid.NewGuid();
        var store = new MemoryRefreshTokenStore();
        var handler = new RecordingHandler((request, call, _) => Task.FromResult(call switch
        {
            0 => JsonResponse(
                HttpStatusCode.OK,
                SessionBody(deviceId, FirstAccessToken, FirstRefreshToken)),
            1 when request.AuthorizationParameter == FirstAccessToken =>
                ProblemResponse(HttpStatusCode.Unauthorized, "authentication_required"),
            2 when request.Uri.AbsolutePath == "/api/v1/auth/refresh" => JsonResponse(
                HttpStatusCode.OK,
                SessionBody(deviceId, RotatedAccessToken, RotatedRefreshToken)),
            3 when request.AuthorizationParameter == RotatedAccessToken =>
                JsonResponse(HttpStatusCode.OK, "{\"changes\":[],\"nextCursor\":\"\",\"hasMore\":false}"),
            _ => throw new AssertFailedException("Unexpected refresh/retry sequence.")
        }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("owner@example.test", "valid-password", "Desktop test");

        PokeFolioApiResponse response = await client.PullSyncChangesAsync();

        Assert.IsTrue(response.Succeeded);
        Assert.AreEqual(4, handler.Requests.Count);
        Assert.AreEqual(
            new RefreshTokenCredential(deviceId, RotatedRefreshToken),
            store.Credential);
        Assert.AreEqual(2, store.SaveCount);
    }

    [TestMethod]
    public async Task ConcurrentUnauthorizedCallsShareOneRotatingRefresh()
    {
        Guid deviceId = Guid.NewGuid();
        var store = new MemoryRefreshTokenStore();
        var bothRejectedRequestsArrived = new TaskCompletionSource<bool>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        int rejectedRequestCount = 0;
        int refreshCount = 0;
        var handler = new RecordingHandler(async (request, call, cancellationToken) =>
        {
            if (call == 0)
            {
                return JsonResponse(
                    HttpStatusCode.OK,
                    SessionBody(deviceId, FirstAccessToken, FirstRefreshToken));
            }
            if (request.AuthorizationParameter == FirstAccessToken)
            {
                if (Interlocked.Increment(ref rejectedRequestCount) == 2)
                {
                    bothRejectedRequestsArrived.TrySetResult(true);
                }
                await bothRejectedRequestsArrived.Task.WaitAsync(cancellationToken);
                return ProblemResponse(HttpStatusCode.Unauthorized, "authentication_required");
            }
            if (request.Uri.AbsolutePath == "/api/v1/auth/refresh")
            {
                Interlocked.Increment(ref refreshCount);
                return JsonResponse(
                    HttpStatusCode.OK,
                    SessionBody(deviceId, RotatedAccessToken, RotatedRefreshToken));
            }
            if (request.AuthorizationParameter == RotatedAccessToken)
            {
                return JsonResponse(
                    HttpStatusCode.OK,
                    "{\"changes\":[],\"nextCursor\":\"\",\"hasMore\":false}");
            }
            throw new AssertFailedException("Unexpected concurrent refresh request.");
        });
        using var client = CreateClient(store, handler);
        await client.LoginAsync("owner@example.test", "valid-password", "Desktop test");

        PokeFolioApiResponse[] responses = await Task.WhenAll(
            client.PullSyncChangesAsync(),
            client.PullSyncChangesAsync());

        Assert.IsTrue(responses.All(response => response.Succeeded));
        Assert.AreEqual(2, rejectedRequestCount);
        Assert.AreEqual(1, refreshCount);
        Assert.AreEqual(2, store.SaveCount);
    }

    [TestMethod]
    public async Task InvalidStoredRefreshTokenClearsLocalSession()
    {
        var store = new MemoryRefreshTokenStore
        {
            Credential = new RefreshTokenCredential(Guid.NewGuid(), FirstRefreshToken)
        };
        var handler = new RecordingHandler((_, _, _) => Task.FromResult(
            ProblemResponse(HttpStatusCode.Unauthorized, "invalid_refresh_token")));
        using var client = CreateClient(store, handler);

        PokeFolioAuthenticationResult result = await client.RestoreSessionAsync();

        Assert.IsFalse(result.Succeeded);
        Assert.AreEqual("invalid_refresh_token", result.Problem?.Code);
        Assert.IsNull(store.Credential);
        Assert.IsNull(client.CurrentSession);
        Assert.AreEqual(1, store.DeleteCount);
    }

    [TestMethod]
    public async Task TemporaryRestoreFailureIsReportedWithoutDiscardingCredential()
    {
        Guid deviceId = Guid.NewGuid();
        var original = new RefreshTokenCredential(deviceId, FirstRefreshToken);
        var store = new MemoryRefreshTokenStore { Credential = original };
        var handler = new RecordingHandler((_, _, _) => Task.FromResult(
            ProblemResponse(HttpStatusCode.ServiceUnavailable, "database_unavailable")));
        using var client = CreateClient(store, handler);

        PokeFolioApiResponse result = await client.PushSyncOperationsAsync(
            "{\"operations\":[{\"kind\":\"holding.delete\"}]}");

        Assert.IsFalse(result.Succeeded);
        Assert.AreEqual((int)HttpStatusCode.ServiceUnavailable, result.Status);
        Assert.AreEqual("database_unavailable", result.Problem?.Code);
        Assert.AreEqual(original, store.Credential);
        Assert.AreEqual(0, store.DeleteCount);
    }

    [TestMethod]
    public async Task LogoutRevokesServerSessionAndAlwaysDeletesLocalCredential()
    {
        Guid deviceId = Guid.NewGuid();
        var store = new MemoryRefreshTokenStore();
        var handler = new RecordingHandler((request, call, _) => Task.FromResult(call switch
        {
            0 => JsonResponse(
                HttpStatusCode.OK,
                SessionBody(deviceId, FirstAccessToken, FirstRefreshToken)),
            1 when request.Uri.AbsolutePath == "/api/v1/auth/logout" &&
                   request.AuthorizationParameter == FirstAccessToken =>
                new HttpResponseMessage(HttpStatusCode.NoContent),
            _ => throw new AssertFailedException("Unexpected logout sequence.")
        }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("owner@example.test", "valid-password", "Desktop test");

        PokeFolioLogoutResult result = await client.LogoutAsync();

        Assert.IsTrue(result.ServerSessionRevoked);
        Assert.IsNull(store.Credential);
        Assert.IsNull(client.CurrentSession);
        Assert.AreEqual(1, store.DeleteCount);
    }

    [TestMethod]
    public async Task DuplicateAuthResponsePropertiesFailClosed()
    {
        Guid deviceId = Guid.NewGuid();
        string validBody = SessionBody(deviceId, FirstAccessToken, FirstRefreshToken);
        string duplicateBody = validBody.Replace(
            "\"accessToken\":",
            "\"accessToken\":\"duplicate\",\"accessToken\":",
            StringComparison.Ordinal);
        var store = new MemoryRefreshTokenStore();
        var handler = new RecordingHandler((_, _, _) => Task.FromResult(
            JsonResponse(HttpStatusCode.OK, duplicateBody)));
        using var client = CreateClient(store, handler);

        await Assert.ThrowsExactlyAsync<InvalidDataException>(async () =>
            await client.LoginAsync("owner@example.test", "valid-password", "Desktop test"));
        Assert.IsNull(store.Credential);
        Assert.IsNull(client.CurrentSession);
    }

    [TestMethod]
    public async Task MissingStableUserIdentityFailsClosed()
    {
        Guid deviceId = Guid.NewGuid();
        string invalidBody = SessionBody(deviceId, FirstAccessToken, FirstRefreshToken)
            .Replace(
                UserId.ToString("D"),
                Guid.Empty.ToString("D"),
                StringComparison.Ordinal);
        var store = new MemoryRefreshTokenStore();
        var handler = new RecordingHandler((_, _, _) => Task.FromResult(
            JsonResponse(HttpStatusCode.OK, invalidBody)));
        using var client = CreateClient(store, handler);

        await Assert.ThrowsExactlyAsync<InvalidDataException>(async () =>
            await client.LoginAsync("owner@example.test", "valid-password", "Desktop test"));
        Assert.IsNull(store.Credential);
        Assert.IsNull(client.CurrentSession);
    }

    [TestMethod]
    public async Task InvalidSyncPayloadsAreRejectedBeforeNetworkAccess()
    {
        var store = new MemoryRefreshTokenStore();
        var handler = new RecordingHandler((_, _, _) =>
            throw new AssertFailedException("Invalid sync payload reached the network."));
        using var client = CreateClient(store, handler);

        await Assert.ThrowsExactlyAsync<ArgumentException>(async () =>
            await client.PushSyncOperationsAsync("[]"));
        await Assert.ThrowsExactlyAsync<ArgumentException>(async () =>
            await client.PushSyncOperationsAsync(
                "{\"operations\":[],\"operations\":[]}"));
        await Assert.ThrowsExactlyAsync<ArgumentException>(async () =>
            await client.PushSyncOperationsAsync(
                "{\"padding\":\"" + new string('x', 1024 * 1024) + "\"}"));
        Assert.HasCount(0, handler.Requests);
    }

    [TestMethod]
    public async Task OversizedAuthResponseIsRejectedBeforeParsingOrPersistence()
    {
        var store = new MemoryRefreshTokenStore();
        var handler = new RecordingHandler((_, _, _) => Task.FromResult(
            JsonResponse(HttpStatusCode.OK, new string('x', 128 * 1024 + 1))));
        using var client = CreateClient(store, handler);

        await Assert.ThrowsExactlyAsync<InvalidDataException>(async () =>
            await client.LoginAsync("owner@example.test", "valid-password", "Desktop test"));
        Assert.IsNull(store.Credential);
        Assert.IsNull(client.CurrentSession);
    }

    [TestMethod]
    public async Task RefreshResponseForAnotherDeviceFailsClosed()
    {
        Guid deviceId = Guid.NewGuid();
        var store = new MemoryRefreshTokenStore
        {
            Credential = new RefreshTokenCredential(deviceId, FirstRefreshToken)
        };
        var handler = new RecordingHandler((_, _, _) => Task.FromResult(JsonResponse(
            HttpStatusCode.OK,
            SessionBody(Guid.NewGuid(), RotatedAccessToken, RotatedRefreshToken))));
        using var client = CreateClient(store, handler);

        await Assert.ThrowsExactlyAsync<InvalidDataException>(async () =>
            await client.RestoreSessionAsync());
        Assert.IsNull(store.Credential);
        Assert.IsNull(client.CurrentSession);
        Assert.AreEqual(1, store.DeleteCount);
    }

    [TestMethod]
    public async Task FailedRotatedTokenPersistenceLeavesNoAuthenticatedSession()
    {
        var store = new MemoryRefreshTokenStore { FailSaves = true };
        var handler = new RecordingHandler((_, _, _) => Task.FromResult(JsonResponse(
            HttpStatusCode.OK,
            SessionBody(Guid.NewGuid(), FirstAccessToken, FirstRefreshToken))));
        using var client = CreateClient(store, handler);

        await Assert.ThrowsExactlyAsync<InvalidDataException>(async () =>
            await client.LoginAsync("owner@example.test", "valid-password", "Desktop test"));
        Assert.IsNull(store.Credential);
        Assert.IsNull(client.CurrentSession);
        Assert.AreEqual(1, store.SaveCount);
        Assert.AreEqual(1, store.DeleteCount);
    }

    private static PokeFolioApiClient CreateClient(
        MemoryRefreshTokenStore store,
        HttpMessageHandler handler) => new(
            new Uri("https://api.pokefolio.example/"),
            store,
            handler);

    private static string SessionBody(
        Guid deviceId,
        string accessToken,
        string refreshToken) => JsonSerializer.Serialize(new
        {
            userId = UserId,
            accessToken,
            refreshToken,
            accessTokenExpiresAt = "2030-01-01T00:00:00+00:00",
            device = new
            {
                id = deviceId,
                name = "Desktop test",
                platform = "windows",
                createdAt = "2026-09-10T00:00:00+00:00",
                lastSeenAt = "2026-09-10T00:00:00+00:00",
                current = true
            }
        });

    private static HttpResponseMessage JsonResponse(HttpStatusCode status, string json) => new(status)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private static HttpResponseMessage ProblemResponse(HttpStatusCode status, string code) =>
        JsonResponse(status, JsonSerializer.Serialize(new
        {
            type = "about:blank",
            title = "Request failed.",
            status = (int)status,
            code,
            correlationId = "test-correlation"
        }));

    private sealed class MemoryRefreshTokenStore : IRefreshTokenStore
    {
        private readonly object gate = new();
        private RefreshTokenCredential? credential;

        public RefreshTokenCredential? Credential
        {
            get
            {
                lock (gate) return credential;
            }
            set
            {
                lock (gate) credential = value;
            }
        }

        public int SaveCount { get; private set; }

        public int DeleteCount { get; private set; }

        public bool FailSaves { get; init; }

        public RefreshTokenCredential? Load() => Credential;

        public void Save(RefreshTokenCredential value)
        {
            lock (gate)
            {
                SaveCount++;
                if (FailSaves) throw new IOException("Simulated credential-store failure.");
                credential = value;
            }
        }

        public void Delete()
        {
            lock (gate)
            {
                credential = null;
                DeleteCount++;
            }
        }
    }

    private sealed record RecordedRequest(
        HttpMethod Method,
        Uri Uri,
        string? AuthorizationScheme,
        string? AuthorizationParameter,
        string Body);

    private sealed class RecordingHandler(
        Func<RecordedRequest, int, CancellationToken, Task<HttpResponseMessage>> respond) :
        HttpMessageHandler
    {
        private readonly ConcurrentQueue<RecordedRequest> requests = new();
        private int callCount;

        public IReadOnlyList<RecordedRequest> Requests => requests.ToArray();

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var recorded = new RecordedRequest(
                request.Method,
                request.RequestUri!,
                request.Headers.Authorization?.Scheme,
                request.Headers.Authorization?.Parameter,
                request.Content is null
                    ? ""
                    : await request.Content.ReadAsStringAsync(cancellationToken));
            requests.Enqueue(recorded);
            int call = Interlocked.Increment(ref callCount) - 1;
            return await respond(recorded, call, cancellationToken);
        }
    }
}
