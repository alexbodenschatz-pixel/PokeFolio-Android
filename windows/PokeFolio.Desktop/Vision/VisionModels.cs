using OpenCvSharp;

namespace PokeFolio.Desktop.Vision;

public readonly record struct CardPoint(double X, double Y);

public sealed record CardDetectionResult(
    bool FourCornersDetected,
    double DetectedAspectRatio,
    double Confidence,
    double CardCoverage,
    bool BorderComplete,
    IReadOnlyList<CardPoint> DetectedQuad,
    string CropMethod);

public sealed record ImageQualityResult(
    double SharpnessScore,
    double ExposureScore,
    double GlareScore,
    double CoverageScore,
    double PerspectiveScore,
    double OverallScore,
    bool AcceptableForRecognition,
    bool AcceptableForPrecisionGrading,
    IReadOnlyList<string> Warnings);

public sealed class PreparedCardImage : IDisposable
{
    public PreparedCardImage(
        Mat image,
        CardDetectionResult detection,
        ImageQualityResult quality,
        bool perspectiveCorrected,
        double correctedRotationDegrees,
        double safetyMargin,
        bool fallbackUsed,
        bool sourceExifApplied,
        int originalExifOrientation,
        long processingMilliseconds)
    {
        Image = image;
        Detection = detection;
        Quality = quality;
        PerspectiveCorrected = perspectiveCorrected;
        CorrectedRotationDegrees = correctedRotationDegrees;
        SafetyMargin = safetyMargin;
        FallbackUsed = fallbackUsed;
        SourceExifApplied = sourceExifApplied;
        OriginalExifOrientation = originalExifOrientation;
        ProcessingMilliseconds = processingMilliseconds;
    }

    public Mat Image { get; }
    public CardDetectionResult Detection { get; }
    public ImageQualityResult Quality { get; }
    public bool PerspectiveCorrected { get; }
    public double CorrectedRotationDegrees { get; }
    public double SafetyMargin { get; }
    public bool FallbackUsed { get; }
    public bool SourceExifApplied { get; }
    public int OriginalExifOrientation { get; }
    public long ProcessingMilliseconds { get; }

    public bool Reliable => Detection.Confidence >= 0.67 && Detection.BorderComplete && !FallbackUsed;

    public void Dispose() => Image.Dispose();
}

public enum CardRegionKind
{
    TopHeader,
    Artwork,
    Body,
    BottomMetadata,
    PrimaryIdentifier,
    WholeCard
}

public sealed record CardRegion(
    CardRegionKind Kind,
    double X,
    double Y,
    double Width,
    double Height,
    string Name);

public sealed class OcrRegionImage : IDisposable
{
    public OcrRegionImage(string variant, CardRegion region, Mat image)
    {
        Variant = variant;
        Region = region;
        Image = image;
    }

    public string Variant { get; }
    public CardRegion Region { get; }
    public Mat Image { get; }

    public void Dispose() => Image.Dispose();
}

public sealed record VisualMatchResult(
    double Similarity,
    double Whole,
    double Header,
    double Artwork,
    double Text,
    double Footer,
    double Feature,
    bool Reliable,
    string Method,
    long ElapsedMilliseconds);
