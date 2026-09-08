using PokeFolio.Infrastructure.Identity;

namespace PokeFolio.Infrastructure.Sync;

public sealed class ProcessedSyncOperation
{
    public long Id { get; set; }
    public Guid UserId { get; set; }
    public Guid DeviceSessionId { get; set; }
    public Guid OperationId { get; set; }
    public string? OperationKind { get; set; }
    public string? RequestHash { get; set; }
    public string Status { get; set; } = string.Empty;
    public string? ResponseJson { get; set; }
    public DateTimeOffset ProcessedAt { get; set; }
    public ApplicationUser User { get; set; } = null!;
    public DeviceSession DeviceSession { get; set; } = null!;
}
