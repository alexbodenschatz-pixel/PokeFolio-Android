using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace PokeFolio.Api.Auth;

public sealed class PasswordResetTokenService(
    PasswordResetOptions options,
    TimeProvider timeProvider)
{
    private const int TokenBytes = 32;

    public PasswordResetTokenMaterial Create()
    {
        string plaintext = WebEncoders.Base64UrlEncode(
            RandomNumberGenerator.GetBytes(TokenBytes));
        return new PasswordResetTokenMaterial(
            plaintext,
            Hash(plaintext),
            timeProvider.GetUtcNow().AddMinutes(options.TokenMinutes));
    }

    public static string Hash(string plaintext)
    {
        if (string.IsNullOrWhiteSpace(plaintext) || plaintext.Length is < 32 or > 512)
        {
            throw new ArgumentException(
                "Password reset token has an invalid length.",
                nameof(plaintext));
        }

        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(plaintext));
        return Convert.ToHexStringLower(hash);
    }
}

public sealed record PasswordResetTokenMaterial(
    string Plaintext,
    string Hash,
    DateTimeOffset ExpiresAt);
