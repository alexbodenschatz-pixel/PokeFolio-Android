using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Domain.Abstractions;
using PokeFolio.Domain.Collection;
using PokeFolio.Infrastructure.Identity;
using PokeFolio.Infrastructure.Persistence;
using PokeFolio.Infrastructure.Sync;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class PersistenceModelTests
{
    private static readonly string[] DeviceOperationForeignKey = ["UserId", "DeviceSessionId"];
    private static readonly string[] UserDevicePrincipalKey = ["UserId", "Id"];

    [TestMethod]
    public void EveryPrivateAggregateHasARequiredUserIdAndQueryFilter()
    {
        using var database = CreateContext(Guid.NewGuid());
        Type[] privateTypes =
        [
            typeof(CollectionHolding),
            typeof(ConsumedRefreshToken),
            typeof(DeviceSession),
            typeof(ProcessedSyncOperation),
            typeof(UserChange)
        ];

        foreach (Type privateType in privateTypes)
        {
            IEntityType entity = database.Model.FindEntityType(privateType)
                ?? throw new AssertFailedException($"Missing EF model for {privateType.Name}.");
            IProperty userId = entity.FindProperty("UserId")
                ?? throw new AssertFailedException($"{privateType.Name} has no UserId.");
            Assert.IsFalse(userId.IsNullable, $"{privateType.Name}.UserId must be required.");
            Assert.IsTrue(
                entity.GetDeclaredQueryFilters().Count > 0,
                $"{privateType.Name} has no ownership query filter.");
        }
    }

    [TestMethod]
    public void SyncOperationsAreIdempotentPerUserAndHoldingVersionIsConcurrent()
    {
        using var database = CreateContext(Guid.NewGuid());
        IModel designTimeModel = database.GetService<IDesignTimeModel>().Model;
        IEntityType operation = designTimeModel.FindEntityType(typeof(ProcessedSyncOperation))!;
        bool uniqueOperationIndex = operation.GetIndexes().Any(index =>
            index.IsUnique &&
            index.Properties.Select(property => property.Name).SequenceEqual(["UserId", "OperationId"]));
        Assert.IsTrue(uniqueOperationIndex);
        Assert.AreEqual(80, operation.FindProperty(nameof(ProcessedSyncOperation.OperationKind))!
            .GetMaxLength());
        Assert.AreEqual(64, operation.FindProperty(nameof(ProcessedSyncOperation.RequestHash))!
            .GetMaxLength());

        IForeignKey deviceOwnershipForeignKey = operation.GetForeignKeys().Single(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(DeviceSession));
        CollectionAssert.AreEqual(
            DeviceOperationForeignKey,
            deviceOwnershipForeignKey.Properties.Select(property => property.Name).ToArray());
        CollectionAssert.AreEqual(
            UserDevicePrincipalKey,
            deviceOwnershipForeignKey.PrincipalKey.Properties.Select(property => property.Name).ToArray());

        IEntityType holding = designTimeModel.FindEntityType(typeof(CollectionHolding))!;
        Assert.IsTrue(holding.FindProperty(nameof(CollectionHolding.Version))!.IsConcurrencyToken);
        Assert.IsTrue(holding.FindProperty(nameof(CollectionHolding.DeletedAt))!.IsNullable);

        IIndex holdingIdentityIndex = holding.GetIndexes().Single(index =>
            index.IsUnique &&
            index.Properties.Select(property => property.Name).SequenceEqual(
                ["UserId", "CardId", "VariantId", "Language", "Variant", "Condition"]));
        Assert.AreEqual(
            false,
            holdingIdentityIndex.GetAreNullsDistinct(),
            "A null VariantId must not allow duplicate holdings for the same card identity.");
        Assert.AreEqual(
            "deleted_at IS NULL",
            holdingIdentityIndex.GetFilter(),
            "Deleted tombstones must reserve their identifiers without blocking a replacement holding.");

        IEntityType change = designTimeModel.FindEntityType(typeof(UserChange))!;
        ICheckConstraint actionConstraint = change.GetCheckConstraints().Single(constraint =>
            constraint.Name == "ck_changes_action");
        Assert.AreEqual("action IN ('upsert', 'delete')", actionConstraint.Sql);
    }

    [TestMethod]
    public void ConsumedRefreshTokenCannotReferenceAnotherUsersDevice()
    {
        using var database = CreateContext(Guid.NewGuid());
        IModel designTimeModel = database.GetService<IDesignTimeModel>().Model;
        IEntityType token = designTimeModel.FindEntityType(typeof(ConsumedRefreshToken))!;
        IForeignKey deviceOwnershipForeignKey = token.GetForeignKeys().Single(foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(DeviceSession));

        CollectionAssert.AreEqual(
            DeviceOperationForeignKey,
            deviceOwnershipForeignKey.Properties.Select(property => property.Name).ToArray());
        CollectionAssert.AreEqual(
            UserDevicePrincipalKey,
            deviceOwnershipForeignKey.PrincipalKey.Properties.Select(property => property.Name).ToArray());
    }

    [TestMethod]
    public void GlobalCatalogDoesNotReceiveAPrivateOwnershipFilter()
    {
        using var database = CreateContext(Guid.NewGuid());
        IEntityType card = database.Model.FindEntityType(typeof(PokeFolio.Infrastructure.Catalog.CatalogCard))!;
        Assert.IsNull(card.FindProperty("UserId"));
        Assert.AreEqual(0, card.GetDeclaredQueryFilters().Count);
    }

    [TestMethod]
    public void AnonymousOwnershipFilterTranslatesWithoutDereferencingNullableUserId()
    {
        using var database = CreateContext(null);

        string sql = database.CollectionHoldings.AsNoTracking().ToQueryString();

        Assert.IsFalse(string.IsNullOrWhiteSpace(sql));
    }

    [TestMethod]
    public void CollectionKeysetCursorTranslatesForPostgreSql()
    {
        using var database = CreateContext(Guid.NewGuid());
        Guid afterId = Guid.NewGuid();

        string sql = database.CollectionHoldings
            .AsNoTracking()
            .Where(holding => holding.Id.CompareTo(afterId) > 0)
            .OrderBy(holding => holding.Id)
            .Take(101)
            .ToQueryString();

        StringAssert.Contains(sql, "ORDER BY");
        StringAssert.Contains(sql, "LIMIT");
    }

    private static PokeFolioDbContext CreateContext(Guid? userId)
    {
        var options = new DbContextOptionsBuilder<PokeFolioDbContext>()
            .UseNpgsql("Host=localhost;Database=model_only;Username=model_only")
            .Options;
        return new PokeFolioDbContext(options, new StubUserContext(userId));
    }

    private sealed record StubUserContext(Guid? UserId) : IUserContext;
}
