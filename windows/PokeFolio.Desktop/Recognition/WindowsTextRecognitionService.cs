using System.Diagnostics;
using OpenCvSharp;
using PokeFolio.Desktop.Vision;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace PokeFolio.Desktop.Recognition;

/// <summary>
/// Local Windows OCR. It uses Windows.Media.Ocr and installed OS language packs; no image or text
/// leaves the device and no cloud/API key is required.
/// </summary>
public sealed class WindowsTextRecognitionService : ITextRecognitionService
{
    internal static bool IsRuntimeAvailable(string language)
    {
        try
        {
            var requested = new Language(NormalizeLanguage(language));
            return OcrEngine.IsLanguageSupported(requested)
                || OcrEngine.TryCreateFromUserProfileLanguages() is not null;
        }
        catch
        {
            return false;
        }
    }

    public async Task<TextRecognitionResult> RecognizeAsync(
        Mat image,
        string language,
        CardRegionKind region,
        CancellationToken cancellationToken = default)
    {
        var timer = Stopwatch.StartNew();
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var tag = NormalizeLanguage(language);
            var windowsLanguage = new Language(tag);
            var engine = OcrEngine.IsLanguageSupported(windowsLanguage)
                ? OcrEngine.TryCreateFromLanguage(windowsLanguage)
                : OcrEngine.TryCreateFromUserProfileLanguages();
            if (engine is null)
            {
                return Unavailable(tag, timer, $"Windows-OCR-Sprachpaket {tag} ist nicht installiert.");
            }

            Cv2.ImEncode(".png", image, out var bytes);
            using var stream = new InMemoryRandomAccessStream();
            using (var writer = new DataWriter(stream))
            {
                writer.WriteBytes(bytes);
                await writer.StoreAsync();
                await writer.FlushAsync();
            }
            stream.Seek(0);
            var decoder = await BitmapDecoder.CreateAsync(stream);
            using var softwareBitmap = await decoder.GetSoftwareBitmapAsync(
                BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
            cancellationToken.ThrowIfCancellationRequested();
            var result = await engine.RecognizeAsync(softwareBitmap);
            cancellationToken.ThrowIfCancellationRequested();
            var lines = result.Lines.Select(line =>
            {
                var words = line.Words;
                if (words.Count == 0) return new RecognizedTextLine(line.Text, 0, 0, 0, 0);
                var left = words.Min(word => word.BoundingRect.X);
                var top = words.Min(word => word.BoundingRect.Y);
                var right = words.Max(word => word.BoundingRect.X + word.BoundingRect.Width);
                var bottom = words.Max(word => word.BoundingRect.Y + word.BoundingRect.Height);
                return new RecognizedTextLine(
                    line.Text,
                    Math.Clamp(left / Math.Max(1d, image.Width), 0, 1),
                    Math.Clamp(top / Math.Max(1d, image.Height), 0, 1),
                    Math.Clamp((right - left) / Math.Max(1d, image.Width), 0, 1),
                    Math.Clamp((bottom - top) / Math.Max(1d, image.Height), 0, 1));
            }).Where(line => !string.IsNullOrWhiteSpace(line.Text)).ToArray();
            timer.Stop();
            return new TextRecognitionResult(true, result.Text?.Trim() ?? "", lines,
                engine.RecognizerLanguage?.LanguageTag ?? tag, timer.ElapsedMilliseconds);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return Unavailable(NormalizeLanguage(language), timer,
                "Lokale Windows-OCR ist nicht verfügbar: " + error.Message);
        }
    }

    private static TextRecognitionResult Unavailable(string language, Stopwatch timer, string warning)
    {
        timer.Stop();
        return new TextRecognitionResult(false, "", Array.Empty<RecognizedTextLine>(), language,
            timer.ElapsedMilliseconds, warning);
    }

    internal static string NormalizeLanguage(string language) => language?.Trim().ToLowerInvariant() switch
    {
        "de" or "de-de" => "de-DE",
        "ja" or "ja-jp" => "ja-JP",
        "ko" or "ko-kr" => "ko-KR",
        "zh-tw" or "zh-hant" => "zh-TW",
        "zh" or "zh-cn" or "zh-hans" => "zh-CN",
        _ => "en-US"
    };
}
