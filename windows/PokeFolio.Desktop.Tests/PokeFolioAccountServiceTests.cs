using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Backend;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class PokeFolioAccountServiceTests
{
    [TestMethod]
    public void BackendConfigurationAcceptsHttpsAndLoopbackOnly()
    {
        PokeFolioBackendConfiguration https =
            PokeFolioBackendConfiguration.Parse(" https://api.pokefolio.example ");
        PokeFolioBackendConfiguration loopback =
            PokeFolioBackendConfiguration.Parse("http://localhost:5080/");

        Assert.IsTrue(https.IsConfigured);
        Assert.AreEqual("https://api.pokefolio.example/", https.BackendOrigin?.AbsoluteUri);
        Assert.IsTrue(loopback.IsConfigured);
        Assert.AreEqual("http://localhost:5080/", loopback.BackendOrigin?.AbsoluteUri);
        Assert.IsFalse(PokeFolioBackendConfiguration.Parse(
            "http://api.pokefolio.example/").IsConfigured);
        Assert.IsFalse(PokeFolioBackendConfiguration.Parse(
            "https://api.pokefolio.example/api/").IsConfigured);
        Assert.IsFalse(PokeFolioBackendConfiguration.Parse(
            "https://user:credential@api.pokefolio.example/").IsConfigured);
    }

    [TestMethod]
    public async Task MissingConfigurationKeepsLocalAppAvailableWithExplicitStatus()
    {
        PokeFolioBackendConfiguration configuration =
            PokeFolioBackendConfiguration.Parse(null);
        using var service = new PokeFolioAccountService(configuration);

        PokeFolioAccountStatus status = service.GetStatus();
        PokeFolioAuthenticationResult login = await service.LoginAsync(
            "owner@example.test",
            "valid-password",
            "Desktop test");
        PokeFolioApiResponse push = await service.PushSyncOperationsAsync(
            "{\"operations\":[]}");
        PokeFolioApiResponse pull = await service.PullSyncChangesAsync();

        Assert.IsFalse(status.Configured);
        Assert.IsFalse(status.Authenticated);
        Assert.IsNull(status.BackendOrigin);
        Assert.AreEqual("backend_not_configured", login.Problem?.Code);
        Assert.AreEqual(503, login.Problem?.Status);
        Assert.AreEqual("backend_not_configured", push.Problem?.Code);
        Assert.AreEqual(503, push.Status);
        Assert.AreEqual("backend_not_configured", pull.Problem?.Code);
        Assert.AreEqual(503, pull.Status);
    }

    [TestMethod]
    public void InvalidConfigurationDoesNotEchoPotentialCredentials()
    {
        PokeFolioBackendConfiguration configuration =
            PokeFolioBackendConfiguration.Parse(
                "https://account:private-value@api.pokefolio.example/");

        Assert.IsFalse(configuration.IsConfigured);
        Assert.IsNotNull(configuration.Error);
        Assert.IsFalse(configuration.Error.Contains("private-value", StringComparison.Ordinal));
    }

    [TestMethod]
    public void AccountServiceRejectsNullOrInconsistentConfiguration()
    {
        Assert.ThrowsExactly<ArgumentNullException>(() =>
            new PokeFolioAccountService(null!));
        Assert.ThrowsExactly<ArgumentException>(() =>
            new PokeFolioAccountService(new PokeFolioBackendConfiguration(
                new Uri("https://api.pokefolio.example/"),
                "inconsistent")));
    }
}
