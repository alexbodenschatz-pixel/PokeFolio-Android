using PokeFolio.Api.Security;

namespace PokeFolio.Api.Devices;

public static class DeviceEndpoints
{
    public static IEndpointRouteBuilder MapDeviceEndpoints(this IEndpointRouteBuilder endpoints)
    {
        RouteGroupBuilder devices = endpoints.MapGroup("/api/v1/devices")
            .WithTags("Devices");

        devices.MapGet("", ListAsync);
        devices.MapDelete("", RevokeOtherDevicesAsync);
        devices.MapDelete("/{deviceId:guid}", RevokeDeviceAsync);
        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        HttpContext context,
        DeviceManagementService devices,
        CancellationToken cancellationToken)
    {
        if (!TryGetIdentity(context, out Guid userId, out Guid currentDeviceId))
        {
            return Results.Unauthorized();
        }

        return Results.Ok(await devices.ListActiveAsync(
            userId,
            currentDeviceId,
            cancellationToken));
    }

    private static async Task<IResult> RevokeOtherDevicesAsync(
        HttpContext context,
        DeviceManagementService devices,
        CancellationToken cancellationToken)
    {
        if (!TryGetIdentity(context, out Guid userId, out Guid currentDeviceId))
        {
            return Results.Unauthorized();
        }

        await devices.RevokeOtherDevicesAsync(userId, currentDeviceId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> RevokeDeviceAsync(
        Guid deviceId,
        HttpContext context,
        DeviceManagementService devices,
        CancellationToken cancellationToken)
    {
        if (!TryGetIdentity(context, out Guid userId, out Guid currentDeviceId))
        {
            return Results.Unauthorized();
        }

        return await devices.RevokeAsync(
            userId,
            currentDeviceId,
            deviceId,
            cancellationToken) switch
        {
            RevokeDeviceResult.Revoked => Results.NoContent(),
            RevokeDeviceResult.NotFound => Problem(
                StatusCodes.Status404NotFound,
                "device_not_found",
                "The selected device was not found."),
            RevokeDeviceResult.CurrentDeviceRequiresLogout => Problem(
                StatusCodes.Status409Conflict,
                "current_device_requires_logout",
                "Use logout to revoke the current device session."),
            _ => throw new InvalidOperationException("Unknown device revocation result.")
        };
    }

    private static bool TryGetIdentity(
        HttpContext context,
        out Guid userId,
        out Guid currentDeviceId)
    {
        Guid? authenticatedUserId = PrincipalIdentity.GetUserId(context.User);
        Guid? authenticatedDeviceId = PrincipalIdentity.GetDeviceSessionId(context.User);
        userId = authenticatedUserId.GetValueOrDefault();
        currentDeviceId = authenticatedDeviceId.GetValueOrDefault();
        return authenticatedUserId.HasValue && authenticatedDeviceId.HasValue;
    }

    private static IResult Problem(int status, string code, string title) => Results.Problem(
        statusCode: status,
        title: title,
        extensions: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["code"] = code
        });
}
