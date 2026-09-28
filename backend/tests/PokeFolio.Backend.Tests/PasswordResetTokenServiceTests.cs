using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Api.Auth;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class PasswordResetTokenServiceTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 9, 22, 8, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void TokensAreRandomHashedAndShortLived()
    {
        var options = new PasswordResetOptions { TokenMinutes = 30 };
        var service = new PasswordResetTokenService(options, new FixedTimeProvider(Now));

        PasswordResetTokenMaterial first = service.Create();
        PasswordResetTokenMaterial second = service.Create();

        Assert.AreNotEqual(first.Plaintext, second.Plaintext);
        Assert.AreNotEqual(first.Hash, second.Hash);
        Assert.AreEqual(43, first.Plaintext.Length);
        Assert.AreEqual(64, first.Hash.Length);
        Assert.AreEqual(first.Hash, PasswordResetTokenService.Hash(first.Plaintext));
        Assert.AreEqual(Now.AddMinutes(30), first.ExpiresAt);
        Assert.IsFalse(first.Hash.Contains(first.Plaintext, StringComparison.Ordinal));
    }

    [TestMethod]
    public void DeliveryConfigurationFailsClosedWhenPartialOrInsecure()
    {
        new PasswordResetOptions().Validate();

        var partial = new PasswordResetOptions { SmtpHost = "smtp.example.test" };
        Assert.ThrowsExactly<InvalidOperationException>(partial.Validate);

        var insecure = new PasswordResetOptions
        {
            PublicResetUrl = "http://example.test/reset",
            SmtpHost = "smtp.example.test",
            FromAddress = "accounts@example.test"
        };
        Assert.ThrowsExactly<InvalidOperationException>(insecure.Validate);

        PasswordResetOptions configured = ConfiguredOptions();
        configured.Validate();
        Assert.IsTrue(configured.DeliveryConfigured);
        string resetLink = configured.CreateResetLink(
            "collector+reset@example.test",
            "opaque/token+value");
        var resetUri = new Uri(resetLink);
        Assert.AreEqual(string.Empty, resetUri.Query);
        StringAssert.Contains(resetUri.Fragment, "email=collector%2Breset%40example.test");
        StringAssert.Contains(resetUri.Fragment, "token=opaque%2Ftoken%2Bvalue");
    }

    private static PasswordResetOptions ConfiguredOptions() => new()
    {
        PublicResetUrl = "https://app.example.test/reset-password",
        SmtpHost = "smtp.example.test",
        FromAddress = "accounts@example.test"
    };

    private sealed class FixedTimeProvider(DateTimeOffset value) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => value;
    }
}
