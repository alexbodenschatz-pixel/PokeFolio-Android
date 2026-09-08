using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Domain.Collection;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class CollectionHoldingTests
{
    private static readonly DateTimeOffset Started = new(2026, 9, 7, 8, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void ConcurrentStyleDeltasAccumulateWithoutLostUpdate()
    {
        var holding = Create(quantity: 1);

        holding.ApplyQuantityDelta(1, Started.AddSeconds(1));
        holding.ApplyQuantityDelta(1, Started.AddSeconds(2));

        Assert.AreEqual(3, holding.Quantity);
        Assert.AreEqual(3L, holding.Version);
    }

    [TestMethod]
    public void DeltaRejectsZeroUnderflowAndCommandOverflow()
    {
        var holding = Create(quantity: 1);

        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            holding.ApplyQuantityDelta(0, Started.AddSeconds(1)));
        Assert.ThrowsExactly<CollectionConflictException>(() =>
            holding.ApplyQuantityDelta(-2, Started.AddSeconds(1)));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            holding.ApplyQuantityDelta(10_001, Started.AddSeconds(1)));
        Assert.AreEqual(1, holding.Quantity);
        Assert.AreEqual(1L, holding.Version);
    }

    [TestMethod]
    public void QuantityCannotExceedThePersistedContractLimit()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            Create(CollectionHolding.MaximumQuantity + 1));

        var holding = Create(CollectionHolding.MaximumQuantity);
        Assert.ThrowsExactly<CollectionConflictException>(() =>
            holding.ApplyQuantityDelta(1, Started.AddSeconds(1)));
        Assert.AreEqual(CollectionHolding.MaximumQuantity, holding.Quantity);
    }

    [TestMethod]
    public void AbsoluteEditRequiresTheCurrentVersion()
    {
        var holding = Create(quantity: 2);
        holding.UpdateDetails(1, "de", "reverse-holo", "near-mint", "Copy A", Started.AddMinutes(1));

        Assert.ThrowsExactly<CollectionConflictException>(() =>
            holding.UpdateDetails(1, "de", "holo", "good", "stale", Started.AddMinutes(2)));
        Assert.AreEqual("reverse-holo", holding.Variant);
        Assert.AreEqual("Copy A", holding.Notes);
    }

    [TestMethod]
    public void OwnershipAndIdentityAreEstablishedAtCreation()
    {
        Guid userId = Guid.NewGuid();
        Guid cardId = Guid.NewGuid();
        var holding = CollectionHolding.Create(
            Guid.NewGuid(), userId, cardId, null, " de ", " normal ", " near-mint ", 2, " note ", Started);

        Assert.AreEqual(userId, holding.UserId);
        Assert.AreEqual(cardId, holding.CardId);
        Assert.AreEqual("de", holding.Language);
        Assert.AreEqual("normal", holding.Variant);
        Assert.AreEqual("note", holding.Notes);
        Assert.AreEqual(Started, holding.CreatedAt);
    }

    private static CollectionHolding Create(int quantity) => CollectionHolding.Create(
        Guid.NewGuid(),
        Guid.NewGuid(),
        Guid.NewGuid(),
        null,
        "de",
        "normal",
        "near-mint",
        quantity,
        null,
        Started);
}
