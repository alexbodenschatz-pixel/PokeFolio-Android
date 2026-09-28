namespace PokeFolio.Infrastructure.Identity;

public sealed class PasswordResetToken
{
    public required string TokenHash { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
    public ApplicationUser User { get; set; } = null!;
}
