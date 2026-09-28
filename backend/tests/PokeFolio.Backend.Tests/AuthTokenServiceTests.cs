using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Api.Auth;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class AuthTokenServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 7, 12, 0, 0, TimeSpan.Zero);
    private static readonly byte[] SigningKeyBytes = Enumerable.Range(1, 32)
        .Select(value => (byte)value)
        .ToArray();

    [TestMethod]
    public async Task AccessTokenIsSignedAndContainsOnlyStableIdentityClaims()
    {
        AuthTokenOptions options = CreateOptions();
        var service = new AuthTokenService(options, new FixedTimeProvider(Now));
        Guid userId = Guid.NewGuid();
        Guid deviceId = Guid.NewGuid();

        AccessTokenResult access = service.CreateAccessToken(userId, deviceId, "Android");
        TokenValidationResult validation = await new JsonWebTokenHandler().ValidateTokenAsync(
            access.Token,
            new TokenValidationParameters
            {
                ClockSkew = TimeSpan.Zero,
                IssuerSigningKey = options.CreateSigningKey(),
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                ValidAudience = options.Audience,
                ValidIssuer = options.Issuer,
                ValidateAudience = true,
                ValidateIssuer = true,
                ValidateIssuerSigningKey = true,
                ValidateLifetime = true,
                LifetimeValidator = (notBefore, expires, _, _) =>
                    notBefore <= Now.UtcDateTime && expires >= Now.UtcDateTime
            });

        Assert.IsTrue(validation.IsValid, validation.Exception?.Message);
        Assert.AreEqual(userId.ToString("D"), validation.Claims[JwtRegisteredClaimNames.Sub]);
        Assert.AreEqual(deviceId.ToString("D"), validation.Claims[JwtRegisteredClaimNames.Sid]);
        Assert.AreEqual("pokefolio-android", validation.Claims["client_id"]);
        Assert.AreEqual(Now.AddMinutes(10), access.ExpiresAt);
        Assert.IsFalse(validation.Claims.ContainsKey("email"));
    }

    [TestMethod]
    public void RefreshTokensAreRandomAndOnlyTheirStableHashNeedsPersistence()
    {
        var service = new AuthTokenService(CreateOptions(), new FixedTimeProvider(Now));

        RefreshTokenMaterial first = service.CreateRefreshToken();
        RefreshTokenMaterial second = service.CreateRefreshToken();

        Assert.AreNotEqual(first.Plaintext, second.Plaintext);
        Assert.AreNotEqual(first.Hash, second.Hash);
        Assert.AreEqual(64, first.Hash.Length);
        Assert.AreEqual(first.Hash, AuthTokenService.HashRefreshToken(first.Plaintext));
        Assert.AreEqual(Now.AddDays(30), first.ExpiresAt);
        Assert.IsFalse(first.Hash.Contains(first.Plaintext, StringComparison.Ordinal));
    }

    [TestMethod]
    public void SigningKeyMustBeBase64AndAtLeast256Bits()
    {
        AuthTokenOptions malformed = CreateOptions("not-base64");
        AuthTokenOptions tooShort = CreateOptions(Convert.ToBase64String(SigningKeyBytes[..16]));

        Assert.ThrowsExactly<InvalidOperationException>(malformed.Validate);
        Assert.ThrowsExactly<InvalidOperationException>(tooShort.Validate);
    }

    private static AuthTokenOptions CreateOptions(string? signingKey = null) => new()
    {
        Issuer = "pokefolio-tests",
        Audience = "pokefolio-test-clients",
        SigningKey = signingKey ?? Convert.ToBase64String(SigningKeyBytes),
        SigningKeyId = "test-key",
        AccessTokenMinutes = 10,
        RefreshTokenDays = 30
    };

    private sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => value;
    }
}
