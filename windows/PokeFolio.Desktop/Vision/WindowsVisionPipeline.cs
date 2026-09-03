using System.Diagnostics;

namespace PokeFolio.Desktop.Vision;

public interface IWindowsVisionPipeline
{
    PreparedCardImage Prepare(string dataUrl);
}

public sealed class WindowsVisionPipeline(
    ImageDataUrlCodec codec,
    CardDetector detector,
    CardPerspectiveCorrector corrector,
    ImageQualityAnalyzer qualityAnalyzer) : IWindowsVisionPipeline
{
    public WindowsVisionPipeline() : this(
        new ImageDataUrlCodec(), new CardDetector(), new CardPerspectiveCorrector(),
        new ImageQualityAnalyzer())
    {
    }

    public PreparedCardImage Prepare(string dataUrl)
    {
        var timer = Stopwatch.StartNew();
        using var decoded = codec.Decode(dataUrl);
        var detection = detector.Detect(decoded.Pixels);
        var normalized = corrector.Normalize(decoded.Pixels, detection, out var margin,
            out var perspectiveCorrected, out var fallbackUsed);
        var quality = qualityAnalyzer.Analyze(normalized, detection);
        timer.Stop();
        return new PreparedCardImage(
            normalized,
            detection,
            quality,
            perspectiveCorrected,
            0,
            margin,
            fallbackUsed,
            decoded.SourceExifApplied,
            decoded.OriginalExifOrientation,
            timer.ElapsedMilliseconds);
    }
}
