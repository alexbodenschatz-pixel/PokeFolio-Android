using System.Security.Claims;
using Microsoft.IdentityModel.JsonWebTokens;

namespace PokeFolio.Api.Security;

public static class PrincipalIdentity
{
    public static Guid? GetUserId(ClaimsPrincipal? principal) =>
        ParseGuidClaim(principal, JwtRegisteredClaimNames.Sub, ClaimTypes.NameIdentifier);

    public static Guid? GetDeviceSessionId(ClaimsPrincipal? principal) =>
        ParseGuidClaim(principal, JwtRegisteredClaimNames.Sid);

    private static Guid? ParseGuidClaim(
        ClaimsPrincipal? principal,
        string claimType,
        string? fallbackClaimType = null)
    {
        string? value = principal?.FindFirstValue(claimType);
        if (value is null && fallbackClaimType is not null)
        {
            value = principal?.FindFirstValue(fallbackClaimType);
        }
        return Guid.TryParse(value, out Guid id) && id != Guid.Empty ? id : null;
    }
}
