using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Api.Auth;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class AuthCommandValidatorTests
{
    private static readonly string[] InvalidRegistrationFields =
        ["email", "password", "deviceName", "platform"];

    [TestMethod]
    public void RegistrationRejectsInvalidIdentityAndDeviceFieldsTogether()
    {
        IReadOnlyDictionary<string, string[]> errors = AuthCommandValidator.Validate(
            new RegisterCommand("not-an-email", "short", " ", "unsupported"));

        CollectionAssert.AreEquivalent(
            InvalidRegistrationFields,
            errors.Keys.ToArray());
    }

    [TestMethod]
    public void SupportedPlatformAndUserFacingFieldsAreNormalizedPredictably()
    {
        var command = new RegisterCommand(
            "  collector@example.test ",
            "A secure PokeFolio password 1!",
            "  Pixel Phone  ",
            " AnDrOiD ");

        Assert.HasCount(0, AuthCommandValidator.Validate(command));
        Assert.AreEqual("collector@example.test", AuthCommandValidator.NormalizeEmail(command.Email!));
        Assert.AreEqual("Pixel Phone", AuthCommandValidator.NormalizeDeviceName(command.DeviceName!));
        Assert.AreEqual("android", AuthCommandValidator.NormalizePlatform(command.Platform!));
    }

    [TestMethod]
    public void RefreshTokenInputIsBoundedBeforeHashing()
    {
        Assert.IsTrue(AuthCommandValidator.Validate(new RefreshCommand("too-short")).ContainsKey("refreshToken"));
        Assert.HasCount(0, AuthCommandValidator.Validate(new RefreshCommand(new string('a', 64))));
        Assert.IsTrue(AuthCommandValidator.Validate(new RefreshCommand(new string('a', 1025)))
            .ContainsKey("refreshToken"));
    }
}
