using OpenCvSharp;

namespace PokeFolio.Desktop.Vision;

public sealed record CenteringResult(
    double LeftPercent,
    double RightPercent,
    double TopPercent,
    double BottomPercent,
    double Confidence,
    bool Reliable);

/// <summary>
/// Conservative printed-frame estimate. Raw ratios are exposed only when opposing projection
/// peaks are sufficiently strong; low-confidence cards remain explicitly uncertain.
/// </summary>
public sealed class CenteringAnalyzer
{
    public CenteringResult Analyze(Mat normalizedCard)
    {
        using var gray = new Mat();
        Cv2.CvtColor(normalizedCard, gray, ColorConversionCodes.BGR2GRAY);
        using var edges = new Mat();
        Cv2.Canny(gray, edges, 55, 150);
        var vertical = Projection(edges, columns: true);
        var horizontal = Projection(edges, columns: false);
        var left = Peak(vertical, (int)(vertical.Length * 0.02), (int)(vertical.Length * 0.24));
        var right = Peak(vertical, (int)(vertical.Length * 0.76), (int)(vertical.Length * 0.98));
        var top = Peak(horizontal, (int)(horizontal.Length * 0.02), (int)(horizontal.Length * 0.24));
        var bottom = Peak(horizontal, (int)(horizontal.Length * 0.76), (int)(horizontal.Length * 0.98));
        var leftMargin = Math.Max(1, left.Index);
        var rightMargin = Math.Max(1, vertical.Length - 1 - right.Index);
        var topMargin = Math.Max(1, top.Index);
        var bottomMargin = Math.Max(1, horizontal.Length - 1 - bottom.Index);
        var horizontalTotal = leftMargin + rightMargin;
        var verticalTotal = topMargin + bottomMargin;
        var confidence = Math.Clamp(Math.Min(left.Strength, right.Strength)
            * Math.Min(top.Strength, bottom.Strength) * 3.2, 0, 1);
        return new CenteringResult(
            leftMargin / (double)horizontalTotal * 100,
            rightMargin / (double)horizontalTotal * 100,
            topMargin / (double)verticalTotal * 100,
            bottomMargin / (double)verticalTotal * 100,
            confidence,
            confidence >= 0.58);
    }

    private static double[] Projection(Mat edges, bool columns)
    {
        var length = columns ? edges.Width : edges.Height;
        var other = columns ? edges.Height : edges.Width;
        var result = new double[length];
        for (var primary = 0; primary < length; primary++)
        {
            double sum = 0;
            for (var secondary = 0; secondary < other; secondary++)
            {
                var x = columns ? primary : secondary;
                var y = columns ? secondary : primary;
                sum += edges.At<byte>(y, x) / 255d;
            }
            result[primary] = sum / Math.Max(1, other);
        }
        return result;
    }

    private static (int Index, double Strength) Peak(double[] values, int start, int end)
    {
        start = Math.Clamp(start, 0, values.Length - 1);
        end = Math.Clamp(end, start + 1, values.Length);
        var index = start;
        for (var current = start + 1; current < end; current++)
            if (values[current] > values[index]) index = current;
        return (index, values[index]);
    }
}
