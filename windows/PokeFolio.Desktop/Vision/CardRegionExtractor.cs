using OpenCvSharp;
using Size = OpenCvSharp.Size;

namespace PokeFolio.Desktop.Vision;

public sealed class CardRegionExtractor
{
    private static readonly CardRegion PokemonIdentifier = new(
        CardRegionKind.PrimaryIdentifier, 0, 0.80, 0.72, 0.185, "BOTTOM_METADATA");
    private static readonly CardRegion PokemonHeader = new(
        CardRegionKind.TopHeader, 0, 0, 1, 0.23, "TOP_HEADER");
    private static readonly CardRegion AutoIdentifier = new(
        CardRegionKind.PrimaryIdentifier, 0, 0.70, 1, 0.295, "BOTTOM_METADATA");
    private static readonly CardRegion YuGiOhIdentifier = new(
        CardRegionKind.PrimaryIdentifier, 0, 0.73, 1, 0.27, "BOTTOM_METADATA");
    private static readonly CardRegion YuGiOhHeader = new(
        CardRegionKind.TopHeader, 0.04, 0.02, 0.92, 0.16, "TOP_HEADER");
    private static readonly CardRegion OnePieceIdentifier = new(
        CardRegionKind.PrimaryIdentifier, 0, 0.70, 1, 0.30, "BOTTOM_METADATA");
    private static readonly CardRegion OnePieceName = new(
        CardRegionKind.TopHeader, 0, 0.56, 1, 0.31, "TOP_HEADER");
    private static readonly CardRegion Whole = new(
        CardRegionKind.WholeCard, 0, 0, 1, 1, "WHOLE_CARD");

    public CardRegion PrimaryIdentifier(string profile) => NormalizeProfile(profile) switch
    {
        "yugioh" => YuGiOhIdentifier,
        "onepiece" => OnePieceIdentifier,
        "auto" => AutoIdentifier,
        _ => PokemonIdentifier
    };

    public CardRegion Header(string profile) => NormalizeProfile(profile) switch
    {
        "yugioh" => YuGiOhHeader,
        "onepiece" => OnePieceName,
        _ => PokemonHeader
    };

    public IReadOnlyList<OcrRegionImage> CreateIdentifierVariants(Mat uprightCard, string profile)
    {
        var region = PrimaryIdentifier(profile);
        var normalizedProfile = NormalizeProfile(profile);
        var prefix = normalizedProfile == "pokemon" ? "unterkante-idzone" :
            normalizedProfile == "yugioh" ? "unterkante-yugioh" :
            normalizedProfile == "onepiece" ? "unterkante-onepiece" : "unterkante-auto";
        using var crop = Crop(uprightCard, region);
        var width = normalizedProfile == "pokemon" ? 1500 : 1700;
        using var large = ResizeToWidth(crop, width);
        var variants = new List<OcrRegionImage>
        {
            new(prefix + "-original-0", region, large.Clone())
        };
        using var gray = new Mat();
        Cv2.CvtColor(large, gray, ColorConversionCodes.BGR2GRAY);
        variants.Add(new OcrRegionImage(prefix + "-grau-0", region, gray.Clone()));
        using var contrast = new Mat();
        using (var clahe = Cv2.CreateCLAHE(2.2, new Size(8, 8))) clahe.Apply(gray, contrast);
        variants.Add(new OcrRegionImage(prefix + "-kontrast-0", region, contrast.Clone()));
        using var sharpened = new Mat();
        using var blurred = new Mat();
        Cv2.GaussianBlur(contrast, blurred, new Size(0, 0), 1.1);
        Cv2.AddWeighted(contrast, 1.75, blurred, -0.75, 0, sharpened);
        variants.Add(new OcrRegionImage(prefix + "-3x-scharf-0", region, sharpened.Clone()));
        return variants;
    }

    public IReadOnlyList<OcrRegionImage> CreateHeaderVariants(Mat uprightCard, string profile)
    {
        var region = Header(profile);
        using var crop = Crop(uprightCard, region);
        using var large = ResizeToWidth(crop, 1400);
        using var gray = new Mat();
        Cv2.CvtColor(large, gray, ColorConversionCodes.BGR2GRAY);
        using var contrast = new Mat();
        Cv2.EqualizeHist(gray, contrast);
        return new List<OcrRegionImage>
        {
            new("header-original", region, large.Clone()),
            new("header-contrast", region, contrast.Clone())
        };
    }

    public OcrRegionImage CreateWholeCard(Mat uprightCard) =>
        new("whole-card-fallback", Whole, ResizeToWidth(uprightCard, 1500));

    public OcrRegionImage CreateOrientationProbe(Mat candidate, string profile, int rotation)
    {
        var region = PrimaryIdentifier(profile);
        using var crop = Crop(candidate, region);
        return new OcrRegionImage("orientation-" + rotation, region, ResizeToWidth(crop, 950));
    }

    public Mat Crop(Mat image, CardRegion region)
    {
        var x = Math.Clamp((int)Math.Round(image.Width * region.X), 0, image.Width - 2);
        var y = Math.Clamp((int)Math.Round(image.Height * region.Y), 0, image.Height - 2);
        var right = Math.Clamp((int)Math.Round(image.Width * (region.X + region.Width)), x + 2, image.Width);
        var bottom = Math.Clamp((int)Math.Round(image.Height * (region.Y + region.Height)), y + 2, image.Height);
        return new Mat(image, new Rect(x, y, right - x, bottom - y)).Clone();
    }

    private static Mat ResizeToWidth(Mat source, int targetWidth)
    {
        var output = new Mat();
        var scale = targetWidth / (double)Math.Max(1, source.Width);
        Cv2.Resize(source, output, new Size(targetWidth, Math.Max(2, (int)Math.Round(source.Height * scale))),
            interpolation: scale >= 1 ? InterpolationFlags.Cubic : InterpolationFlags.Area);
        return output;
    }

    private static string NormalizeProfile(string profile) =>
        profile?.Trim().ToLowerInvariant() switch
        {
            "yugioh" => "yugioh",
            "onepiece" => "onepiece",
            "auto" => "auto",
            _ => "pokemon"
        };
}
