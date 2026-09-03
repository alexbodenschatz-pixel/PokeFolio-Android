using Microsoft.VisualStudio.TestTools.UnitTesting;
using OpenCvSharp;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class VisionPipelineTests
{
    [TestMethod]
    public void DetectsLargestPlausibleCardAndAllCorners()
    {
        using var image = SyntheticCard.Create();
        var result = new CardDetector().Detect(image);
        Assert.IsTrue(result.FourCornersDetected);
        Assert.HasCount(4, result.DetectedQuad);
        Assert.IsGreaterThan(.60, result.Confidence);
        Assert.IsTrue(result.DetectedAspectRatio is >= .68 and <= .75);
        Assert.IsTrue(result.BorderComplete);
    }

    [TestMethod]
    public void PipelineProducesOneStandardizedPerspectiveCorrectedImage()
    {
        using var result = new WindowsVisionPipeline().Prepare(SyntheticCard.DataUrl());
        Assert.AreEqual(CardPerspectiveCorrector.NormalizedWidth, result.Image.Width);
        Assert.AreEqual(CardPerspectiveCorrector.NormalizedHeight, result.Image.Height);
        Assert.IsTrue(result.PerspectiveCorrected);
        Assert.IsFalse(result.FallbackUsed);
        Assert.IsTrue(result.SafetyMargin is >= .018 and <= .032);
    }

    [TestMethod]
    public void LandscapeSourceMapsCardShortEdgeToNormalizedWidth()
    {
        using var portrait = SyntheticCard.Create();
        using var landscape = new Mat();
        Cv2.Rotate(portrait, landscape, RotateFlags.Rotate90Clockwise);
        using var result = new WindowsVisionPipeline().Prepare(
            new ImageDataUrlCodec().EncodeJpeg(landscape, 95));

        Assert.AreEqual(CardPerspectiveCorrector.NormalizedWidth, result.Image.Width);
        Assert.AreEqual(CardPerspectiveCorrector.NormalizedHeight, result.Image.Height);
        Assert.IsTrue(result.PerspectiveCorrected);
        var points = result.Detection.DetectedQuad
            .Select(point => new Point2f((float)point.X, (float)point.Y)).ToArray();
        var portraitOrder = CardPerspectiveCorrector.OrientForPortraitOutput(points);
        static double Distance(Point2f first, Point2f second) => Math.Sqrt(
            Math.Pow(first.X - second.X, 2) + Math.Pow(first.Y - second.Y, 2));
        var destinationWidthEdge = Distance(portraitOrder[0], portraitOrder[1]);
        var destinationHeightEdge = Distance(portraitOrder[0], portraitOrder[3]);
        Assert.IsLessThan(destinationHeightEdge, destinationWidthEdge);
    }

    [TestMethod]
    public void QualityAnalyzerRejectsStrongBlurForPrecision()
    {
        using var image = SyntheticCard.Create();
        using var blurred = new Mat();
        Cv2.GaussianBlur(image, blurred, new Size(71, 71), 30);
        var detection = new CardDetector().Detect(blurred);
        var quality = new ImageQualityAnalyzer().Analyze(blurred, detection);
        Assert.IsFalse(quality.AcceptableForPrecisionGrading);
        Assert.IsLessThan(.62, quality.SharpnessScore);
    }

    [TestMethod]
    public void VisualMatcherRanksSameArtworkAboveDifferentArtwork()
    {
        using var scan = SyntheticCard.Create(60);
        using var same = SyntheticCard.Create(60);
        using var different = SyntheticCard.Create(210);
        var matcher = new CardVisualMatcher();
        var sameResult = matcher.Compare(scan, same);
        var differentResult = matcher.Compare(scan, different);
        Assert.IsGreaterThan(differentResult.Similarity, sameResult.Similarity);
        Assert.IsGreaterThan(.85, sameResult.Similarity);
    }

    [TestMethod]
    public void RegionExtractorUsesSmallPokemonIdentifierRoi()
    {
        using var image = new Mat(CardPerspectiveCorrector.NormalizedHeight,
            CardPerspectiveCorrector.NormalizedWidth, MatType.CV_8UC3, Scalar.White);
        var extractor = new CardRegionExtractor();
        var roi = extractor.PrimaryIdentifier("pokemon");
        Assert.AreEqual(0d, roi.X);
        Assert.AreEqual(.80, roi.Y);
        Assert.AreEqual(.72, roi.Width);
        Assert.AreEqual(.185, roi.Height);
        using var crop = extractor.Crop(image, roi);
        Assert.IsLessThan(image.Rows / 4, crop.Rows);
        Assert.IsLessThan(image.Cols, crop.Cols);
    }
}
