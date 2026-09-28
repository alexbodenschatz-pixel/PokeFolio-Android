using System.Text.Json;
using PokeFolio.Api.Collection;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class CollectionCommandValidatorTests
{
    private static readonly string[] InvalidCreateFields =
        ["id", "cardId", "variantId", "language", "variant", "condition", "quantity", "notes"];
    private static readonly string[] InvalidUpdateFields = ["language", "quantity"];

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

    [TestMethod]
    public void UpdateMergePatchPreservesMissingFieldsAndAllowsClearingNotes()
    {
        using JsonDocument document = JsonDocument.Parse(
            """{"language":" ZH-hANS ","notes":null}""");

        bool parsed = CollectionCommandValidator.TryParseUpdate(
            document.RootElement,
            out UpdateHoldingPatch patch,
            out IReadOnlyDictionary<string, string[]> errors);

        Assert.IsTrue(parsed);
        Assert.HasCount(0, errors);
        Assert.IsTrue(patch.HasLanguage);
        Assert.AreEqual(" ZH-hANS ", patch.Language);
        Assert.IsFalse(patch.HasVariant);
        Assert.IsFalse(patch.HasCondition);
        Assert.IsTrue(patch.HasNotes);
        Assert.IsNull(patch.Notes);
    }

    [TestMethod]
    public void UpdateMergePatchRejectsUnknownDuplicateAndEmptyBodies()
    {
        using JsonDocument invalid = JsonDocument.Parse(
            """{"language":"de","language":"en","quantity":3}""");
        Assert.IsFalse(CollectionCommandValidator.TryParseUpdate(
            invalid.RootElement,
            out _,
            out IReadOnlyDictionary<string, string[]> invalidErrors));
        CollectionAssert.AreEquivalent(
            InvalidUpdateFields,
            invalidErrors.Keys.ToArray());

        using JsonDocument empty = JsonDocument.Parse("{}");
        Assert.IsFalse(CollectionCommandValidator.TryParseUpdate(
            empty.RootElement,
            out _,
            out IReadOnlyDictionary<string, string[]> emptyErrors));
        Assert.IsTrue(emptyErrors.ContainsKey("body"));
    }
}
