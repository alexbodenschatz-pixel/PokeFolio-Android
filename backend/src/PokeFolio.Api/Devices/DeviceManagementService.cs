using Microsoft.EntityFrameworkCore;
using PokeFolio.Api.Auth;
using PokeFolio.Infrastructure.Persistence;

namespace PokeFolio.Api.Devices;

public sealed class DeviceManagementService(
    PokeFolioDbContext database,
    TimeProvider timeProvider)
{
    public async Task<IReadOnlyList<DeviceResponse>> ListActiveAsync(
        Guid userId,
        Guid currentDeviceId,
        CancellationToken cancellationToken)
    {
        DateTimeOffset now = timeProvider.GetUtcNow();
        return await database.DeviceSessions
            .AsNoTracking()
            .Where(device =>
                device.UserId == userId &&
                device.RevokedAt == null &&
                device.ExpiresAt > now)
            .OrderByDescending(device => device.LastSeenAt)
            .ThenBy(device => device.Id)
            .Select(device => new DeviceResponse(
                device.Id,
                device.DeviceName,
                device.Platform,
                device.CreatedAt,
                device.LastSeenAt,
                device.Id == currentDeviceId))
            .ToArrayAsync(cancellationToken);
    }

    public async Task RevokeOtherDevicesAsync(
        Guid userId,
        Guid currentDeviceId,
        CancellationToken cancellationToken)
    {
        DateTimeOffset now = timeProvider.GetUtcNow();
        await database.DeviceSessions
            .Where(device =>
                device.UserId == userId &&
                device.Id != currentDeviceId &&
                device.RevokedAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(device => device.RevokedAt, now),
                cancellationToken);
    }

    public async Task<RevokeDeviceResult> RevokeAsync(
        Guid userId,
        Guid currentDeviceId,
        Guid targetDeviceId,
        CancellationToken cancellationToken)
    {
        if (targetDeviceId == currentDeviceId)
        {
            return RevokeDeviceResult.CurrentDeviceRequiresLogout;
        }

        DateTimeOffset now = timeProvider.GetUtcNow();
        int updated = await database.DeviceSessions
            .Where(device =>
                device.UserId == userId &&
                device.Id == targetDeviceId &&
                device.RevokedAt == null &&
                device.ExpiresAt > now)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(device => device.RevokedAt, now),
                cancellationToken);

        return updated == 1 ? RevokeDeviceResult.Revoked : RevokeDeviceResult.NotFound;
    }
}

public enum RevokeDeviceResult
{
    Revoked,
    NotFound,
    CurrentDeviceRequiresLogout
}
