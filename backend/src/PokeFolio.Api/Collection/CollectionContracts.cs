namespace PokeFolio.Api.Collection;

public sealed record CreateHoldingCommand(
    Guid Id,
    Guid CardId,
    Guid? VariantId,
    string? Language,
    string? Variant,
    string? Condition,
    int Quantity,
    string? Notes);

public sealed record QuantityDeltaCommand(
    Guid OperationId,
    int Delta);

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

public sealed record CollectionMutationFailure(
    int Status,
    string Code,
    string Title,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public sealed record CollectionMutationResult(
    CollectionHoldingResponse? Holding,
    CollectionMutationFailure? Failure,
    bool Replayed = false)
{
    public static CollectionMutationResult Success(
        CollectionHoldingResponse holding,
        bool replayed = false) => new(holding, null, replayed);

    public static CollectionMutationResult Failed(CollectionMutationFailure failure) =>
        new(null, failure);
}
