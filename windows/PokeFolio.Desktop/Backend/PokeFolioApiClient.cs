using System.Net;
using System.Security.Cryptography;
using PokeFolio.Desktop.Security;

namespace PokeFolio.Desktop.Backend;

public sealed class PokeFolioApiClient : IDisposable
{
    private const int MaximumAuthResponseBytes = 128 * 1024;
    private const int MaximumSyncResponseBytes = 8 * 1024 * 1024;

    private readonly IRefreshTokenStore refreshTokenStore;
    private readonly PokeFolioApiTransport transport;
    private readonly SemaphoreSlim sessionGate = new(1, 1);
    private SessionState? session;
    private int disposed;

    public PokeFolioApiClient(Uri backendOrigin, IRefreshTokenStore refreshTokenStore)
    {
        this.refreshTokenStore = refreshTokenStore ??
            throw new ArgumentNullException(nameof(refreshTokenStore));
        transport = new PokeFolioApiTransport(backendOrigin);
    }

    internal PokeFolioApiClient(
        Uri backendOrigin,
        IRefreshTokenStore refreshTokenStore,
        HttpMessageHandler handler)
    {
        this.refreshTokenStore = refreshTokenStore ??
            throw new ArgumentNullException(nameof(refreshTokenStore));
        transport = new PokeFolioApiTransport(backendOrigin, handler);
    }

    public Uri BackendOrigin => transport.BackendOrigin;

    public PokeFolioSession? CurrentSession => ToPublicSession(Volatile.Read(ref session));

    public static bool IsAllowedBackendOrigin(Uri? origin) =>
        PokeFolioApiTransport.IsAllowedBackendOrigin(origin);

    public async Task<PokeFolioAuthenticationResult> RegisterAsync(
        string email,
        string password,
        string deviceName,
        CancellationToken cancellationToken = default) =>
        await StartSessionAsync(
            "/api/v1/auth/register",
            email,
            password,
            deviceName,
            cancellationToken);

    public async Task<PokeFolioAuthenticationResult> LoginAsync(
        string email,
        string password,
        string deviceName,
        CancellationToken cancellationToken = default) =>
        await StartSessionAsync(
            "/api/v1/auth/login",
            email,
            password,
            deviceName,
            cancellationToken);

    public async Task<PokeFolioAuthenticationResult> RestoreSessionAsync(
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await sessionGate.WaitAsync(cancellationToken);
        try
        {
            SessionState? current = Volatile.Read(ref session);
            if (current is not null)
            {
                return PokeFolioAuthenticationResult.Success(ToPublicSession(current)!);
            }

            RefreshTokenCredential? credential = refreshTokenStore.Load();
            return credential is null
                ? PokeFolioAuthenticationResult.Failed(SessionMissingProblem())
                : await RefreshCoreAsync(credential, cancellationToken);
        }
        finally
        {
            sessionGate.Release();
        }
    }

    public async Task<PokeFolioApiResponse> PushSyncOperationsAsync(
        string operationBatchJson,
        CancellationToken cancellationToken = default)
    {
        byte[] body = PokeFolioApiPayloads.ValidateSyncOperationBatch(operationBatchJson);
        try
        {
            return await SendAuthenticatedAsync(
                HttpMethod.Post,
                "/api/v1/sync/operations",
                body,
                cancellationToken);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(body);
        }
    }

    public async Task<PokeFolioApiResponse> PullSyncChangesAsync(
        string? cursor = null,
        int limit = 100,
        CancellationToken cancellationToken = default)
    {
        if (limit is < 1 or > 500)
        {
            throw new ArgumentOutOfRangeException(nameof(limit), "Sync page size must be 1 to 500.");
        }
        if (cursor?.Length > 2048)
        {
            throw new ArgumentException("Sync cursor exceeds 2048 characters.", nameof(cursor));
        }

        string path = $"/api/v1/sync/changes?limit={limit}";
        if (!string.IsNullOrEmpty(cursor))
        {
            path += "&cursor=" + Uri.EscapeDataString(cursor);
        }
        return await SendAuthenticatedAsync(HttpMethod.Get, path, body: null, cancellationToken);
    }

    public async Task<PokeFolioLogoutResult> LogoutAsync(
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await sessionGate.WaitAsync(cancellationToken);
        PokeFolioRawResponse? response = null;
        try
        {
            SessionState? current = Volatile.Read(ref session);
            if (current is null)
            {
                RefreshTokenCredential? stored = refreshTokenStore.Load();
                if (stored is not null)
                {
                    PokeFolioAuthenticationResult restored =
                        await RefreshCoreAsync(stored, cancellationToken);
                    current = restored.Succeeded ? Volatile.Read(ref session) : null;
                    if (current is null)
                    {
                        return new PokeFolioLogoutResult(false, restored.Problem);
                    }
                }
            }

            if (current is null) return new PokeFolioLogoutResult(false);
            response = await transport.SendAsync(
                HttpMethod.Post,
                "/api/v1/auth/logout",
                body: null,
                current.AccessToken,
                MaximumAuthResponseBytes,
                cancellationToken);
            if (response.Status == (int)HttpStatusCode.Unauthorized)
            {
                RefreshTokenCredential? stored = refreshTokenStore.Load();
                if (stored is not null)
                {
                    PokeFolioAuthenticationResult refreshed =
                        await RefreshCoreAsync(stored, cancellationToken);
                    current = refreshed.Succeeded ? Volatile.Read(ref session) : null;
                    if (current is not null)
                    {
                        CryptographicOperations.ZeroMemory(response.Body);
                        response = await transport.SendAsync(
                            HttpMethod.Post,
                            "/api/v1/auth/logout",
                            body: null,
                            current.AccessToken,
                            MaximumAuthResponseBytes,
                            cancellationToken);
                    }
                }
            }

            return response.IsSuccess
                ? new PokeFolioLogoutResult(true)
                : new PokeFolioLogoutResult(
                    false,
                    PokeFolioApiPayloads.ParseProblem(response));
        }
        finally
        {
            if (response is not null) CryptographicOperations.ZeroMemory(response.Body);
            Volatile.Write(ref session, null);
            try
            {
                refreshTokenStore.Delete();
            }
            finally
            {
                sessionGate.Release();
            }
        }
    }

    private async Task<PokeFolioAuthenticationResult> StartSessionAsync(
        string path,
        string email,
        string password,
        string deviceName,
        CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        byte[] body = PokeFolioApiPayloads.SerializeLogin(email, password, deviceName);

        await sessionGate.WaitAsync(cancellationToken);
        PokeFolioRawResponse? response = null;
        try
        {
            response = await transport.SendAsync(
                HttpMethod.Post,
                path,
                body,
                accessToken: null,
                MaximumAuthResponseBytes,
                cancellationToken);
            if (!response.IsSuccess)
            {
                return PokeFolioAuthenticationResult.Failed(
                    PokeFolioApiPayloads.ParseProblem(response));
            }

            PokeFolioAuthSessionEnvelope envelope =
                PokeFolioApiPayloads.ParseSession(response.Body);
            ActivateSession(envelope);
            return PokeFolioAuthenticationResult.Success(ToPublicSession(session)!);
        }
        finally
        {
            if (response is not null) CryptographicOperations.ZeroMemory(response.Body);
            CryptographicOperations.ZeroMemory(body);
            sessionGate.Release();
        }
    }

    private async Task<PokeFolioAuthenticationResult> RefreshCoreAsync(
        RefreshTokenCredential credential,
        CancellationToken cancellationToken)
    {
        byte[] body = PokeFolioApiPayloads.SerializeRefresh(credential.RefreshToken);
        PokeFolioRawResponse? response = null;
        try
        {
            response = await transport.SendAsync(
                HttpMethod.Post,
                "/api/v1/auth/refresh",
                body,
                accessToken: null,
                MaximumAuthResponseBytes,
                cancellationToken);
            if (!response.IsSuccess)
            {
                PokeFolioApiProblem problem = PokeFolioApiPayloads.ParseProblem(response);
                if (response.Status is (int)HttpStatusCode.BadRequest or (int)HttpStatusCode.Unauthorized)
                {
                    InvalidateLocalSession();
                }
                return PokeFolioAuthenticationResult.Failed(problem);
            }

            try
            {
                PokeFolioAuthSessionEnvelope envelope =
                    PokeFolioApiPayloads.ParseSession(response.Body);
                if (envelope.Device.Id != credential.DeviceId)
                {
                    throw new InvalidDataException(
                        "Refresh response belongs to a different device session.");
                }
                ActivateSession(envelope);
                return PokeFolioAuthenticationResult.Success(ToPublicSession(session)!);
            }
            catch
            {
                InvalidateLocalSession();
                throw;
            }
        }
        finally
        {
            if (response is not null) CryptographicOperations.ZeroMemory(response.Body);
            CryptographicOperations.ZeroMemory(body);
        }
    }

    private async Task<PokeFolioApiResponse> SendAuthenticatedAsync(
        HttpMethod method,
        string path,
        byte[]? body,
        CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        SessionResolution resolution = await EnsureSessionAsync(cancellationToken);
        SessionState? current = resolution.Session;
        if (current is null)
        {
            return new PokeFolioApiResponse(
                resolution.Problem!.Status,
                "",
                resolution.Problem);
        }

        PokeFolioRawResponse response = await transport.SendAsync(
            method,
            path,
            body,
            current.AccessToken,
            MaximumSyncResponseBytes,
            cancellationToken);
        if (response.Status == (int)HttpStatusCode.Unauthorized)
        {
            CryptographicOperations.ZeroMemory(response.Body);
            SessionResolution refreshed = await RefreshAfterUnauthorizedAsync(
                current.AccessToken,
                cancellationToken);
            if (refreshed.Session is null)
            {
                return new PokeFolioApiResponse(
                    refreshed.Problem!.Status,
                    "",
                    refreshed.Problem);
            }

            current = refreshed.Session;
            response = await transport.SendAsync(
                method,
                path,
                body,
                current.AccessToken,
                MaximumSyncResponseBytes,
                cancellationToken);
        }

        try
        {
            string responseBody = PokeFolioApiPayloads.DecodeBody(response.Body);
            return response.IsSuccess
                ? new PokeFolioApiResponse(response.Status, responseBody)
                : new PokeFolioApiResponse(
                    response.Status,
                    responseBody,
                    PokeFolioApiPayloads.ParseProblem(response));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(response.Body);
        }
    }

    private async Task<SessionResolution> EnsureSessionAsync(CancellationToken cancellationToken)
    {
        SessionState? current = Volatile.Read(ref session);
        if (current is not null) return new SessionResolution(current, Problem: null);

        await sessionGate.WaitAsync(cancellationToken);
        try
        {
            current = Volatile.Read(ref session);
            if (current is not null) return new SessionResolution(current, Problem: null);
            RefreshTokenCredential? credential = refreshTokenStore.Load();
            if (credential is null)
            {
                return new SessionResolution(Session: null, SessionMissingProblem());
            }
            PokeFolioAuthenticationResult result =
                await RefreshCoreAsync(credential, cancellationToken);
            return result.Succeeded
                ? new SessionResolution(Volatile.Read(ref session), Problem: null)
                : new SessionResolution(Session: null, result.Problem);
        }
        finally
        {
            sessionGate.Release();
        }
    }

    private async Task<SessionResolution> RefreshAfterUnauthorizedAsync(
        string rejectedAccessToken,
        CancellationToken cancellationToken)
    {
        await sessionGate.WaitAsync(cancellationToken);
        try
        {
            SessionState? current = Volatile.Read(ref session);
            if (current is not null &&
                !string.Equals(current.AccessToken, rejectedAccessToken, StringComparison.Ordinal))
            {
                return new SessionResolution(current, Problem: null);
            }

            RefreshTokenCredential? credential = refreshTokenStore.Load();
            if (credential is null)
            {
                return new SessionResolution(Session: null, SessionMissingProblem());
            }
            PokeFolioAuthenticationResult result =
                await RefreshCoreAsync(credential, cancellationToken);
            return result.Succeeded
                ? new SessionResolution(Volatile.Read(ref session), Problem: null)
                : new SessionResolution(Session: null, result.Problem);
        }
        finally
        {
            sessionGate.Release();
        }
    }

    private void ActivateSession(PokeFolioAuthSessionEnvelope envelope)
    {
        var credential = new RefreshTokenCredential(envelope.Device.Id, envelope.RefreshToken);
        try
        {
            refreshTokenStore.Save(credential);
        }
        catch (Exception saveError)
        {
            Volatile.Write(ref session, null);
            try
            {
                refreshTokenStore.Delete();
            }
            catch (Exception deleteError)
            {
                throw new AggregateException(
                    "Rotated refresh token could not be persisted or invalidated.",
                    saveError,
                    deleteError);
            }
            throw new InvalidDataException("Rotated refresh token could not be persisted.", saveError);
        }

        Volatile.Write(ref session, new SessionState(
            envelope.AccessToken,
            envelope.AccessTokenExpiresAt,
            new PokeFolioDevice(
                envelope.Device.Id,
                envelope.Device.Name,
                envelope.Device.Platform,
                envelope.Device.CreatedAt,
                envelope.Device.LastSeenAt)));
    }

    private void InvalidateLocalSession()
    {
        Volatile.Write(ref session, null);
        refreshTokenStore.Delete();
    }

    private static PokeFolioSession? ToPublicSession(SessionState? state) =>
        state is null ? null : new PokeFolioSession(state.Device, state.AccessTokenExpiresAt);

    private static PokeFolioApiProblem SessionMissingProblem() => new(
        (int)HttpStatusCode.Unauthorized,
        "session_missing",
        "No persistent PokeFolio session is available.");

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        Volatile.Write(ref session, null);
        transport.Dispose();
    }

    private sealed record SessionState(
        string AccessToken,
        DateTimeOffset AccessTokenExpiresAt,
        PokeFolioDevice Device);

    private sealed record SessionResolution(
        SessionState? Session,
        PokeFolioApiProblem? Problem);
}
