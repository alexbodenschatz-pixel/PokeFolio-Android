using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PokeFolio.Infrastructure.Persistence;
using PokeFolio.Infrastructure.Sync;

namespace PokeFolio.Api.Sync;

public sealed class SyncChangeReadService(PokeFolioDbContext database)
{
    public async Task<SyncChangePageResponse> ListAsync(
        Guid userId,
        long afterSequence,
        int pageSize,
        CancellationToken cancellationToken)
    {
        UserChange[] page = await database.UserChanges
            .AsNoTracking()
            .Where(change => change.UserId == userId && change.Sequence > afterSequence)
            .OrderBy(change => change.Sequence)
            .Take(pageSize + 1)
            .ToArrayAsync(cancellationToken);
        bool hasMore = page.Length > pageSize;
        UserChange[] visible = hasMore ? page[..pageSize] : page;
        long nextSequence = visible.Length == 0 ? afterSequence : visible[^1].Sequence;
        return new SyncChangePageResponse(
            visible.Select(ToResponse).ToArray(),
            SyncCursor.Encode(nextSequence),
            hasMore);
    }

    private static SyncChangeResponse ToResponse(UserChange change) => new(
        change.Sequence,
        change.EntityType,
        change.EntityId,
        change.Action,
        change.Version,
        ParsePayload(change.PayloadJson),
        change.OccurredAt);

    private static JsonElement? ParsePayload(string? payloadJson)
    {
        if (payloadJson is null) return null;
        JsonElement payload = JsonSerializer.Deserialize<JsonElement>(payloadJson);
        if (payload.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("Stored sync change payload must be a JSON object.");
        }
        return payload;
    }
}
