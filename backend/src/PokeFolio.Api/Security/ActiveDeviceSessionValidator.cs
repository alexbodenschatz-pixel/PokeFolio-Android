using Microsoft.EntityFrameworkCore;
using PokeFolio.Infrastructure.Persistence;

namespace PokeFolio.Api.Security;

public sealed class ActiveDeviceSessionValidator(
    PokeFolioDbContext database,
    TimeProvider timeProvider)
{
    public async Task<bool> IsActiveAsync(
        System.Security.Claims.ClaimsPrincipal? principal,
        CancellationToken cancellationToken)
    {
        Guid? userId = PrincipalIdentity.GetUserId(principal);
        Guid? deviceSessionId = PrincipalIdentity.GetDeviceSessionId(principal);
        if (!userId.HasValue || !deviceSessionId.HasValue) return false;

        DateTimeOffset now = timeProvider.GetUtcNow();
        return await database.DeviceSessions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(
                device =>
                    device.Id == deviceSessionId.Value &&
                    device.UserId == userId.Value &&
                    device.RevokedAt == null &&
                    device.ExpiresAt > now,
                cancellationToken);
    }
}
