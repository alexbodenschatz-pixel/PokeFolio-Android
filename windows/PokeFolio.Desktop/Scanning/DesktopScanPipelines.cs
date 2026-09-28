using System.Collections.Concurrent;
using System.Diagnostics;
using OpenCvSharp;
using PokeFolio.Desktop.Recognition;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Scanning;

public sealed record QuickScanResult(
    WindowsRecognitionResult Recognition,
    string NormalizedDataUrl,
    ImageQualityResult Quality,
    bool UsedFallback,
    long ElapsedMilliseconds);

public sealed class QuickScanPipeline(
    IWindowsVisionPipeline vision,
    IWindowsCardRecognitionService recognition,
    ImageDataUrlCodec codec)
{
    public async Task<QuickScanResult> RunAsync(string dataUrl, string language, string profile,
        CancellationToken cancellationToken = default)
    {
        var timer = Stopwatch.StartNew();
        using var prepared = vision.Prepare(dataUrl);
        var normalized = codec.EncodeJpeg(prepared.Image);
        var result = await recognition.RecognizePreparedAsync(prepared.Image, language, profile,
            RecognitionRequestMode.Full, cancellationToken);
        var usedFallback = !result.Identifier.IsExact;
        timer.Stop();
        return new QuickScanResult(result, normalized, prepared.Quality, usedFallback,
            timer.ElapsedMilliseconds);
    }
}

public sealed class BulkScanPipeline(
    IWindowsCardRecognitionService recognition,
    int maximumCacheEntries = 256)
{
    private readonly ConcurrentDictionary<string, WindowsRecognitionResult> sessionCache = new();
    private readonly ConcurrentQueue<string> cacheOrder = new();

    public int SessionScanned { get; private set; }
    public int SessionCacheHits { get; private set; }

    public async Task<(WindowsRecognitionResult Result, string Source)> RunAsync(
        string dataUrl, string language, string profile, string fingerprint,
        CancellationToken cancellationToken = default)
    {
        SessionScanned++;
        if (!string.IsNullOrWhiteSpace(fingerprint)
            && sessionCache.TryGetValue(fingerprint, out var cached))
        {
            SessionCacheHits++;
            return (cached, "SESSION_CACHE");
        }
        var result = await recognition.RecognizeAsync(dataUrl, language, profile,
            RecognitionRequestMode.BulkFast, cancellationToken);
        if (result.Identifier.IsExact && !string.IsNullOrWhiteSpace(fingerprint))
        {
            sessionCache[fingerprint] = result;
            cacheOrder.Enqueue(fingerprint);
            while (sessionCache.Count > maximumCacheEntries && cacheOrder.TryDequeue(out var oldest))
                sessionCache.TryRemove(oldest, out _);
        }
        return (result, "LOCAL_IDENTIFIER");
    }
}

public sealed record PrecisionCaptureMetadata(
    ImageQualityResult FrontQuality,
    ImageQualityResult BackQuality,
    CenteringResult Centering,
    string CaptureSource,
    string CameraModel,
    int FrontWidth,
    int FrontHeight,
    int BackWidth,
    int BackHeight,
    bool ReadyForGrading,
    IReadOnlyList<string> Warnings);

public sealed record PrecisionScanResult(
    bool Ok,
    string NormalizedFront,
    string NormalizedBack,
    PrecisionCaptureMetadata Metadata);

public sealed class PrecisionScanPipeline(
    IWindowsVisionPipeline vision,
    ImageDataUrlCodec codec,
    CenteringAnalyzer centering)
{
    public Task<PrecisionScanResult> RunAsync(string frontDataUrl, string backDataUrl,
        string source, string cameraModel, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var front = vision.Prepare(frontDataUrl);
        cancellationToken.ThrowIfCancellationRequested();
        using var back = vision.Prepare(backDataUrl);
        var center = centering.Analyze(front.Image);
        var warnings = front.Quality.Warnings.Select(value => "Front: " + value)
            .Concat(back.Quality.Warnings.Select(value => "Back: " + value)).ToArray();
        var ready = front.Quality.AcceptableForPrecisionGrading
            && back.Quality.AcceptableForPrecisionGrading;
        var metadata = new PrecisionCaptureMetadata(front.Quality, back.Quality, center,
            source, cameraModel, front.Image.Width, front.Image.Height, back.Image.Width,
            back.Image.Height, ready, warnings);
        return Task.FromResult(new PrecisionScanResult(ready, codec.EncodeJpeg(front.Image, 94),
            codec.EncodeJpeg(back.Image, 94), metadata));
    }
}
