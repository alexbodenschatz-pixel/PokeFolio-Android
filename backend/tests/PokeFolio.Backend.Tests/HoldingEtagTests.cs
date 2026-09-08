using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
using PokeFolio.Api.Collection;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class HoldingEtagTests
{
    [TestMethod]
    [DataRow("\"v1\"", true, 1L)]
    [DataRow("\"v9223372036854775807\"", true, long.MaxValue)]
    [DataRow(null, false, 0L)]
    [DataRow("v1", false, 0L)]
    [DataRow("W/\"v1\"", false, 0L)]
    [DataRow("*", false, 0L)]
    [DataRow("\"v0\"", false, 0L)]
    [DataRow("\"v-1\"", false, 0L)]
    [DataRow("\"v01\"", false, 0L)]
    [DataRow("\"v1\", \"v2\"", false, 0L)]
    public void IfMatchParserOnlyAcceptsOnePositiveStrongHoldingEtag(
        string? value,
        bool expectedSuccess,
        long expectedVersion)
    {
        var context = new DefaultHttpContext();
        if (value is not null) context.Request.Headers.IfMatch = value;

        bool parsed = HoldingEtag.TryParseIfMatch(context.Request, out long version);

        Assert.AreEqual(expectedSuccess, parsed);
        Assert.AreEqual(expectedVersion, version);
    }

    [TestMethod]
    public void IfMatchParserRejectsMultipleHeaderValues()
    {
        var context = new DefaultHttpContext();
        context.Request.Headers.IfMatch = new StringValues(["\"v1\"", "\"v2\""]);

        Assert.IsFalse(HoldingEtag.TryParseIfMatch(context.Request, out long version));
        Assert.AreEqual(0L, version);
    }

    [TestMethod]
    public void FormatProducesTheOpaqueVersionUsedByReadResponses()
    {
        Assert.AreEqual("\"v42\"", HoldingEtag.Format(42));
    }
}
