using PokeFolio.Api.Collection;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class CollectionCommandValidatorTests
{
    private static readonly string[] InvalidCreateFields =
        ["id", "cardId", "variantId", "language", "variant", "condition", "quantity", "notes"];

    [TestMethod]
    public void CreateRejectsEveryInvalidFieldBeforePersistence()
    {
        IReadOnlyDictionary<string, string[]> errors = CollectionCommandValidator.Validate(
            new CreateHoldingCommand(
                Guid.Empty,
                Guid.Empty,
                Guid.Empty,
                "unsupported",
                " ",
                new string('x', 41),
                0,
                new string('x', 10_001)));

        CollectionAssert.AreEquivalent(InvalidCreateFields, errors.Keys.ToArray());
    }

    [TestMethod]
    public void SupportedLanguagesAreNormalizedWithoutChangingTheirScriptVariant()
    {
        var command = new CreateHoldingCommand(
            Guid.NewGuid(),
            Guid.NewGuid(),
            null,
            " ZH-hANS ",
            " reverse-holo ",
            " near-mint ",
            1,
            null);

        Assert.HasCount(0, CollectionCommandValidator.Validate(command));
        Assert.AreEqual("zh-Hans", CollectionCommandValidator.NormalizeLanguage(command.Language!));
    }

    [TestMethod]
    public void QuantityDeltaRequiresStableOperationIdentityAndBoundedNonzeroValue()
    {
        Assert.HasCount(2, CollectionCommandValidator.Validate(
            new QuantityDeltaCommand(Guid.Empty, 0)));
        Assert.IsTrue(CollectionCommandValidator.Validate(
            new QuantityDeltaCommand(Guid.NewGuid(), 10_001)).ContainsKey("delta"));
        Assert.HasCount(0, CollectionCommandValidator.Validate(
            new QuantityDeltaCommand(Guid.NewGuid(), -1)));
    }
}
