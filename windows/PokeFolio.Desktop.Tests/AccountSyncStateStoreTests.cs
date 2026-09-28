using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Sync;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class AccountSyncStateStoreTests
{
    private const string EmptySnapshot =
        "{\"schemaVersion\":1,\"state\":{\"schemaVersion\":1,\"cursor\":\"\",\"lastSequence\":0,\"pending\":[],\"conflicts\":[],\"rejected\":[],\"entityVersions\":{}},\"entities\":{}}";

    [TestMethod]
    public void StoreRoundTripsAtomicallyAndKeepsAccountsSeparate()
    {
        string root = TemporaryRoot();
        try
        {
            var store = new AccountSyncStateStore(root);
            Guid firstUser = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
            Guid secondUser = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
            const string secondSnapshot =
                "{\"schemaVersion\":1,\"state\":{\"schemaVersion\":1,\"cursor\":\"\",\"lastSequence\":0,\"pending\":[],\"conflicts\":[],\"rejected\":[],\"entityVersions\":{}},\"entities\":{\"holding:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\":{}}}";

            store.Save(firstUser, EmptySnapshot);
            store.Save(secondUser, secondSnapshot);

            Assert.AreEqual(EmptySnapshot, store.Load(firstUser));
            Assert.AreEqual(secondSnapshot, store.Load(secondUser));
            Assert.AreEqual(2, Directory.EnumerateFiles(root, "*.json").Count());
            Assert.AreEqual(0, Directory.EnumerateFiles(root, "*.tmp").Count());
            Assert.IsFalse(store.StoragePathFor(firstUser).Contains(
                firstUser.ToString("N"),
                StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            DeleteRoot(root);
        }
    }

    [TestMethod]
    public void StoreRejectsInvalidOrOversizedSnapshotsWithoutReplacingValidData()
    {
        string root = TemporaryRoot();
        try
        {
            var store = new AccountSyncStateStore(root);
            Guid userId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
            store.Save(userId, EmptySnapshot);

            Assert.ThrowsExactly<InvalidDataException>(() =>
                store.Save(userId,
                    "{\"schemaVersion\":1,\"state\":{},\"entities\":{},\"accessToken\":\"secret\"}"));
            Assert.AreEqual(EmptySnapshot, store.Load(userId));

            string oversized = "{\"schemaVersion\":1,\"state\":{},\"entities\":{\"x\":\""
                + new string('x', AccountSyncStateStore.MaximumSnapshotBytes) + "\"}}";
            Assert.ThrowsExactly<InvalidDataException>(() => store.Save(userId, oversized));
            Assert.AreEqual(EmptySnapshot, store.Load(userId));
        }
        finally
        {
            DeleteRoot(root);
        }
    }

    [TestMethod]
    public void StoreFailsClosedAndPreservesCorruptSnapshotForRecovery()
    {
        string root = TemporaryRoot();
        try
        {
            var store = new AccountSyncStateStore(root);
            Guid userId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
            Directory.CreateDirectory(root);
            string path = store.StoragePathFor(userId);
            File.WriteAllText(path, "{not-json");

            Assert.ThrowsExactly<InvalidDataException>(() => store.Load(userId));
            Assert.AreEqual("{not-json", File.ReadAllText(path));
            Assert.ThrowsExactly<ArgumentException>(() => store.Load(Guid.Empty));
        }
        finally
        {
            DeleteRoot(root);
        }
    }

    private static string TemporaryRoot() => Path.Combine(
        Path.GetTempPath(),
        "pokefolio-sync-store-test-" + Guid.NewGuid().ToString("N"));

    private static void DeleteRoot(string root)
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
