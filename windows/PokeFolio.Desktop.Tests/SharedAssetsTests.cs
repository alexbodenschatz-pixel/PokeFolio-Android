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
}
