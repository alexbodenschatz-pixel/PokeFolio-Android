using Microsoft.EntityFrameworkCore;
using Npgsql;
using PokeFolio.Infrastructure.Catalog;
using PokeFolio.Infrastructure.Persistence;

namespace PokeFolio.Api.Cards;

public sealed class CatalogCardService(
    PokeFolioDbContext database,
    TimeProvider timeProvider)
{
    public async Task<CatalogCardResolutionResponse> ResolveAsync(
        ResolveCatalogCardCommand command,
        CancellationToken cancellationToken)
    {
        ResolveCatalogCardCommand normalized = CatalogCardValidator.Normalize(command);
        CatalogCard? existing = await FindByProviderAsync(
            normalized.Provider!,
            normalized.ProviderCardId!,
            cancellationToken);
        if (existing is not null)
        {
            return Resolution(existing, normalized, created: false);
        }

        DateTimeOffset now = timeProvider.GetUtcNow();
        var card = new CatalogCard
        {
            Id = Guid.NewGuid(),
            Provider = normalized.Provider!,
            ProviderCardId = normalized.ProviderCardId!,
            Tcg = normalized.Tcg!,
            Name = normalized.Name!,
            SetCode = normalized.SetCode!,
            Number = normalized.Number!,
            CreatedAt = now,
            UpdatedAt = now
        };
        database.Cards.Add(card);
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            return Resolution(card, normalized, created: true);
        }
        catch (DbUpdateException error) when (
            error.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation
            })
        {
            database.Entry(card).State = EntityState.Detached;
            CatalogCard winner = await FindByProviderAsync(
                    normalized.Provider!,
                    normalized.ProviderCardId!,
                    cancellationToken)
                ?? throw new InvalidOperationException(
                    "Catalog provider identity conflicted but its winning row is unavailable.",
                    error);
            return Resolution(winner, normalized, created: false);
        }
    }

    public async Task<CatalogCardResponse?> FindAsync(
        Guid cardId,
        CancellationToken cancellationToken)
    {
        if (cardId == Guid.Empty) return null;
        CatalogCard? card = await database.Cards
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == cardId, cancellationToken);
        return card is null ? null : ToResponse(card);
    }

    private Task<CatalogCard?> FindByProviderAsync(
        string provider,
        string providerCardId,
        CancellationToken cancellationToken) => database.Cards
        .AsNoTracking()
        .SingleOrDefaultAsync(card =>
            card.Provider == provider &&
            card.ProviderCardId == providerCardId,
            cancellationToken);

    private static CatalogCardResolutionResponse Resolution(
        CatalogCard card,
        ResolveCatalogCardCommand command,
        bool created) => new(
            ToResponse(card),
            created,
            MetadataMatches(card, command));

    private static bool MetadataMatches(
        CatalogCard card,
        ResolveCatalogCardCommand command) =>
        string.Equals(card.Provider, command.Provider, StringComparison.Ordinal) &&
        string.Equals(card.ProviderCardId, command.ProviderCardId, StringComparison.Ordinal) &&
        string.Equals(card.Tcg, command.Tcg, StringComparison.Ordinal) &&
        string.Equals(card.Name, command.Name, StringComparison.Ordinal) &&
        string.Equals(card.SetCode, command.SetCode, StringComparison.Ordinal) &&
        string.Equals(card.Number, command.Number, StringComparison.Ordinal);

    private static CatalogCardResponse ToResponse(CatalogCard card) => new(
        card.Id,
        card.Provider,
        card.ProviderCardId,
        card.Tcg,
        card.Name,
        card.SetCode,
        card.Number,
        card.CreatedAt,
        card.UpdatedAt);
}
