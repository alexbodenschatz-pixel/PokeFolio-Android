using PokeFolio.Infrastructure.Identity;

namespace PokeFolio.Infrastructure.Sync;

public sealed class UserChange
{
    public long Sequence { get; set; }
    public Guid UserId { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
    public string Action { get; set; } = string.Empty;
    public long Version { get; set; }
    public string? PayloadJson { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public ApplicationUser User { get; set; } = null!;
}
