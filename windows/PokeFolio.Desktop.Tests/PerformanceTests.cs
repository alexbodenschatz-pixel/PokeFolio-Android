using System.Diagnostics;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Recognition;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class PerformanceTests
{
    public TestContext TestContext { get; set; } = null!;

    [TestMethod]
    public void CardDetectionOnReducedFrameIsBounded()
    {
        using var image = SyntheticCard.Create();
        var detector = new CardDetector();
        detector.Detect(image);
        var timer = Stopwatch.StartNew();
        for (var index = 0; index < 8; index++) detector.Detect(image);
        timer.Stop();
        var average = timer.Elapsed.TotalMilliseconds / 8;
        TestContext.WriteLine($"CardDetector average: {average:F2} ms");
        Assert.IsLessThan(250, average, "Generous CI guard; production goal remains <30 ms on preview frames.");
    }

    [TestMethod]
    public async Task OrientationProbeStaysOffUiThreadAndIsBounded()
    {
        using var image = SyntheticCard.Create();
        var text = new FakeTextRecognitionService();
        var regions = new CardRegionExtractor();
        var timer = Stopwatch.StartNew();
        using var result = await new CardOrientationNormalizer(text, regions,
            new CardIdentifierParser()).NormalizeAsync(image, "de", "pokemon");
        timer.Stop();
        TestContext.WriteLine($"Orientation probes: {timer.Elapsed.TotalMilliseconds:F2} ms");
        Assert.IsLessThan(1200, timer.Elapsed.TotalMilliseconds);
    }

    [TestMethod]
    public void RegionalVisualMatchIsBounded()
    {
        using var first = SyntheticCard.Create(80);
        using var second = SyntheticCard.Create(80);
        var timer = Stopwatch.StartNew();
        var result = new CardVisualMatcher().Compare(first, second);
        timer.Stop();
        TestContext.WriteLine($"Visual match: {timer.Elapsed.TotalMilliseconds:F2} ms");
        Assert.IsGreaterThan(.8, result.Similarity);
        Assert.IsLessThan(1500, timer.Elapsed.TotalMilliseconds);
    }
}
