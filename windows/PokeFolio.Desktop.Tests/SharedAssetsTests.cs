using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class SharedAssetsTests
{
    [TestMethod]
    public void SharedWebCoreContainsEveryRequiredModule()
    {
        var root = TestPaths.RepositoryRoot();
        var assets = new SharedWebAssetLocator(Path.Combine(root, "app", "src", "main", "assets"));
        Assert.AreEqual(0, assets.FindMissingRequiredFiles().Count);
        Assert.IsTrue(assets.CountAssets() >= 12);
    }

    [TestMethod]
    public void DesktopBuildOutputContainsSharedAssets()
    {
        var assets = new SharedWebAssetLocator();
        var validation = StartupValidator.Validate(assets);
        Assert.IsTrue(validation.Success, string.Join(Environment.NewLine, validation.Errors));
        Assert.IsTrue(validation.AssetCount >= 12);
    }

    [TestMethod]
    public void DesktopBootstrapAddsEosStudioWithoutChangingAndroidIndex()
    {
        var root = TestPaths.RepositoryRoot();
        var bootstrap = File.ReadAllText(Path.Combine(
            root,
            "windows",
            "PokeFolio.Desktop",
            "WebHost",
            "desktop-bootstrap.js"));
        var androidIndex = File.ReadAllText(Path.Combine(root, "app", "src", "main", "assets", "index.html"));

        StringAssert.Contains(bootstrap, "EOS Studio");
        StringAssert.Contains(bootstrap, "window.PokeNative.selectImage");
        StringAssert.Contains(bootstrap, "Canon EDSDK");
        Assert.IsFalse(androidIndex.Contains("desktop-bootstrap.js", StringComparison.Ordinal));
    }

    [TestMethod]
    public void DesktopBootstrapExposesTokenFreeBoundedAccountFacade()
    {
        var root = TestPaths.RepositoryRoot();
        string bootstrap = File.ReadAllText(Path.Combine(
            root,
            "windows",
            "PokeFolio.Desktop",
            "WebHost",
            "desktop-bootstrap.js"));

        StringAssert.Contains(bootstrap, "Object.defineProperty(window, 'PokeAccount'");
        StringAssert.Contains(bootstrap, "pendingAccountRequests.size >= 8");
        StringAssert.Contains(bootstrap, "nativeHost.restoreAccountSession");
        StringAssert.Contains(bootstrap, "nativeHost.requestPasswordReset");
        StringAssert.Contains(bootstrap, "nativeHost.confirmPasswordReset");
        StringAssert.Contains(bootstrap, "pokefolio:account-state");
        Assert.IsFalse(bootstrap.Contains("accessToken", StringComparison.Ordinal));
        Assert.IsFalse(bootstrap.Contains("refreshToken", StringComparison.Ordinal));
        Assert.IsFalse(bootstrap.Contains("localStorage", StringComparison.Ordinal));
    }

    [TestMethod]
    public void DesktopBootstrapExposesTokenFreeBoundedSyncTransport()
    {
        var root = TestPaths.RepositoryRoot();
        string bootstrap = File.ReadAllText(Path.Combine(
            root, "app", "src", "main", "assets", "cloud-bootstrap.js"));

        StringAssert.Contains(bootstrap, "Object.defineProperty(window, 'PokeSyncTransport'");
        StringAssert.Contains(bootstrap, "pending.size >= 8");
        StringAssert.Contains(bootstrap, "nativeHost.pushSyncOperations");
        StringAssert.Contains(bootstrap, "nativeHost.pullSyncChanges");
        StringAssert.Contains(bootstrap, "pokefolio:sync-result");
        StringAssert.Contains(bootstrap, "limit < 1 || limit > 500");
        Assert.IsFalse(bootstrap.Contains("accessToken", StringComparison.Ordinal));
        Assert.IsFalse(bootstrap.Contains("refreshToken", StringComparison.Ordinal));
        Assert.IsFalse(bootstrap.Contains("localStorage", StringComparison.Ordinal));
    }

    [TestMethod]
    public void DesktopSyncDriverUsesNativeAccountStorageAndSharedCore()
    {
        var root = TestPaths.RepositoryRoot();
        string bootstrap = File.ReadAllText(Path.Combine(
            root, "app", "src", "main", "assets", "cloud-bootstrap.js"));
        string driver = File.ReadAllText(Path.Combine(
            root, "app", "src", "main", "assets", "sync-driver.js"));

        StringAssert.Contains(bootstrap, "Object.defineProperty(window, 'PokeSyncStorage'");
        StringAssert.Contains(bootstrap, "nativeHost.loadAccountSyncSnapshot");
        StringAssert.Contains(bootstrap, "nativeHost.saveAccountSyncSnapshot");
        StringAssert.Contains(driver, "Object.defineProperty(window, 'PokeSyncClient'");
        StringAssert.Contains(driver, "window.PokeSyncStorage.save(next)");
        StringAssert.Contains(driver, "window.PokeSyncTransport.push");
        StringAssert.Contains(driver, "window.PokeSyncTransport.pull");
        StringAssert.Contains(driver, "pokefolio:account-state");
        Assert.IsFalse(bootstrap.Contains("accessToken", StringComparison.Ordinal));
        Assert.IsFalse(bootstrap.Contains("refreshToken", StringComparison.Ordinal));
        Assert.IsFalse(driver.Contains("localStorage", StringComparison.Ordinal));
        Assert.IsFalse(driver.Contains("accessToken", StringComparison.Ordinal));
        Assert.IsFalse(driver.Contains("refreshToken", StringComparison.Ordinal));
    }

    [TestMethod]
    public void DesktopBootstrapExposesTokenFreeBoundedCatalogFacade()
    {
        var root = TestPaths.RepositoryRoot();
        string bootstrap = File.ReadAllText(Path.Combine(
            root, "app", "src", "main", "assets", "cloud-bootstrap.js"));

        StringAssert.Contains(bootstrap, "Object.defineProperty(window, 'PokeCatalog'");
        StringAssert.Contains(bootstrap, "pending.size >= 8");
        StringAssert.Contains(bootstrap, "nativeHost.resolveCatalogCard");
        StringAssert.Contains(bootstrap, "nativeHost.getCatalogCard");
        StringAssert.Contains(bootstrap, "pokefolio:catalog-result");
        Assert.IsFalse(bootstrap.Contains("accessToken", StringComparison.Ordinal));
        Assert.IsFalse(bootstrap.Contains("refreshToken", StringComparison.Ordinal));
        Assert.IsFalse(bootstrap.Contains("localStorage", StringComparison.Ordinal));
    }

    [TestMethod]
    public void SharedAccountUiKeepsCredentialsNativeAndMigrationExplicit()
    {
        var root = TestPaths.RepositoryRoot();
        string assets = Path.Combine(root, "app", "src", "main", "assets");
        string index = File.ReadAllText(Path.Combine(assets, "index.html"));
        string accountUi = File.ReadAllText(Path.Combine(assets, "account-ui.js"));
        string migration = File.ReadAllText(Path.Combine(assets, "account-migration-core.js"));
        string collectionCloud = File.ReadAllText(Path.Combine(assets, "collection-cloud-driver.js"));

        Assert.IsTrue(index.IndexOf("account-migration-core.js", StringComparison.Ordinal)
            < index.IndexOf("app.js", StringComparison.Ordinal));
        Assert.IsTrue(index.IndexOf("app.js", StringComparison.Ordinal)
            < index.IndexOf("account-ui.js", StringComparison.Ordinal));
        Assert.IsTrue(index.IndexOf("collection-cloud-core.js", StringComparison.Ordinal)
            < index.IndexOf("app.js", StringComparison.Ordinal));
        Assert.IsTrue(index.IndexOf("app.js", StringComparison.Ordinal)
            < index.IndexOf("collection-cloud-driver.js", StringComparison.Ordinal));
        StringAssert.Contains(accountUi, "window.PokeAccount");
        StringAssert.Contains(accountUi, "window.PokeCatalog");
        StringAssert.Contains(accountUi, "window.PokeSyncClient");
        StringAssert.Contains(accountUi, "window.confirm");
        StringAssert.Contains(accountUi, "claimLegacyCollection");
        StringAssert.Contains(migration, "deterministicUuid");
        StringAssert.Contains(migration, "holding.quantityDelta");
        StringAssert.Contains(collectionCloud, "queueCollectionChanges");
        StringAssert.Contains(collectionCloud, "store.replaceFromCloud");
        StringAssert.Contains(collectionCloud, "core.buildCreateIntent");
        StringAssert.Contains(collectionCloud, "cloudCreateOperationIds");
        Assert.IsFalse(accountUi.Contains("accessToken", StringComparison.Ordinal));
        Assert.IsFalse(accountUi.Contains("refreshToken", StringComparison.Ordinal));
        Assert.IsFalse(migration.Contains("accessToken", StringComparison.Ordinal));
        Assert.IsFalse(migration.Contains("refreshToken", StringComparison.Ordinal));
        Assert.IsFalse(collectionCloud.Contains("accessToken", StringComparison.Ordinal));
        Assert.IsFalse(collectionCloud.Contains("refreshToken", StringComparison.Ordinal));
    }
}
