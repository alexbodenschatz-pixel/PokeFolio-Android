using System.Net;
using PokeFolio.Desktop.Security;

namespace PokeFolio.Desktop.Backend;

public sealed class PokeFolioAccountService : IPokeFolioCloudService
{
    private readonly PokeFolioBackendConfiguration configuration;
    private readonly PokeFolioApiClient? client;
    private int disposed;

    public PokeFolioAccountService(PokeFolioBackendConfiguration configuration)
        : this(configuration, CreateClient(configuration))
    {
    }

    internal PokeFolioAccountService(
        PokeFolioBackendConfiguration configuration,
        PokeFolioApiClient? client)
    {
        this.configuration = configuration ??
            throw new ArgumentNullException(nameof(configuration));
        if (configuration.IsConfigured && configuration.Error is not null)
        {
            throw new ArgumentException(
                "Configured account services cannot contain a configuration error.",
                nameof(configuration));
        }
        if (configuration.IsConfigured != (client is not null))
        {
            throw new ArgumentException(
                "Configured account services require exactly one API client.",
                nameof(client));
        }
        this.client = client;
    }

    public static PokeFolioAccountService FromEnvironment() =>
        new(PokeFolioBackendConfiguration.FromEnvironment());

    public PokeFolioAccountStatus GetStatus()
    {
        ThrowIfDisposed();
        PokeFolioSession? current = client?.CurrentSession;
        return new PokeFolioAccountStatus(
            configuration.IsConfigured,
            current is not null,
            configuration.BackendOrigin?.AbsoluteUri,
            current,
            ConfigurationMessage());
    }

    public Task<PokeFolioAuthenticationResult> RegisterAsync(
        string email,
        string password,
        string deviceName,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableAuthentication())
            : client.RegisterAsync(email, password, deviceName, cancellationToken);
    }

    public Task<PokeFolioAuthenticationResult> LoginAsync(
        string email,
        string password,
        string deviceName,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableAuthentication())
            : client.LoginAsync(email, password, deviceName, cancellationToken);
    }

    public Task<PokeFolioApiResponse> RequestPasswordResetAsync(
        string email,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableApiResponse())
            : client.RequestPasswordResetAsync(email, cancellationToken);
    }

    public Task<PokeFolioApiResponse> ConfirmPasswordResetAsync(
        string email,
        string token,
        string newPassword,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableApiResponse())
            : client.ConfirmPasswordResetAsync(
                email,
                token,
                newPassword,
                cancellationToken);
    }

    public Task<PokeFolioAuthenticationResult> RestoreSessionAsync(
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableAuthentication())
            : client.RestoreSessionAsync(cancellationToken);
    }

    public Task<PokeFolioLogoutResult> LogoutAsync(
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(new PokeFolioLogoutResult(false, UnavailableProblem()))
            : client.LogoutAsync(cancellationToken);
    }

    public Task<PokeFolioApiResponse> ListDevicesAsync(
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableApiResponse())
            : client.ListDevicesAsync(cancellationToken);
    }

    public Task<PokeFolioApiResponse> RevokeOtherDevicesAsync(
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableApiResponse())
            : client.RevokeOtherDevicesAsync(cancellationToken);
    }

    public Task<PokeFolioApiResponse> RevokeDeviceAsync(
        Guid deviceId,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableApiResponse())
            : client.RevokeDeviceAsync(deviceId, cancellationToken);
    }

    public Task<PokeFolioApiResponse> PushSyncOperationsAsync(
        string operationBatchJson,
        CancellationToken cancellationToken = default,
        Guid? expectedUserId = null)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableApiResponse())
            : client.PushSyncOperationsAsync(
                operationBatchJson, cancellationToken, expectedUserId);
    }

    public Task<PokeFolioApiResponse> PullSyncChangesAsync(
        string? cursor = null,
        int limit = 100,
        CancellationToken cancellationToken = default,
        Guid? expectedUserId = null)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableApiResponse())
            : client.PullSyncChangesAsync(cursor, limit, cancellationToken, expectedUserId);
    }

    public Task<PokeFolioApiResponse> ResolveCatalogCardAsync(
        string cardReferenceJson,
        CancellationToken cancellationToken = default,
        Guid? expectedUserId = null)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableApiResponse())
            : client.ResolveCatalogCardAsync(
                cardReferenceJson, cancellationToken, expectedUserId);
    }

    public Task<PokeFolioApiResponse> GetCatalogCardAsync(
        Guid cardId,
        CancellationToken cancellationToken = default,
        Guid? expectedUserId = null)
    {
        ThrowIfDisposed();
        return client is null
            ? Task.FromResult(UnavailableApiResponse())
            : client.GetCatalogCardAsync(cardId, cancellationToken, expectedUserId);
    }

    private PokeFolioAuthenticationResult UnavailableAuthentication() =>
        PokeFolioAuthenticationResult.Failed(UnavailableProblem());

    private PokeFolioApiResponse UnavailableApiResponse() =>
        new((int)HttpStatusCode.ServiceUnavailable, "", UnavailableProblem());

    private PokeFolioApiProblem UnavailableProblem() => new(
        (int)HttpStatusCode.ServiceUnavailable,
        "backend_not_configured",
        ConfigurationMessage() ?? "PokeFolio backend is not configured.");

    private string? ConfigurationMessage() =>
        configuration.Error ??
        (configuration.IsConfigured ? null : "PokeFolio backend is not configured.");

    private static PokeFolioApiClient? CreateClient(PokeFolioBackendConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        if (configuration.IsConfigured && configuration.Error is not null)
        {
            throw new ArgumentException(
                "Configured account services cannot contain a configuration error.",
                nameof(configuration));
        }
        return configuration.BackendOrigin is null
            ? null
            : new PokeFolioApiClient(
                configuration.BackendOrigin,
                new ProtectedRefreshTokenStore());
    }

    private void ThrowIfDisposed() =>
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        client?.Dispose();
    }
}
