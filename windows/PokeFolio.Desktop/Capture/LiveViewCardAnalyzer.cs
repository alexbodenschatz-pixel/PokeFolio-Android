using System.Diagnostics;
using OpenCvSharp;
using PokeFolio.Desktop.Vision;
using Size = OpenCvSharp.Size;

namespace PokeFolio.Desktop.Capture;

public sealed record LiveViewCardAnalysis(
    CardDetectionResult Detection,
    double MotionScore,
    double SharpnessScore,
    double ExposureScore,
    string Fingerprint,
    long ElapsedMilliseconds);

/// <summary>
/// Lightweight preview analyzer used only for contour, motion and capture readiness. It never
/// performs OCR, API calls, candidate retrieval or visual database matching.
/// </summary>
public sealed class LiveViewCardAnalyzer(CardDetector detector)
{
    private IReadOnlyList<CardPoint>? previousQuad;

    public LiveViewCardAnalysis Analyze(byte[] jpegBytes)
    {
        var timer = Stopwatch.StartNew();
        using var source = Cv2.ImDecode(jpegBytes, ImreadModes.Color | ImreadModes.IgnoreOrientation);
        if (source.Empty()) throw new InvalidDataException("Live-View-Frame konnte nicht dekodiert werden.");
        using var preview = Limit(source, 720);
        var detection = detector.Detect(preview);
        var motion = Motion(detection.DetectedQuad, preview.Width, preview.Height);
        previousQuad = detection.FourCornersDetected ? detection.DetectedQuad.ToArray() : null;
        using var gray = new Mat();
        Cv2.CvtColor(preview, gray, ColorConversionCodes.BGR2GRAY);
        using var laplacian = new Mat();
        Cv2.Laplacian(gray, laplacian, MatType.CV_64F);
        Cv2.MeanStdDev(laplacian, out _, out var deviation);
        var sharpness = Math.Clamp(1 - Math.Exp(-(deviation.Val0 * deviation.Val0) / 360d), 0, 1);
        var mean = gray.Mean().Val0;
        var exposure = Math.Clamp(1 - Math.Abs(mean - 132d) / 125d, 0, 1);
        var fingerprint = AverageHash(gray);
        timer.Stop();
        return new LiveViewCardAnalysis(detection, motion, sharpness, exposure, fingerprint,
            timer.ElapsedMilliseconds);
    }

    private static Mat Limit(Mat source, int maximumSide)
    {
        var scale = Math.Min(1d, maximumSide / (double)Math.Max(source.Width, source.Height));
        if (scale >= .999) return source.Clone();
        var result = new Mat();
        Cv2.Resize(source, result, new Size(Math.Max(2, (int)(source.Width * scale)),
            Math.Max(2, (int)(source.Height * scale))), interpolation: InterpolationFlags.Area);
        return result;
    }

    private double Motion(IReadOnlyList<CardPoint> current, int width, int height)
    {
        if (current.Count != 4 || previousQuad?.Count != 4) return 1;
        double sum = 0;
        for (var index = 0; index < 4; index++)
        {
            var dx = (current[index].X - previousQuad[index].X) / Math.Max(1, width);
            var dy = (current[index].Y - previousQuad[index].Y) / Math.Max(1, height);
            sum += Math.Sqrt(dx * dx + dy * dy);
        }
        return Math.Clamp(sum / 4d, 0, 1);
    }

    private static string AverageHash(Mat gray)
    {
        using var sample = new Mat();
        Cv2.Resize(gray, sample, new Size(8, 8), interpolation: InterpolationFlags.Area);
        var average = sample.Mean().Val0;
        ulong bits = 0;
        for (var y = 0; y < 8; y++)
        {
            for (var x = 0; x < 8; x++)
            {
                bits <<= 1;
                if (sample.At<byte>(y, x) >= average) bits |= 1;
            }
        }
        return bits.ToString("X16");
    }
}
