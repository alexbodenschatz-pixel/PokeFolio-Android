using PokeFolio.Api.Security;

namespace PokeFolio.Api.Collection;

public static class CollectionEndpoints
{
    public static IEndpointRouteBuilder MapCollectionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        RouteGroupBuilder collection = endpoints.MapGroup("/api/v1/collection")
            .WithTags("Collection");

        collection.MapGet("", ListAsync);
        collection.MapPost("", CreateAsync);
        collection.MapGet("/{holdingId:guid}", GetAsync);
        collection.MapPost("/{holdingId:guid}/quantity-delta", ApplyQuantityDeltaAsync);
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

    private static async Task<IResult> CreateAsync(
        CreateHoldingCommand command,
        HttpContext context,
        CollectionMutationService collection,
        CancellationToken cancellationToken)
    {
        if (!TryGetMutationIdentity(
                context,
                out Guid userId,
                out Guid deviceSessionId,
                out Guid operationId,
                out IResult? error))
        {
            return error!;
        }

        CollectionMutationResult result = await collection.CreateAsync(
            userId,
            deviceSessionId,
            operationId,
            command,
            cancellationToken);
        if (result.Holding is null) return Problem(result.Failure!);

        context.Response.Headers.ETag = HoldingEtag.Format(result.Holding.Version);
        return Results.Created($"/api/v1/collection/{result.Holding.Id}", result.Holding);
    }

    private static async Task<IResult> ApplyQuantityDeltaAsync(
        Guid holdingId,
        QuantityDeltaCommand command,
        HttpContext context,
        CollectionMutationService collection,
        CancellationToken cancellationToken)
    {
        if (!TryGetMutationIdentity(
                context,
                out Guid userId,
                out Guid deviceSessionId,
                out Guid operationId,
                out IResult? error))
        {
            return error!;
        }

        CollectionMutationResult result = await collection.ApplyQuantityDeltaAsync(
            userId,
            deviceSessionId,
            holdingId,
            operationId,
            command,
            cancellationToken);
        if (result.Holding is null) return Problem(result.Failure!);

        context.Response.Headers.ETag = HoldingEtag.Format(result.Holding.Version);
        return Results.Ok(result.Holding);
    }

    private static bool TryGetMutationIdentity(
        HttpContext context,
        out Guid userId,
        out Guid deviceSessionId,
        out Guid operationId,
        out IResult? error)
    {
        Guid? authenticatedUserId = PrincipalIdentity.GetUserId(context.User);
        Guid? authenticatedDeviceId = PrincipalIdentity.GetDeviceSessionId(context.User);
        userId = authenticatedUserId.GetValueOrDefault();
        deviceSessionId = authenticatedDeviceId.GetValueOrDefault();
        operationId = Guid.Empty;
        if (!authenticatedUserId.HasValue || !authenticatedDeviceId.HasValue)
        {
            error = Results.Unauthorized();
            return false;
        }

        if (!context.Request.Headers.TryGetValue("Idempotency-Key", out var values) ||
            values.Count != 1 ||
            !Guid.TryParse(values[0], out operationId) ||
            operationId == Guid.Empty)
        {
            error = Problem(
                StatusCodes.Status400BadRequest,
                "invalid_idempotency_key",
                "Idempotency-Key must contain one non-empty UUID.");
            return false;
        }

        error = null;
        return true;
    }

    private static IResult Problem(CollectionMutationFailure failure)
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
