using PokeFolio.Api.Security;

namespace PokeFolio.Api.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        RouteGroupBuilder auth = endpoints.MapGroup("/api/v1/auth")
            .WithTags("Auth");

        auth.MapPost("/register", RegisterAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-sensitive");
        auth.MapPost("/login", LoginAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-sensitive");
        auth.MapPost("/refresh", RefreshAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-refresh");
        auth.MapPost("/logout", LogoutAsync);
        auth.MapPost("/password/change", ChangePasswordAsync)
            .RequireRateLimiting("auth-sensitive");
        return endpoints;
    }

    private static async Task<IResult> RegisterAsync(
        RegisterCommand command,
        AuthSessionService sessions,
        CancellationToken cancellationToken)
    {
        AuthOperationResult result = await sessions.RegisterAsync(command, cancellationToken);
        return result.Session is not null
            ? Results.Created($"/api/v1/devices/{result.Session.Device.Id}", result.Session)
            : ToProblem(result.Failure!);
    }

    private static async Task<IResult> LoginAsync(
        LoginCommand command,
        AuthSessionService sessions,
        CancellationToken cancellationToken)
    {
        AuthOperationResult result = await sessions.LoginAsync(command, cancellationToken);
        return result.Session is not null ? Results.Ok(result.Session) : ToProblem(result.Failure!);
    }

    private static async Task<IResult> RefreshAsync(
        RefreshCommand command,
        AuthSessionService sessions,
        CancellationToken cancellationToken)
    {
        AuthOperationResult result = await sessions.RefreshAsync(command, cancellationToken);
        return result.Session is not null ? Results.Ok(result.Session) : ToProblem(result.Failure!);
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext context,
        AuthSessionService sessions,
        CancellationToken cancellationToken)
    {
        Guid? userId = PrincipalIdentity.GetUserId(context.User);
        Guid? deviceSessionId = PrincipalIdentity.GetDeviceSessionId(context.User);
        if (!userId.HasValue || !deviceSessionId.HasValue)
        {
            return Results.Unauthorized();
        }

        await sessions.RevokeCurrentDeviceAsync(userId.Value, deviceSessionId.Value, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ChangePasswordAsync(
        ChangePasswordCommand command,
        HttpContext context,
        AuthSessionService sessions,
        CancellationToken cancellationToken)
    {
        Guid? userId = PrincipalIdentity.GetUserId(context.User);
        Guid? deviceSessionId = PrincipalIdentity.GetDeviceSessionId(context.User);
        if (!userId.HasValue || !deviceSessionId.HasValue)
        {
            return Results.Unauthorized();
        }

        AuthCommandResult result = await sessions.ChangePasswordAsync(
            userId.Value,
            deviceSessionId.Value,
            command,
            cancellationToken);
        return result.Succeeded ? Results.NoContent() : ToProblem(result.Failure!);
    }

    private static IResult ToProblem(AuthFailure failure)
    {
        var extensions = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["code"] = failure.Code
        };
        if (failure.Errors is not null) extensions["errors"] = failure.Errors;
        return Results.Problem(
            statusCode: failure.Status,
            title: failure.Title,
            extensions: extensions);
    }
}
