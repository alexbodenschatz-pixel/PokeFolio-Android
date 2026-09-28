using OpenCvSharp;
using Size = OpenCvSharp.Size;

namespace PokeFolio.Desktop.Vision;

public sealed class CardPerspectiveCorrector
{
    public const int NormalizedWidth = 900;
    public const int NormalizedHeight = 1257;

    public Mat Normalize(Mat source, CardDetectionResult detection, out double safetyMargin,
        out bool perspectiveCorrected, out bool fallbackUsed)
    {
        if (detection.FourCornersDetected && detection.DetectedQuad.Count == 4
            && detection.Confidence >= 0.48)
        {
            safetyMargin = detection.Confidence >= 0.82 ? 0.018
                : detection.Confidence >= 0.65 ? 0.024 : 0.032;
            var points = detection.DetectedQuad.Select(point =>
                new Point2f((float)point.X, (float)point.Y)).ToArray();
            points = OrientForPortraitOutput(points);
            points = Expand(points, source.Width, source.Height, safetyMargin);
            var destination = new[]
            {
                new Point2f(0, 0),
                new Point2f(NormalizedWidth - 1, 0),
                new Point2f(NormalizedWidth - 1, NormalizedHeight - 1),
                new Point2f(0, NormalizedHeight - 1)
            };
            using var matrix = Cv2.GetPerspectiveTransform(points, destination);
            var output = new Mat();
            Cv2.WarpPerspective(source, output, matrix,
                new Size(NormalizedWidth, NormalizedHeight), InterpolationFlags.Lanczos4,
                BorderTypes.Replicate);
            perspectiveCorrected = true;
            fallbackUsed = false;
            return output;
        }

        safetyMargin = 0;
        perspectiveCorrected = false;
        fallbackUsed = true;
        return FitCompleteImage(source);
    }

    /// <summary>
    /// A detected portrait card can occupy a landscape source when the file or camera was
    /// physically rotated by 90 degrees.  Map the card's short edge to the normalized width
    /// before applying the homography; otherwise the warp stretches the long edge to 900px
    /// and squashes the short edge to 1257px.  Card content orientation is deliberately left
    /// to <c>CardOrientationNormalizer</c>, which runs once after this geometric correction.
    /// </summary>
    internal static Point2f[] OrientForPortraitOutput(Point2f[] ordered)
    {
        if (ordered.Length != 4) throw new ArgumentException("A card quad requires four points.");
        var horizontal = (Distance(ordered[0], ordered[1]) + Distance(ordered[3], ordered[2])) / 2d;
        var vertical = (Distance(ordered[0], ordered[3]) + Distance(ordered[1], ordered[2])) / 2d;
        return horizontal <= vertical
            ? ordered
            : [ordered[1], ordered[2], ordered[3], ordered[0]];
    }

    private static double Distance(Point2f first, Point2f second) =>
        Math.Sqrt(Math.Pow(first.X - second.X, 2) + Math.Pow(first.Y - second.Y, 2));

    private static Point2f[] Expand(Point2f[] points, int width, int height, double fraction)
    {
        var centerX = points.Average(point => point.X);
        var centerY = points.Average(point => point.Y);
        return points.Select(point => new Point2f(
            (float)Math.Clamp(centerX + (point.X - centerX) * (1 + fraction * 2), 0, width - 1),
            (float)Math.Clamp(centerY + (point.Y - centerY) * (1 + fraction * 2), 0, height - 1)))
            .ToArray();
    }

    private static Mat FitCompleteImage(Mat source)
    {
        var scale = Math.Min(NormalizedWidth / (double)source.Width,
            NormalizedHeight / (double)source.Height);
        var width = Math.Max(1, (int)Math.Round(source.Width * scale));
        var height = Math.Max(1, (int)Math.Round(source.Height * scale));
        using var resized = new Mat();
        Cv2.Resize(source, resized, new Size(width, height), interpolation: InterpolationFlags.Area);
        var color = source.Mean();
        var output = new Mat(NormalizedHeight, NormalizedWidth, MatType.CV_8UC3, color);
        var x = (NormalizedWidth - width) / 2;
        var y = (NormalizedHeight - height) / 2;
        using var target = new Mat(output, new Rect(x, y, width, height));
        resized.CopyTo(target);
        return output;
    }
}
