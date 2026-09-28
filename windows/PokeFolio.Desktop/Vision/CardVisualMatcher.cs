using System.Diagnostics;
using OpenCvSharp;
using Size = OpenCvSharp.Size;

namespace PokeFolio.Desktop.Vision;

/// <summary>Regional exposure-tolerant comparison for an already small candidate pool.</summary>
public sealed class CardVisualMatcher
{
    private static readonly Rect2d Whole = new(0.025, 0.025, 0.95, 0.95);
    private static readonly Rect2d Header = new(0.045, 0.025, 0.91, 0.165);
    private static readonly Rect2d Artwork = new(0.045, 0.14, 0.91, 0.52);
    private static readonly Rect2d Text = new(0.045, 0.54, 0.91, 0.32);
    private static readonly Rect2d Footer = new(0.035, 0.73, 0.93, 0.255);

    public VisualMatchResult Compare(Mat scan, Mat reference, bool reliable = true,
        string method = "windows-opencv-regional")
    {
        var timer = Stopwatch.StartNew();
        using var left = Standardize(scan);
        using var right = Standardize(reference);
        var whole = CompareRegion(left, right, Whole);
        var header = CompareRegion(left, right, Header);
        var artwork = CompareRegion(left, right, Artwork);
        var text = CompareRegion(left, right, Text);
        var footer = CompareRegion(left, right, Footer);
        var feature = FeatureSimilarity(left, right, Artwork);
        var artworkWithFeatures = Math.Clamp(artwork * 0.76 + feature * 0.24, 0, 1);
        var combined = Math.Clamp(whole * 0.13 + header * 0.10 + artworkWithFeatures * 0.49
            + text * 0.13 + footer * 0.15, 0, 1);
        timer.Stop();
        return new VisualMatchResult(combined, whole, header, artworkWithFeatures, text, footer,
            feature, reliable, method, timer.ElapsedMilliseconds);
    }

    private static Mat Standardize(Mat source)
    {
        var output = new Mat();
        Cv2.Resize(source, output,
            new Size(CardPerspectiveCorrector.NormalizedWidth, CardPerspectiveCorrector.NormalizedHeight),
            interpolation: InterpolationFlags.Area);
        return output;
    }

    private static double CompareRegion(Mat left, Mat right, Rect2d region)
    {
        using var a = SampleGray(left, region, 32, 32);
        using var b = SampleGray(right, region, 32, 32);
        var pHash = 1 - Hamming(PerceptualHash(a) ^ PerceptualHash(b)) / 64d;
        var dHash = 1 - Hamming(DifferenceHash(a) ^ DifferenceHash(b)) / 64d;
        var correlation = Correlation(a, b);
        using var gradientA = Gradient(a);
        using var gradientB = Gradient(b);
        var gradient = Correlation(gradientA, gradientB);
        var histogram = HistogramSimilarity(left, right, region);
        return Math.Clamp(pHash * 0.28 + dHash * 0.22 + correlation * 0.21
            + gradient * 0.20 + histogram * 0.09, 0, 1);
    }

    private static Mat SampleGray(Mat source, Rect2d region, int width, int height)
    {
        using var crop = Crop(source, region);
        using var gray = new Mat();
        Cv2.CvtColor(crop, gray, ColorConversionCodes.BGR2GRAY);
        var output = new Mat();
        Cv2.Resize(gray, output, new Size(width, height), interpolation: InterpolationFlags.Area);
        return output;
    }

    private static ulong PerceptualHash(Mat gray)
    {
        using var values = new Mat();
        gray.ConvertTo(values, MatType.CV_64F);
        using var dct = new Mat();
        Cv2.Dct(values, dct);
        var coefficients = new List<double>(64);
        for (var y = 0; y < 8; y++)
        {
            for (var x = 0; x < 8; x++) coefficients.Add(dct.At<double>(y, x));
        }
        var median = coefficients.Skip(1).OrderBy(value => value).ElementAt(31);
        ulong hash = 0;
        foreach (var value in coefficients)
        {
            hash <<= 1;
            if (value >= median) hash |= 1;
        }
        return hash;
    }

    private static ulong DifferenceHash(Mat gray)
    {
        using var sample = new Mat();
        Cv2.Resize(gray, sample, new Size(9, 8), interpolation: InterpolationFlags.Area);
        ulong hash = 0;
        for (var y = 0; y < 8; y++)
        {
            for (var x = 0; x < 8; x++)
            {
                hash <<= 1;
                if (sample.At<byte>(y, x) < sample.At<byte>(y, x + 1)) hash |= 1;
            }
        }
        return hash;
    }

    private static int Hamming(ulong value)
    {
        var count = 0;
        while (value != 0)
        {
            count += (int)(value & 1);
            value >>= 1;
        }
        return count;
    }

    private static double Correlation(Mat left, Mat right)
    {
        using var leftFloat = new Mat();
        using var rightFloat = new Mat();
        left.ConvertTo(leftFloat, MatType.CV_32F);
        right.ConvertTo(rightFloat, MatType.CV_32F);
        using var result = new Mat();
        Cv2.MatchTemplate(leftFloat, rightFloat, result, TemplateMatchModes.CCoeffNormed);
        return Math.Clamp((result.At<float>(0, 0) + 1) / 2d, 0, 1);
    }

    private static Mat Gradient(Mat gray)
    {
        using var x = new Mat();
        using var y = new Mat();
        Cv2.Sobel(gray, x, MatType.CV_32F, 1, 0);
        Cv2.Sobel(gray, y, MatType.CV_32F, 0, 1);
        var magnitude = new Mat();
        Cv2.Magnitude(x, y, magnitude);
        return magnitude;
    }

    private static double HistogramSimilarity(Mat left, Mat right, Rect2d region)
    {
        using var a = Crop(left, region);
        using var b = Crop(right, region);
        using var hsvA = new Mat();
        using var hsvB = new Mat();
        Cv2.CvtColor(a, hsvA, ColorConversionCodes.BGR2HSV);
        Cv2.CvtColor(b, hsvB, ColorConversionCodes.BGR2HSV);
        using var histA = new Mat();
        using var histB = new Mat();
        Cv2.CalcHist([hsvA], [0, 1], null, histA, 2, [18, 16],
            [new Rangef(0, 180), new Rangef(0, 256)]);
        Cv2.CalcHist([hsvB], [0, 1], null, histB, 2, [18, 16],
            [new Rangef(0, 180), new Rangef(0, 256)]);
        Cv2.Normalize(histA, histA, 1, 0, NormTypes.L1);
        Cv2.Normalize(histB, histB, 1, 0, NormTypes.L1);
        return Math.Clamp(1 - Cv2.CompareHist(histA, histB, HistCompMethods.Bhattacharyya), 0, 1);
    }

    private static double FeatureSimilarity(Mat left, Mat right, Rect2d region)
    {
        using var a = Crop(left, region);
        using var b = Crop(right, region);
        using var grayA = new Mat();
        using var grayB = new Mat();
        Cv2.CvtColor(a, grayA, ColorConversionCodes.BGR2GRAY);
        Cv2.CvtColor(b, grayB, ColorConversionCodes.BGR2GRAY);
        using var orb = ORB.Create(320);
        using var descriptorsA = new Mat();
        using var descriptorsB = new Mat();
        orb.DetectAndCompute(grayA, null, out _, descriptorsA);
        orb.DetectAndCompute(grayB, null, out _, descriptorsB);
        if (descriptorsA.Empty() || descriptorsB.Empty()) return 0.5;
        using var matcher = new BFMatcher(NormTypes.Hamming);
        var matches = matcher.KnnMatch(descriptorsA, descriptorsB, 2);
        var valid = matches.Count(pair => pair.Length >= 2 && pair[0].Distance < pair[1].Distance * 0.76);
        return Math.Clamp(valid / (double)Math.Max(12, Math.Min(descriptorsA.Rows, descriptorsB.Rows) * 0.35), 0, 1);
    }

    private static Mat Crop(Mat source, Rect2d region)
    {
        var x = Math.Clamp((int)Math.Round(source.Width * region.X), 0, source.Width - 2);
        var y = Math.Clamp((int)Math.Round(source.Height * region.Y), 0, source.Height - 2);
        var width = Math.Clamp((int)Math.Round(source.Width * region.Width), 2, source.Width - x);
        var height = Math.Clamp((int)Math.Round(source.Height * region.Height), 2, source.Height - y);
        return new Mat(source, new Rect(x, y, width, height)).Clone();
    }
}
