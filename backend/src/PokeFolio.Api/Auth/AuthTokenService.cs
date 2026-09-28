using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace PokeFolio.Api.Auth;

public sealed class AuthTokenService(
    AuthTokenOptions options,
    TimeProvider timeProvider)
{
    private const int RefreshTokenBytes = 64;
    private readonly JsonWebTokenHandler tokenHandler = new()
    {
        SetDefaultTimesOnTokenCreation = false
    };
    private readonly SigningCredentials signingCredentials = new(
        options.CreateSigningKey(),
        SecurityAlgorithms.HmacSha256);

    public AccessTokenResult CreateAccessToken(Guid userId, Guid deviceSessionId, string platform)
    {
        if (userId == Guid.Empty) throw new ArgumentException("User identifier is required.", nameof(userId));
        if (deviceSessionId == Guid.Empty)
        {
            throw new ArgumentException("Device session identifier is required.", nameof(deviceSessionId));
        }

        string normalizedPlatform = platform?.Trim().ToLowerInvariant() ?? string.Empty;
        if (normalizedPlatform.Length is < 2 or > 24)
        {
            throw new ArgumentException("Platform must contain 2 to 24 characters.", nameof(platform));
        }

        DateTimeOffset issuedAt = timeProvider.GetUtcNow();
        DateTimeOffset expiresAt = issuedAt.AddMinutes(options.AccessTokenMinutes);
        var descriptor = new SecurityTokenDescriptor
        {
            Audience = options.Audience,
            Issuer = options.Issuer,
            IssuedAt = issuedAt.UtcDateTime,
            NotBefore = issuedAt.UtcDateTime,
            Expires = expiresAt.UtcDateTime,
            SigningCredentials = signingCredentials,
            Claims = new Dictionary<string, object>
            {
                [JwtRegisteredClaimNames.Sub] = userId.ToString("D"),
                [JwtRegisteredClaimNames.Jti] = Guid.NewGuid().ToString("D"),
                [JwtRegisteredClaimNames.Sid] = deviceSessionId.ToString("D"),
                ["client_id"] = $"pokefolio-{normalizedPlatform}"
            }
        };

        return new AccessTokenResult(tokenHandler.CreateToken(descriptor), expiresAt);
    }

    public RefreshTokenMaterial CreateRefreshToken()
    {
        string plaintext = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(RefreshTokenBytes));
        return new RefreshTokenMaterial(
            plaintext,
            HashRefreshToken(plaintext),
            timeProvider.GetUtcNow().AddDays(options.RefreshTokenDays));
    }

    public static string HashRefreshToken(string plaintext)
    {
        if (string.IsNullOrWhiteSpace(plaintext) || plaintext.Length > 1024)
        {
            throw new ArgumentException("Refresh token has an invalid length.", nameof(plaintext));
        }

        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(plaintext));
        return Convert.ToHexStringLower(hash);
    }
}

public sealed record AccessTokenResult(string Token, DateTimeOffset ExpiresAt);

public sealed record RefreshTokenMaterial(
    string Plaintext,
    string Hash,
    DateTimeOffset ExpiresAt);
