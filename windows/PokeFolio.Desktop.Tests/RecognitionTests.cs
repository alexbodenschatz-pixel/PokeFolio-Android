using Microsoft.VisualStudio.TestTools.UnitTesting;
using OpenCvSharp;
using PokeFolio.Desktop.Recognition;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class RecognitionTests
{
    [TestMethod]
    [DataRow("049/195", "049/195")]
    [DataRow("O50/I95", "050/195")]
    [DataRow("198 193", "198/193")]
    [DataRow("151／208 R", "151/208")]
    public void PokemonCollectorNumbersAreNormalizedInNumberContext(string input, string expected)
    {
        var result = new CardIdentifierParser().Parse(input, "pokemon");
        Assert.AreEqual(expected, result.CollectorNumber);
        Assert.IsTrue(result.IsExact);
    }

    [TestMethod]
    [DataRow("HP 90")]
    [DataRow("120")]
    [DataRow("90 120")]
    [DataRow("GAME FREAK 2025")]
    public void StructuralNumbersDoNotBecomeCollectorNumbers(string input)
    {
        var result = new CardIdentifierParser().Parse(input, "pokemon");
        Assert.AreEqual("", result.CollectorNumber);
        Assert.IsFalse(result.IsExact);
    }

    [TestMethod]
    public void TcgSpecificCodesWinWithoutCardName()
    {
        var parser = new CardIdentifierParser();
        var yugioh = parser.Parse("[KRIEGER] SDY-G008 91152256 ATK 1400 DEF 1200", "yugioh");
        var onePiece = parser.Parse("CHARACTER trash this Character OP04-032", "onepiece");
        Assert.AreEqual("91152256", yugioh.Value);
        Assert.AreEqual("SDY-G008", yugioh.SetCode);
        Assert.AreEqual("OP04-032", onePiece.CardCode);
    }

    [TestMethod]
    public async Task OrientationAlwaysTestsRotationsFromSameSourceAndCorrectsUpsideDownCard()
    {
        using var upright = new Mat(CardPerspectiveCorrector.NormalizedHeight,
            CardPerspectiveCorrector.NormalizedWidth, MatType.CV_8UC3, Scalar.White);
        Cv2.Rectangle(upright, new Rect(0, (int)(upright.Height * .78), upright.Width,
            (int)(upright.Height * .22)), Scalar.Black, -1);
        using var upsideDown = new Mat();
        Cv2.Rotate(upright, upsideDown, RotateFlags.Rotate180);
        var text = new FakeTextRecognitionService((image, _) =>
            image.Mean().Val0 < 80 ? "050/195" : "");
        var parser = new CardIdentifierParser();
        var normalizer = new CardOrientationNormalizer(text, new CardRegionExtractor(), parser);
        using var result = await normalizer.NormalizeAsync(upsideDown, "de", "pokemon");
        Assert.AreEqual(180, result.Rotation);
        Assert.IsTrue(result.Confident);
        Assert.AreEqual(CardPerspectiveCorrector.NormalizedWidth, result.Image.Width);
        Assert.AreEqual(CardPerspectiveCorrector.NormalizedHeight, result.Image.Height);
    }

    [TestMethod]
    public async Task LocalWindowsOcrNeverThrowsWhenLanguagePackIsMissing()
    {
        using var image = new Mat(120, 420, MatType.CV_8UC3, Scalar.White);
        var result = await new WindowsTextRecognitionService().RecognizeAsync(image, "de",
            CardRegionKind.PrimaryIdentifier);
        Assert.IsNotNull(result);
        Assert.IsGreaterThanOrEqualTo(0, result.ElapsedMilliseconds);
    }
}
