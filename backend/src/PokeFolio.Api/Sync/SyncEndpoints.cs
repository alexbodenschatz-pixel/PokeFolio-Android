using System.Text.Json;
using PokeFolio.Api.Security;

namespace PokeFolio.Api.Sync;

public static class SyncEndpoints
{
    public static IEndpointRouteBuilder MapSyncEndpoints(this IEndpointRouteBuilder endpoints)
    {
        RouteGroupBuilder sync = endpoints.MapGroup("/api/v1/sync")
            .WithTags("Sync");
        sync.MapPost("/operations", PushOperationsAsync);
        sync.MapGet("/changes", PullChangesAsync);
        return endpoints;
    }

    private static async Task<IResult> PushOperationsAsync(
        JsonElement command,
        HttpContext context,
        SyncOperationService operations,
        CancellationToken cancellationToken)
    {
        Guid? userId = PrincipalIdentity.GetUserId(context.User);
        Guid? deviceSessionId = PrincipalIdentity.GetDeviceSessionId(context.User);
        if (!userId.HasValue || !deviceSessionId.HasValue) return Results.Unauthorized();
        if (!SyncCommandParser.TryParse(
                command,
                out IReadOnlyList<SyncOperationCommand> parsed,
                out IReadOnlyDictionary<string, string[]> errors))
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "validation_failed",
                "Sync operation batch is invalid.",
                errors);
        }

        return Results.Ok(await operations.ExecuteAsync(
            userId.Value,
            deviceSessionId.Value,
            parsed,
            context.TraceIdentifier,
            cancellationToken));
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

    private static IResult Problem(
        int status,
        string code,
        string title,
        IReadOnlyDictionary<string, string[]>? errors = null)
    {
        var extensions = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["code"] = code
        };
        if (errors is not null) extensions["errors"] = errors;
        return Results.Problem(
            statusCode: status,
            title: title,
            extensions: extensions);
    }
}
