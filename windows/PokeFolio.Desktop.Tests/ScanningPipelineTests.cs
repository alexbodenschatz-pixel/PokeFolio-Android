using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Recognition;
using PokeFolio.Desktop.Scanning;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class ScanningPipelineTests
{
    [TestMethod]
    public async Task QuickScanDoesNotPrepareNormalizedCardTwice()
    {
        var recognition = new FakeRecognitionService(FakeRecognitionService.ExactPokemon());
        var pipeline = new QuickScanPipeline(new WindowsVisionPipeline(), recognition,
            new ImageDataUrlCodec());
        var result = await pipeline.RunAsync(SyntheticCard.DataUrl(), "de", "pokemon");
        Assert.IsTrue(result.Recognition.Identifier.IsExact);
        Assert.AreEqual(0, recognition.RawCalls);
        Assert.AreEqual(1, recognition.PreparedCalls);
        Assert.IsFalse(result.UsedFallback);
    }

    [TestMethod]
    public async Task BulkScanUsesBoundedSessionCache()
    {
        var recognition = new FakeRecognitionService(FakeRecognitionService.ExactPokemon());
        var bulk = new BulkScanPipeline(recognition, 2);
        var first = await bulk.RunAsync("ignored", "de", "pokemon", "fingerprint-a");
        var second = await bulk.RunAsync("ignored", "de", "pokemon", "fingerprint-a");
        Assert.AreEqual("LOCAL_IDENTIFIER", first.Source);
        Assert.AreEqual("SESSION_CACHE", second.Source);
        Assert.AreEqual(1, recognition.RawCalls);
        Assert.AreEqual(2, bulk.SessionScanned);
        Assert.AreEqual(1, bulk.SessionCacheHits);
    }

    [TestMethod]
    public async Task PrecisionScanKeepsFrontAndBackAndReportsQuality()
    {
        var pipeline = new PrecisionScanPipeline(new WindowsVisionPipeline(),
            new ImageDataUrlCodec(), new CenteringAnalyzer());
        var result = await pipeline.RunAsync(SyntheticCard.DataUrl(), SyntheticCard.DataUrl(120),
            "windows-file", "File import");
        StringAssert.StartsWith(result.NormalizedFront, "data:image/jpeg;base64,");
        StringAssert.StartsWith(result.NormalizedBack, "data:image/jpeg;base64,");
        Assert.AreEqual(CardPerspectiveCorrector.NormalizedWidth, result.Metadata.FrontWidth);
        Assert.AreEqual(100d, result.Metadata.Centering.LeftPercent
            + result.Metadata.Centering.RightPercent, .001);
        Assert.AreEqual(100d, result.Metadata.Centering.TopPercent
            + result.Metadata.Centering.BottomPercent, .001);
    }
}
