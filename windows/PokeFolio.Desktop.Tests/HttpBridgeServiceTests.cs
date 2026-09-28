using System.Net;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Bridge;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class HttpBridgeServiceTests
{
    [TestMethod]
    public async Task RejectsNonHttpsAndUnknownHostsBeforeNetworkAccess()
    {
        using var service = new HttpBridgeService();
        var insecure = await service.GetAsync("http://api.tcgdex.net/v2/de/cards");
        var unknown = await service.GetAsync("https://example.com/cards");
        Assert.IsFalse(insecure.Ok);
        Assert.AreEqual("security", insecure.ErrorType);
        Assert.IsFalse(unknown.Ok);
        Assert.AreEqual("security", unknown.ErrorType);
    }

    [TestMethod]
    public async Task ReturnsBodyAndStatusForAllowedApiResponse()
    {
        using var client = new HttpClient(new StubHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"cards\":[]}")
        }));
        using var service = new HttpBridgeService(client);
        var result = await service.GetAsync("https://api.tcgdex.net/v2/de/cards");
        Assert.IsTrue(result.Ok);
        Assert.AreEqual(200, result.Status);
        Assert.AreEqual("{\"cards\":[]}", result.Body);
    }

    private sealed class StubHandler(HttpResponseMessage response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(response);
    }
}
