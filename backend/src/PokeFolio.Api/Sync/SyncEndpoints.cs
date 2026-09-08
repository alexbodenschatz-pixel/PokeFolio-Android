using PokeFolio.Api.Security;

namespace PokeFolio.Api.Sync;

public static class SyncEndpoints
{
    public static IEndpointRouteBuilder MapSyncEndpoints(this IEndpointRouteBuilder endpoints)
    {
        RouteGroupBuilder sync = endpoints.MapGroup("/api/v1/sync")
            .WithTags("Sync");
        sync.MapGet("/changes", PullChangesAsync);
        return endpoints;
    }

    private static async Task<IResult> PullChangesAsync(
        string? cursor,
        int? limit,
        HttpContext context,
        SyncChangeReadService changes,
        CancellationToken cancellationToken)
    {
        Guid? userId = PrincipalIdentity.GetUserId(context.User);
        if (!userId.HasValue) return Results.Unauthorized();
        if (!SyncCursor.TryDecode(cursor, out long afterSequence))
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "invalid_cursor",
                "Sync cursor is invalid.");
        }

        int pageSize = limit ?? 100;
        if (pageSize is < 1 or > 500)
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "invalid_page_size",
                "Sync page size must be between 1 and 500.");
        }

        return Results.Ok(await changes.ListAsync(
            userId.Value,
            afterSequence,
            pageSize,
            cancellationToken));
    }

    private static IResult Problem(int status, string code, string title) => Results.Problem(
        statusCode: status,
        title: title,
        extensions: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["code"] = code
        });
}
