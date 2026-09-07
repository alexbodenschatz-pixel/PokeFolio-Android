using Microsoft.EntityFrameworkCore;
using PokeFolio.Domain.Collection;
using PokeFolio.Infrastructure.Persistence;

namespace PokeFolio.Api.Collection;

public sealed class CollectionReadService(PokeFolioDbContext database)
{
    public async Task<CollectionPageResponse> ListAsync(
        Guid userId,
        Guid? afterId,
        int pageSize,
        CancellationToken cancellationToken)
    {
        IQueryable<CollectionHolding> query = database.CollectionHoldings
            .AsNoTracking()
            .Where(holding => holding.UserId == userId);
        if (afterId.HasValue)
        {
            Guid cursorId = afterId.Value;
            query = query.Where(holding => holding.Id.CompareTo(cursorId) > 0);
        }

        CollectionHolding[] page = await query
            .OrderBy(holding => holding.Id)
            .Take(pageSize + 1)
            .ToArrayAsync(cancellationToken);
        bool hasMore = page.Length > pageSize;
        CollectionHolding[] visible = hasMore ? page[..pageSize] : page;
        string? nextCursor = hasMore ? CollectionCursor.Encode(visible[^1].Id) : null;
        return new CollectionPageResponse(visible.Select(ToResponse).ToArray(), nextCursor);
    }

    public async Task<CollectionHoldingResponse?> FindAsync(
        Guid userId,
        Guid holdingId,
        CancellationToken cancellationToken)
    {
        CollectionHolding? holding = await database.CollectionHoldings
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.UserId == userId && item.Id == holdingId,
                cancellationToken);
        return holding is null ? null : ToResponse(holding);
    }

    private static CollectionHoldingResponse ToResponse(CollectionHolding holding) => new(
        holding.Id,
        holding.CardId,
        holding.VariantId,
        holding.Language,
        holding.Variant,
        holding.Condition,
        holding.Quantity,
        holding.Notes,
        holding.Version,
        holding.CreatedAt,
        holding.UpdatedAt);
}
