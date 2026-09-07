using PokeFolio.Api.Security;

namespace PokeFolio.Api.Collection;

public static class CollectionEndpoints
{
    public static IEndpointRouteBuilder MapCollectionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        RouteGroupBuilder collection = endpoints.MapGroup("/api/v1/collection")
            .WithTags("Collection");

        collection.MapGet("", ListAsync);
        collection.MapGet("/{holdingId:guid}", GetAsync);
        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        string? cursor,
        int? limit,
        HttpContext context,
        CollectionReadService collection,
        CancellationToken cancellationToken)
    {
        Guid? userId = PrincipalIdentity.GetUserId(context.User);
        if (!userId.HasValue) return Results.Unauthorized();
        if (!CollectionCursor.TryDecode(cursor, out Guid? afterId))
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "invalid_cursor",
                "Collection cursor is invalid.");
        }

        int pageSize = limit ?? 100;
        if (pageSize is < 1 or > 500)
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "invalid_page_size",
                "Collection page size must be between 1 and 500.");
        }

        return Results.Ok(await collection.ListAsync(
            userId.Value,
            afterId,
            pageSize,
            cancellationToken));
    }

    private static async Task<IResult> GetAsync(
        Guid holdingId,
        HttpContext context,
        CollectionReadService collection,
        CancellationToken cancellationToken)
    {
        Guid? userId = PrincipalIdentity.GetUserId(context.User);
        if (!userId.HasValue) return Results.Unauthorized();

        CollectionHoldingResponse? holding = await collection.FindAsync(
            userId.Value,
            holdingId,
            cancellationToken);
        if (holding is null)
        {
            return Problem(
                StatusCodes.Status404NotFound,
                "holding_not_found",
                "The selected collection holding was not found.");
        }

        context.Response.Headers.ETag = HoldingEtag.Format(holding.Version);
        return Results.Ok(holding);
    }

    private static IResult Problem(int status, string code, string title) => Results.Problem(
        statusCode: status,
        title: title,
        extensions: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["code"] = code
        });
}

internal static class HoldingEtag
{
    public static string Format(long version) => $"\"v{version}\"";
}
