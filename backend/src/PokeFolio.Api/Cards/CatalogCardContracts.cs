namespace PokeFolio.Api.Cards;

public sealed record ResolveCatalogCardCommand(
    string? Provider,
    string? ProviderCardId,
    string? Tcg,
    string? Name,
    string? SetCode,
    string? Number);

public sealed record CatalogCardResponse(
    Guid Id,
    string Provider,
    string ProviderCardId,
    string Tcg,
    string Name,
    string SetCode,
    string Number,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record CatalogCardResolutionResponse(
    CatalogCardResponse Card,
    bool Created,
    bool MetadataMatched);
