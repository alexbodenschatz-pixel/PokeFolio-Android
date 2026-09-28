namespace PokeFolio.Infrastructure.Identity;

public sealed class DeviceSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid TokenFamilyId { get; set; }
    public string RefreshTokenHash { get; set; } = string.Empty;
    public string DeviceName { get; set; } = string.Empty;
    public string Platform { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public ApplicationUser User { get; set; } = null!;
}
