namespace PokeFolio.Api.Cards;

public static class CatalogCardEndpoints
{
    public static IEndpointRouteBuilder MapCatalogCardEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        RouteGroupBuilder cards = endpoints.MapGroup("/api/v1/cards")
            .WithTags("Cards");
        cards.MapGet("/{cardId:guid}", FindAsync);
        cards.MapPost("/resolve", ResolveAsync)
            .RequireRateLimiting("catalog-resolve");
        return endpoints;
    }

    private static async Task<IResult> FindAsync(
        Guid cardId,
        CatalogCardService cards,
        CancellationToken cancellationToken)
    {
        CatalogCardResponse? card = await cards.FindAsync(cardId, cancellationToken);
        return card is null
            ? Problem(
                StatusCodes.Status404NotFound,
                "card_not_found",
                "The selected catalog card was not found.")
            : Results.Ok(card);
    }

    private static async Task<IResult> ResolveAsync(
        ResolveCatalogCardCommand command,
        CatalogCardService cards,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<string, string[]> errors = CatalogCardValidator.Validate(command);
        if (errors.Count > 0)
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "validation_failed",
                "Catalog card reference is invalid.",
                errors);
        }

        CatalogCardResolutionResponse resolution = await cards.ResolveAsync(
            command,
            cancellationToken);
        return resolution.Created
            ? Results.Created($"/api/v1/cards/{resolution.Card.Id}", resolution)
            : Results.Ok(resolution);
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
