using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class WebViewSecurityPolicyTests
{
    [TestMethod]
    public void TopLevelNavigationPermitsOnlyThePackagedApplicationEntryPoint()
    {
        Assert.IsTrue(WebViewSecurityPolicy.IsAllowedTopLevelNavigation(WebViewSecurityPolicy.StartPage));
        Assert.IsTrue(WebViewSecurityPolicy.IsAllowedTopLevelNavigation(
            "https://app.pokefolio.local/index.html?version=16#scan"));
        Assert.IsTrue(WebViewSecurityPolicy.IsAllowedTopLevelNavigation("https://app.pokefolio.local/"));

        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedTopLevelNavigation("https://example.com/"));
        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedTopLevelNavigation(
            "https://app.pokefolio.local.evil/index.html"));
        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedTopLevelNavigation(
            "https://app.pokefolio.local:444/index.html"));
        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedTopLevelNavigation(
            "https://user@app.pokefolio.local/index.html"));
        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedTopLevelNavigation(
            "https://desktop.pokefolio.local/desktop.css"));
        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedTopLevelNavigation("file:///C:/card.html"));
        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedTopLevelNavigation(null));
    }

    [TestMethod]
    public void FramesPermitOnlyMappedLocalOrigins()
    {
        Assert.IsTrue(WebViewSecurityPolicy.IsAllowedFrameNavigation(
            "https://app.pokefolio.local/help.html"));
        Assert.IsTrue(WebViewSecurityPolicy.IsAllowedFrameNavigation(
            "https://desktop.pokefolio.local/frame.html"));

        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedFrameNavigation("https://example.com/frame.html"));
        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedFrameNavigation("data:text/html,untrusted"));
        Assert.IsFalse(WebViewSecurityPolicy.IsAllowedFrameNavigation("about:blank"));
    }
}
