using Microsoft.IdentityModel.Tokens;

namespace PokeFolio.Api.Auth;

public sealed class AuthTokenOptions
{
    public const string SectionName = "Auth";

    public string Issuer { get; init; } = string.Empty;
    public string Audience { get; init; } = string.Empty;
    public string SigningKey { get; init; } = string.Empty;
    public string SigningKeyId { get; init; } = string.Empty;
    public int AccessTokenMinutes { get; init; } = 10;
    public int RefreshTokenDays { get; init; } = 30;

    public SymmetricSecurityKey CreateSigningKey()
    {
        byte[] keyBytes;
        try
        {
            keyBytes = Convert.FromBase64String(SigningKey);
        }
        catch (FormatException error)
        {
            throw new InvalidOperationException(
                "Auth:SigningKey must be a base64-encoded secret.",
                error);
        }

        if (keyBytes.Length < 32)
        {
            throw new InvalidOperationException("Auth:SigningKey must contain at least 256 bits.");
        }

        return new SymmetricSecurityKey(keyBytes) { KeyId = SigningKeyId };
    }

    public void Validate()
    {
        RequireText(Issuer, nameof(Issuer), 200);
        RequireText(Audience, nameof(Audience), 200);
        RequireText(SigningKeyId, nameof(SigningKeyId), 100);
        if (AccessTokenMinutes is < 2 or > 60)
        {
            throw new InvalidOperationException("Auth:AccessTokenMinutes must be between 2 and 60.");
        }
        if (RefreshTokenDays is < 7 or > 180)
        {
            throw new InvalidOperationException("Auth:RefreshTokenDays must be between 7 and 180.");
        }
        _ = CreateSigningKey();
    }

    private static void RequireText(string value, string name, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
        {
            throw new InvalidOperationException($"Auth:{name} is required and limited to {maximumLength} characters.");
        }
    }
}
