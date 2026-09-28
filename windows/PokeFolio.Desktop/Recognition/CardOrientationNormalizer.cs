using System.Diagnostics;
using OpenCvSharp;
using PokeFolio.Desktop.Vision;
using Size = OpenCvSharp.Size;

namespace PokeFolio.Desktop.Recognition;

public sealed class CardOrientationNormalizer(
    ITextRecognitionService textRecognition,
    CardRegionExtractor regions,
    CardIdentifierParser identifierParser)
{
    public async Task<OrientedCard> NormalizeAsync(Mat source, string language, string profile,
        CancellationToken cancellationToken = default)
    {
        var probes = new List<OrientationProbe>();
        foreach (var rotation in new[] { 0, 90, 180, 270 })
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var candidate = RotateFromSource(source, rotation);
            using var probe = regions.CreateOrientationProbe(candidate, profile, rotation);
            var recognized = await textRecognition.RecognizeAsync(probe.Image, language,
                CardRegionKind.PrimaryIdentifier, cancellationToken);
            var identifier = identifierParser.Parse(recognized.Text, profile);
            var score = Score(identifier, recognized.Text, profile);
            probes.Add(new OrientationProbe(rotation, score, recognized.Text, identifier));
        }

        var ordered = probes.OrderByDescending(probe => probe.Score).ToArray();
        var best = ordered[0];
        var second = ordered.Length > 1 ? ordered[1].Score : 0;
        var margin = best.Score - second;
        var confident = best.Rotation == 0 || best.Score >= 3.0
            && margin >= Math.Max(1.1, best.Score * 0.14);
        var applied = confident ? best.Rotation : 0;
        var output = RotateFromSource(source, applied);
        if (output.Width != CardPerspectiveCorrector.NormalizedWidth
            || output.Height != CardPerspectiveCorrector.NormalizedHeight)
        {
            var resized = new Mat();
            Cv2.Resize(output, resized, new Size(CardPerspectiveCorrector.NormalizedWidth,
                CardPerspectiveCorrector.NormalizedHeight), interpolation: InterpolationFlags.Area);
            output.Dispose();
            output = resized;
        }
        return new OrientedCard(output, applied, best.Score, second, confident, probes);
    }

    internal static double Score(IdentifierResult identifier, string text, string profile)
    {
        var score = identifier.IsExact ? 9 : identifier.Value.Length > 0 ? 5 : 0;
        var upper = (text ?? "").ToUpperInvariant();
        if (profile == "pokemon" || profile == "auto")
        {
            if (identifier.CollectorNumber.Length > 0) score += 5;
            if (System.Text.RegularExpressions.Regex.IsMatch(upper, @"\b(?:HP|KP)\s*[0-9OIL|]{2,3}\b")) score += 2;
        }
        if (profile == "yugioh" || profile == "auto")
        {
            if (identifier.Passcode.Length == 8) score += 6;
            if (identifier.SetCode.Length > 0) score += 4;
            if (upper.Contains("ATK") || upper.Contains("DEF")) score += 1;
        }
        if (profile == "onepiece" || profile == "auto")
        {
            if (identifier.CardCode.Length > 0) score += 7;
            if (upper.Contains("COUNTER") || upper.Contains("CHARACTER")) score += 1;
        }
        return score;
    }

    public static Mat RotateFromSource(Mat source, int rotation)
    {
        if (rotation == 0) return source.Clone();
        var output = new Mat();
        Cv2.Rotate(source, output, rotation switch
        {
            90 => RotateFlags.Rotate90Clockwise,
            180 => RotateFlags.Rotate180,
            270 => RotateFlags.Rotate90Counterclockwise,
            _ => throw new ArgumentOutOfRangeException(nameof(rotation))
        });
        return output;
    }
}
