namespace PokeFolio.Infrastructure.Identity;

public sealed class ConsumedRefreshToken
{
    public string TokenHash { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public Guid DeviceSessionId { get; set; }
    public Guid TokenFamilyId { get; set; }
    public DateTimeOffset ConsumedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public ApplicationUser User { get; set; } = null!;
    public DeviceSession DeviceSession { get; set; } = null!;
}
