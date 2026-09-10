namespace PokeFolio.Desktop.Backend;

public sealed record PokeFolioApiProblem(
    int Status,
    string Code,
    string Title,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public sealed record PokeFolioDevice(
    Guid Id,
    string Name,
    string Platform,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastSeenAt);

public sealed record PokeFolioSession(
    PokeFolioDevice Device,
    DateTimeOffset AccessTokenExpiresAt);

public sealed record PokeFolioAuthenticationResult(
    PokeFolioSession? Session,
    PokeFolioApiProblem? Problem)
{
    public bool Succeeded => Session is not null;

    public static PokeFolioAuthenticationResult Success(PokeFolioSession session) =>
        new(session, Problem: null);

    public static PokeFolioAuthenticationResult Failed(PokeFolioApiProblem problem) =>
        new(Session: null, problem);
}

public sealed record PokeFolioApiResponse(
    int Status,
    string Body,
    PokeFolioApiProblem? Problem = null)
{
    public bool Succeeded => Status is >= 200 and < 300;
}

public sealed record PokeFolioLogoutResult(
    bool ServerSessionRevoked,
    PokeFolioApiProblem? Problem = null);
