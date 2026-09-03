using OpenCvSharp;

namespace PokeFolio.Desktop.Vision;

public sealed class ImageQualityAnalyzer
{
    public ImageQualityResult Analyze(Mat normalizedCard, CardDetectionResult detection)
    {
        using var gray = new Mat();
        Cv2.CvtColor(normalizedCard, gray, ColorConversionCodes.BGR2GRAY);
        using var laplacian = new Mat();
        Cv2.Laplacian(gray, laplacian, MatType.CV_64F);
        Cv2.MeanStdDev(laplacian, out _, out var deviation);
        var variance = deviation.Val0 * deviation.Val0;
        var sharpness = Math.Clamp(1 - Math.Exp(-variance / 420d), 0, 1);

        var mean = gray.Mean().Val0;
        var exposureCenter = 132d;
        var exposure = Math.Clamp(1 - Math.Abs(mean - exposureCenter) / 125d, 0, 1);
        using var highlights = new Mat();
        Cv2.Threshold(gray, highlights, 246, 255, ThresholdTypes.Binary);
        var highlightRatio = Cv2.CountNonZero(highlights) / (double)Math.Max(1, gray.Rows * gray.Cols);
        var glare = Math.Clamp(1 - highlightRatio * 5.5, 0, 1);

        var coverage = detection.FourCornersDetected
            ? Math.Clamp(detection.CardCoverage / 0.42, 0, 1)
            : 0.34;
        var perspective = detection.FourCornersDetected ? detection.Confidence : 0.28;
        var overall = sharpness * 0.28 + exposure * 0.20 + glare * 0.18
            + coverage * 0.18 + perspective * 0.16;
        var warnings = new List<string>();
        if (sharpness < 0.42) warnings.Add("Bild ist unscharf oder verwackelt.");
        if (mean < 48) warnings.Add("Aufnahme ist deutlich unterbelichtet.");
        if (mean > 220) warnings.Add("Aufnahme ist deutlich überbelichtet.");
        if (glare < 0.55) warnings.Add("Starke Reflexionen können Details verdecken.");
        if (!detection.BorderComplete) warnings.Add("Nicht alle Kartenränder sind sicher sichtbar.");
        if (detection.Confidence < 0.55) warnings.Add("Perspektive oder Kartenkontur ist unsicher.");
        return new ImageQualityResult(
            sharpness, exposure, glare, coverage, perspective, overall,
            overall >= 0.48 && sharpness >= 0.30,
            overall >= 0.76 && sharpness >= 0.62 && glare >= 0.62
                && detection.BorderComplete && detection.Confidence >= 0.70,
            warnings);
    }
}
