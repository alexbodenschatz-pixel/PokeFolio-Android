namespace PokeFolio.Api.Collection;

public sealed record CollectionHoldingResponse(
    Guid Id,
    Guid CardId,
    Guid? VariantId,
    string Language,
    string Variant,
    string Condition,
    int Quantity,
    string? Notes,
    long Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record CollectionPageResponse(
    IReadOnlyList<CollectionHoldingResponse> Items,
    string? NextCursor);
