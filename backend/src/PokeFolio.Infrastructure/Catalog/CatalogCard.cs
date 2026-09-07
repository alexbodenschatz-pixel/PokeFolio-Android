namespace PokeFolio.Infrastructure.Catalog;

public sealed class CatalogCard
{
    public Guid Id { get; set; }
    public string Tcg { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string ProviderCardId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string SetCode { get; set; } = string.Empty;
    public string Number { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
