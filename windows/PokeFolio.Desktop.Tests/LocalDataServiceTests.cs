using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Bridge;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class LocalDataServiceTests
{
    [TestMethod]
    public void CollectionJsonRoundTripsWithoutSchemaChanges()
    {
        var root = Path.Combine(Path.GetTempPath(), "pokefolio-desktop-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            var service = new LocalDataService(root);
            const string collection = "{\"version\":4,\"items\":[{\"collectionKey\":\"pokemon|sv04|132|de|normal\",\"quantity\":3}]}";
            service.Save("collection-backup", collection);
            Assert.AreEqual(collection, service.Load("collection-backup"));
            service.Delete("collection-backup");
            Assert.IsNull(service.Load("collection-backup"));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    [TestMethod]
    public void RejectsKeysThatCouldEscapeTheDataDirectory()
    {
        var root = Path.Combine(Path.GetTempPath(), "pokefolio-desktop-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            var service = new LocalDataService(root);
            Assert.ThrowsExactly<ArgumentException>(() => service.Save("../collection", "{}"));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
