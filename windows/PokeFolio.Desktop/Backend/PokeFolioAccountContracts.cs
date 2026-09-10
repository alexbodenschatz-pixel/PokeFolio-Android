namespace PokeFolio.Desktop.Backend;

public sealed record PokeFolioAccountStatus(
    bool Configured,
    bool Authenticated,
    string? BackendOrigin,
    PokeFolioSession? Session,
    string? ConfigurationError);

public interface IPokeFolioAccountService : IDisposable
{
    PokeFolioAccountStatus GetStatus();

    Task<PokeFolioAuthenticationResult> RegisterAsync(
        string email,
        string password,
        string deviceName,
        CancellationToken cancellationToken = default);

    Task<PokeFolioAuthenticationResult> LoginAsync(
        string email,
        string password,
        string deviceName,
        CancellationToken cancellationToken = default);

    Task<PokeFolioAuthenticationResult> RestoreSessionAsync(
        CancellationToken cancellationToken = default);

    Task<PokeFolioLogoutResult> LogoutAsync(
        CancellationToken cancellationToken = default);
}
