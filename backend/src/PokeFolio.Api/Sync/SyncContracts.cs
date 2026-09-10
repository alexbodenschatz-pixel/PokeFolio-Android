using System.Text.Json;
using System.Text.Json.Serialization;
using PokeFolio.Api.Collection;

namespace PokeFolio.Api.Sync;

public sealed record SyncChangeResponse(
    long Sequence,
    string EntityType,
    Guid EntityId,
    string Action,
    long Version,
    JsonElement? Payload,
    DateTimeOffset OccurredAt);

public sealed record SyncChangePageResponse(
    IReadOnlyList<SyncChangeResponse> Changes,
    string NextCursor,
    bool HasMore);

public sealed record SyncOperationBatchCommand(
    IReadOnlyList<SyncOperationCommand?>? Operations);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(SyncHoldingCreateOperationCommand), "holding.create")]
[JsonDerivedType(typeof(SyncQuantityDeltaOperationCommand), "holding.quantityDelta")]
[JsonDerivedType(typeof(SyncHoldingUpdateOperationCommand), "holding.update")]
[JsonDerivedType(typeof(SyncHoldingDeleteOperationCommand), "holding.delete")]
public abstract record SyncOperationCommand(Guid OperationId);

public sealed record SyncHoldingCreateOperationCommand(
    Guid OperationId,
    CreateHoldingCommand? Holding) : SyncOperationCommand(OperationId);

public sealed record SyncQuantityDeltaOperationCommand(
    Guid OperationId,
    Guid HoldingId,
    int Delta) : SyncOperationCommand(OperationId);

public sealed record SyncHoldingUpdateOperationCommand(
    Guid OperationId,
    Guid HoldingId,
    long BaseVersion,
    JsonElement Changes) : SyncOperationCommand(OperationId);

public sealed record SyncHoldingDeleteOperationCommand(
    Guid OperationId,
    Guid HoldingId,
    long BaseVersion) : SyncOperationCommand(OperationId);

public sealed record SyncOperationProblemResponse(
    string Type,
    string Title,
    int Status,
    string Code,
    string CorrelationId,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public sealed record SyncOperationResultResponse(
    Guid OperationId,
    string Status,
    CollectionHoldingResponse? Entity,
    SyncOperationProblemResponse? Problem);

public sealed record SyncOperationResultBatchResponse(
    IReadOnlyList<SyncOperationResultResponse> Results);
