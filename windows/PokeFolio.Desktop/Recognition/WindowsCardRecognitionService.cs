using System.Diagnostics;
using OpenCvSharp;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Recognition;

public interface IWindowsCardRecognitionService
{
    Task<WindowsRecognitionResult> RecognizeAsync(string dataUrl, string language,
        string requestedProfile, RecognitionRequestMode mode,
        CancellationToken cancellationToken = default);

    Task<WindowsRecognitionResult> RecognizePreparedAsync(Mat normalizedCard, string language,
        string requestedProfile, RecognitionRequestMode mode,
        CancellationToken cancellationToken = default);
}

public sealed class WindowsCardRecognitionService(
    WindowsVisionPipeline vision,
    ITextRecognitionService textRecognition,
    CardRegionExtractor regions,
    CardIdentifierParser identifierParser,
    CardOrientationNormalizer orientationNormalizer) : IWindowsCardRecognitionService
{
    public async Task<WindowsRecognitionResult> RecognizeAsync(
        string dataUrl,
        string language,
        string requestedProfile,
        RecognitionRequestMode mode,
        CancellationToken cancellationToken = default)
    {
        using var prepared = vision.Prepare(dataUrl);
        return await RecognizePreparedAsync(prepared.Image, language, requestedProfile, mode,
            cancellationToken);
    }

    public async Task<WindowsRecognitionResult> RecognizePreparedAsync(
        Mat normalizedCard,
        string language,
        string requestedProfile,
        RecognitionRequestMode mode,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(normalizedCard);
        if (normalizedCard.Empty()) throw new ArgumentException("Das normalisierte Kartenbild ist leer.", nameof(normalizedCard));
        var total = Stopwatch.StartNew();
        var orientationTimer = Stopwatch.StartNew();
        using var oriented = await orientationNormalizer.NormalizeAsync(normalizedCard, language,
            NormalizeProfile(requestedProfile), cancellationToken);
        orientationTimer.Stop();
        var detailed = Stopwatch.StartNew();
        var passes = new List<OcrPass>();
        var texts = new HashSet<string>(StringComparer.Ordinal);
        var warnings = new List<string>();
        IdentifierResult bestIdentifier = identifierParser.Parse("", requestedProfile);

        using (var identifierVariants = new DisposableRegions(
            regions.CreateIdentifierVariants(oriented.Image, requestedProfile)))
        {
            foreach (var variant in identifierVariants.Items)
            {
                var result = await textRecognition.RecognizeAsync(variant.Image, language,
                    CardRegionKind.PrimaryIdentifier, cancellationToken);
                AddPass(passes, texts, variant, result);
                if (!result.Available && result.Warning is not null) warnings.Add(result.Warning);
                var identifier = identifierParser.Parse(result.Text, requestedProfile);
                if (identifier.Confidence > bestIdentifier.Confidence) bestIdentifier = identifier;
            }
        }

        var needsHeader = !bestIdentifier.IsExact && mode != RecognitionRequestMode.BulkFast;
        if (needsHeader)
        {
            using var headerVariants = new DisposableRegions(regions.CreateHeaderVariants(
                oriented.Image, requestedProfile));
            foreach (var variant in headerVariants.Items)
            {
                var result = await textRecognition.RecognizeAsync(variant.Image, language,
                    CardRegionKind.TopHeader, cancellationToken);
                AddPass(passes, texts, variant, result);
                if (!result.Available && result.Warning is not null) warnings.Add(result.Warning);
            }
        }

        if (mode == RecognitionRequestMode.Full && !bestIdentifier.IsExact && texts.Count == 0)
        {
            using var whole = regions.CreateWholeCard(oriented.Image);
            var result = await textRecognition.RecognizeAsync(whole.Image, language,
                CardRegionKind.WholeCard, cancellationToken);
            AddPass(passes, texts, whole, result);
            if (!result.Available && result.Warning is not null) warnings.Add(result.Warning);
        }

        detailed.Stop();
        total.Stop();
        var ok = texts.Count > 0 || bestIdentifier.Value.Length > 0;
        return new WindowsRecognitionResult(
            ok,
            string.Join('\n', texts),
            passes,
            language,
            bestIdentifier.Profile,
            mode.ToString().ToUpperInvariant(),
            oriented.Rotation,
            oriented.Score,
            oriented.SecondScore,
            oriented.Confident,
            bestIdentifier,
            orientationTimer.ElapsedMilliseconds,
            detailed.ElapsedMilliseconds,
            total.ElapsedMilliseconds,
            warnings.Distinct().FirstOrDefault());
    }

    private static void AddPass(List<OcrPass> passes, HashSet<string> texts,
        OcrRegionImage variant, TextRecognitionResult result)
    {
        if (!string.IsNullOrWhiteSpace(result.Text)) texts.Add(result.Text.Trim());
        passes.Add(new OcrPass(variant.Variant, variant.Region.Name, variant.Image.Width,
            variant.Image.Height, result.Text, result.Lines, result.ElapsedMilliseconds));
    }

    private static string NormalizeProfile(string value) => value?.Trim().ToLowerInvariant() switch
    {
        "yugioh" => "yugioh",
        "onepiece" => "onepiece",
        "pokemon" => "pokemon",
        _ => "auto"
    };

    private sealed class DisposableRegions(IReadOnlyList<OcrRegionImage> items) : IDisposable
    {
        public IReadOnlyList<OcrRegionImage> Items { get; } = items;
        public void Dispose()
        {
            foreach (var item in Items) item.Dispose();
        }
    }
}
