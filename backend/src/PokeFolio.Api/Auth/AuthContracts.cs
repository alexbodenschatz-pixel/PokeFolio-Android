namespace PokeFolio.Api.Auth;

public sealed record RegisterCommand(
    string? Email,
    string? Password,
    string? DeviceName,
    string? Platform);

public sealed record LoginCommand(
    string? Email,
    string? Password,
    string? DeviceName,
    string? Platform);

public sealed record RefreshCommand(string? RefreshToken);

public sealed record ChangePasswordCommand(
    string? CurrentPassword,
    string? NewPassword);

public sealed record AuthSessionResponse(
    Guid UserId,
    string AccessToken,
    string RefreshToken,
    DateTimeOffset AccessTokenExpiresAt,
    DeviceResponse Device);

public sealed record DeviceResponse(
    Guid Id,
    string Name,
    string Platform,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastSeenAt,
    bool Current);

public sealed record AuthFailure(
    int Status,
    string Code,
    string Title,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public sealed record AuthOperationResult(
    AuthSessionResponse? Session,
    AuthFailure? Failure)
{
    public static AuthOperationResult Success(AuthSessionResponse session) => new(session, null);
    public static AuthOperationResult Failed(AuthFailure failure) => new(null, failure);
}

public sealed record AuthCommandResult(AuthFailure? Failure)
{
    public bool Succeeded => Failure is null;

    public static AuthCommandResult Success() => new(Failure: null);
    public static AuthCommandResult Failed(AuthFailure failure) => new(failure);
}
