using System.Text.Json;
using PokeFolio.Desktop.Backend;
using PokeFolio.Desktop.Diagnostics;

namespace PokeFolio.Desktop.Bridge;

internal sealed class AccountBridgeController : IDisposable
{
    private readonly IJavaScriptCallbackDispatcher callbacks;
    private readonly IPokeFolioAccountService account;
    private readonly CancellationTokenSource lifetime = new();
    private int disposed;

    public AccountBridgeController(
        IJavaScriptCallbackDispatcher callbacks,
        IPokeFolioAccountService account)
    {
        this.callbacks = callbacks ?? throw new ArgumentNullException(nameof(callbacks));
        this.account = account ?? throw new ArgumentNullException(nameof(account));
    }

    public string GetStatusJson() =>
        JsonSerializer.Serialize(AccountStatusPayload(account.GetStatus()));

    public void Register(
        string email,
        string password,
        string deviceName,
        string requestId) =>
        _ = RunAuthenticationAsync(
            "register",
            requestId,
            cancellationToken => account.RegisterAsync(
                email,
                password,
                deviceName,
                cancellationToken));

    public void Login(
        string email,
        string password,
        string deviceName,
        string requestId) =>
        _ = RunAuthenticationAsync(
            "login",
            requestId,
            cancellationToken => account.LoginAsync(
                email,
                password,
                deviceName,
                cancellationToken));

    public void Restore(string requestId) =>
        _ = RunAuthenticationAsync(
            "restore",
            requestId,
            account.RestoreSessionAsync);

    public void Logout(string requestId) => _ = RunLogoutAsync(requestId);

    private async Task RunAuthenticationAsync(
        string operation,
        string requestId,
        Func<CancellationToken, Task<PokeFolioAuthenticationResult>> action)
    {
        string safeRequestId = SafeRequestId(requestId);
        try
        {
            PokeFolioAuthenticationResult result = await action(lifetime.Token);
            DesktopLog.Info(
                "ACCOUNT_OPERATION",
                ("operation", operation),
                ("success", result.Succeeded));
            await callbacks.SendAsync("onDesktopAccountResult", new
            {
                requestId = safeRequestId,
                operation,
                ok = result.Succeeded,
                status = AccountStatusPayload(account.GetStatus()),
                problem = ProblemPayload(result.Problem)
            });
        }
        catch (OperationCanceledException) when (IsDisposed)
        {
            // Application shutdown cancels outstanding account work.
        }
        catch (Exception) when (IsDisposed)
        {
            // The native transport may finish disposal with a non-cancellation exception.
        }
        catch (Exception error)
        {
            DesktopLog.Warning(
                "ACCOUNT_OPERATION_FAILED",
                ("operation", operation),
                ("type", error.GetType().Name));
            await callbacks.SendAsync("onDesktopAccountResult", new
            {
                requestId = safeRequestId,
                operation,
                ok = false,
                status = AccountStatusPayload(account.GetStatus()),
                problem = (object?)null,
                errorType = AccountErrorType(error),
                error = AccountErrorMessage(error)
            });
        }
    }

    private async Task RunLogoutAsync(string requestId)
    {
        string safeRequestId = SafeRequestId(requestId);
        try
        {
            PokeFolioLogoutResult result = await account.LogoutAsync(lifetime.Token);
            DesktopLog.Info(
                "ACCOUNT_OPERATION",
                ("operation", "logout"),
                ("success", result.ServerSessionRevoked));
            await callbacks.SendAsync("onDesktopAccountResult", new
            {
                requestId = safeRequestId,
                operation = "logout",
                ok = result.Problem is null,
                serverSessionRevoked = result.ServerSessionRevoked,
                status = AccountStatusPayload(account.GetStatus()),
                problem = ProblemPayload(result.Problem)
            });
        }
        catch (OperationCanceledException) when (IsDisposed)
        {
            // Application shutdown cancels outstanding account work.
        }
        catch (Exception) when (IsDisposed)
        {
            // The native transport may finish disposal with a non-cancellation exception.
        }
        catch (Exception error)
        {
            DesktopLog.Warning(
                "ACCOUNT_OPERATION_FAILED",
                ("operation", "logout"),
                ("type", error.GetType().Name));
            await callbacks.SendAsync("onDesktopAccountResult", new
            {
                requestId = safeRequestId,
                operation = "logout",
                ok = false,
                serverSessionRevoked = false,
                status = AccountStatusPayload(account.GetStatus()),
                problem = (object?)null,
                errorType = AccountErrorType(error),
                error = AccountErrorMessage(error)
            });
        }
    }

    private static object AccountStatusPayload(PokeFolioAccountStatus status) => new
    {
        configured = status.Configured,
        authenticated = status.Authenticated,
        backendOrigin = status.BackendOrigin,
        configurationError = status.ConfigurationError,
        session = status.Session is null ? null : new
        {
            accessTokenExpiresAt = status.Session.AccessTokenExpiresAt,
            device = new
            {
                id = status.Session.Device.Id,
                name = status.Session.Device.Name,
                platform = status.Session.Device.Platform,
                createdAt = status.Session.Device.CreatedAt,
                lastSeenAt = status.Session.Device.LastSeenAt
            }
        }
    };

    private static object? ProblemPayload(PokeFolioApiProblem? problem) =>
        problem is null ? null : new
        {
            status = problem.Status,
            code = problem.Code,
            title = problem.Title,
            errors = problem.Errors
        };

    private static string SafeRequestId(string? requestId) =>
        requestId is { Length: >= 1 and <= 128 } ? requestId : "";

    private static string AccountErrorType(Exception error) => error switch
    {
        ArgumentException => "validation",
        HttpRequestException => "network",
        InvalidDataException => "invalid-response",
        _ => "internal"
    };

    private static string AccountErrorMessage(Exception error) => error switch
    {
        ArgumentException => "Kontodaten sind ungültig.",
        HttpRequestException => "Das PokeFolio-Backend ist nicht erreichbar.",
        InvalidDataException => "Das PokeFolio-Backend hat ungültige Sitzungsdaten geliefert.",
        _ => "Die Kontoaktion ist fehlgeschlagen."
    };

    private bool IsDisposed => Volatile.Read(ref disposed) != 0;

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        lifetime.Cancel();
        account.Dispose();
        lifetime.Dispose();
    }
}
