using PokeFolio.Api.Cards;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class CatalogCardValidatorTests
{
    [TestMethod]
    [DataRow("pokemon-tcg-api", "pokemon")]
    [DataRow("tcgdex", "pokemon")]
    [DataRow("ygoprodeck", "yugioh")]
    [DataRow("optcgapi", "onepiece")]
    public void SupportedProviderMustMatchItsTcg(string provider, string tcg)
    {
        var command = ValidCommand(provider, tcg);

        Assert.HasCount(0, CatalogCardValidator.Validate(command));
        ResolveCatalogCardCommand normalized = CatalogCardValidator.Normalize(
            command with
            {
                Provider = provider.ToUpperInvariant(),
                ProviderCardId = " SV8-141 ",
                Tcg = tcg.ToUpperInvariant()
            });
        Assert.AreEqual(provider, normalized.Provider);
        Assert.AreEqual("sv8-141", normalized.ProviderCardId);
        Assert.AreEqual(tcg, normalized.Tcg);
    }

    [TestMethod]
    public void RejectsUnsupportedProviderAndCrossTcgIdentity()
    {
        IReadOnlyDictionary<string, string[]> unsupported = CatalogCardValidator.Validate(
            ValidCommand("untrusted-client", "pokemon"));
        IReadOnlyDictionary<string, string[]> mismatch = CatalogCardValidator.Validate(
            ValidCommand("ygoprodeck", "pokemon"));

        Assert.IsTrue(unsupported.ContainsKey("provider"));
        Assert.IsTrue(mismatch.ContainsKey("tcg"));
    }

    [TestMethod]
    public void RejectsUnsafeIdentifierAndControlOrEmptyMetadata()
    {
        IReadOnlyDictionary<string, string[]> errors = CatalogCardValidator.Validate(
            new ResolveCatalogCardCommand(
                "tcgdex",
                "../../card?secret=value",
                "pokemon",
                "Pika\0chu",
                " ",
                new string('1', 65)));

        Assert.HasCount(4, errors);
        Assert.IsTrue(errors.ContainsKey("providerCardId"));
        Assert.IsTrue(errors.ContainsKey("name"));
        Assert.IsTrue(errors.ContainsKey("setCode"));
        Assert.IsTrue(errors.ContainsKey("number"));
    }

    private static ResolveCatalogCardCommand ValidCommand(string provider, string tcg) => new(
        provider,
        "sv8-141",
        tcg,
        "Pikachu",
        "SV8",
        "141/191");
}
