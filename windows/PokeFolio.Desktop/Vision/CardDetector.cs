using OpenCvSharp;
using Size = OpenCvSharp.Size;

namespace PokeFolio.Desktop.Vision;

/// <summary>TCG-independent outer-card detector. It never performs OCR or API work.</summary>
public sealed class CardDetector
{
    private const double MinimumCoverage = 0.075;

    public CardDetectionResult Detect(Mat source)
    {
        if (source.Empty()) return Empty("empty-image");
        var scale = Math.Min(1d, 900d / Math.Max(source.Width, source.Height));
        using var analysis = new Mat();
        Cv2.Resize(source, analysis, new Size(), scale, scale, InterpolationFlags.Area);
        using var gray = new Mat();
        Cv2.CvtColor(analysis, gray, ColorConversionCodes.BGR2GRAY);
        Cv2.GaussianBlur(gray, gray, new Size(5, 5), 0);
        using var edges = new Mat();
        var median = gray.Mean().Val0;
        Cv2.Canny(gray, edges, Math.Max(24, median * 0.45), Math.Min(220, median * 1.35));
        using var kernel = Cv2.GetStructuringElement(MorphShapes.Rect, new Size(5, 5));
        Cv2.MorphologyEx(edges, edges, MorphTypes.Close, kernel, iterations: 2);
        Cv2.FindContours(edges, out var contours, out _, RetrievalModes.List,
            ContourApproximationModes.ApproxSimple);

        Candidate? best = null;
        var imageArea = analysis.Width * analysis.Height;
        foreach (var contour in contours)
        {
            var area = Math.Abs(Cv2.ContourArea(contour));
            if (area / imageArea < MinimumCoverage) continue;
            var perimeter = Cv2.ArcLength(contour, true);
            var polygon = Cv2.ApproxPolyDP(contour, perimeter * 0.018, true);
            if (polygon.Length != 4 || !Cv2.IsContourConvex(polygon)) continue;
            var ordered = Order(polygon.Select(point => new Point2f(point.X, point.Y)).ToArray());
            var coverage = PolygonArea(ordered) / imageArea;
            var shortLongRatio = AspectRatio(ordered);
            var aspectScore = Math.Max(
                GaussianScore(shortLongRatio, 63d / 88d, 0.13),
                GaussianScore(shortLongRatio, 59d / 86d, 0.13));
            if (shortLongRatio < 0.48 || shortLongRatio > 0.90) continue;
            var borderComplete = ordered.All(point => point.X > 2 && point.Y > 2
                && point.X < analysis.Width - 3 && point.Y < analysis.Height - 3);
            var rectangle = Cv2.MinAreaRect(polygon);
            var rectangularity = Math.Clamp(area / Math.Max(1d, rectangle.Size.Width * rectangle.Size.Height), 0, 1);
            var coverageScore = Math.Clamp((coverage - MinimumCoverage) / 0.55, 0, 1);
            var confidence = Math.Clamp(
                aspectScore * 0.43 + rectangularity * 0.28 + coverageScore * 0.21
                + (borderComplete ? 0.08 : 0.015), 0, 1);
            var candidate = new Candidate(ordered, confidence, coverage, shortLongRatio, borderComplete);
            if (best is null || candidate.Confidence > best.Confidence) best = candidate;
        }

        if (best is null) return Empty("conservative-full-image-fallback");
        var inverse = 1d / scale;
        var mapped = best.Points
            .Select(point => new CardPoint(point.X * inverse, point.Y * inverse)).ToArray();
        return new CardDetectionResult(
            true,
            best.AspectRatio,
            best.Confidence,
            best.Coverage,
            best.BorderComplete,
            mapped,
            "opencv-largest-plausible-quad");
    }

    private static CardDetectionResult Empty(string method) => new(
        false, 0, 0, 0, false, Array.Empty<CardPoint>(), method);

    internal static Point2f[] Order(Point2f[] points)
    {
        if (points.Length != 4) throw new ArgumentException("A card quad requires four points.");
        var topLeft = points.MinBy(point => point.X + point.Y);
        var bottomRight = points.MaxBy(point => point.X + point.Y);
        var topRight = points.MaxBy(point => point.X - point.Y);
        var bottomLeft = points.MinBy(point => point.X - point.Y);
        return [topLeft, topRight, bottomRight, bottomLeft];
    }

    internal static double AspectRatio(IReadOnlyList<Point2f> points)
    {
        var width = (Distance(points[0], points[1]) + Distance(points[3], points[2])) / 2d;
        var height = (Distance(points[0], points[3]) + Distance(points[1], points[2])) / 2d;
        return Math.Min(width, height) / Math.Max(1d, Math.Max(width, height));
    }

    private static double Distance(Point2f first, Point2f second) =>
        Math.Sqrt(Math.Pow(first.X - second.X, 2) + Math.Pow(first.Y - second.Y, 2));

    private static double PolygonArea(IReadOnlyList<Point2f> points)
    {
        double sum = 0;
        for (var index = 0; index < points.Count; index++)
        {
            var next = points[(index + 1) % points.Count];
            sum += points[index].X * next.Y - next.X * points[index].Y;
        }
        return Math.Abs(sum) / 2d;
    }

    private static double GaussianScore(double value, double target, double tolerance)
    {
        var delta = (value - target) / tolerance;
        return Math.Exp(-(delta * delta));
    }

    private sealed record Candidate(
        Point2f[] Points,
        double Confidence,
        double Coverage,
        double AspectRatio,
        bool BorderComplete);
}
