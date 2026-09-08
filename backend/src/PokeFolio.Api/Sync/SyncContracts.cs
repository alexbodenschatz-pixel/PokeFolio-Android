using System.Text.Json;

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
