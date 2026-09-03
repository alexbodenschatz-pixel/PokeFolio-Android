using OpenCvSharp;
using PokeFolio.Desktop.Capture.Canon;
using PokeFolio.Desktop.Recognition;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Tests;

internal static class SyntheticCard
{
    public static Mat Create(int artworkTone = 70, bool rotate180 = false)
    {
        var canvas = new Mat(1500, 1200, MatType.CV_8UC3, new Scalar(35, 42, 48));
        var card = new Rect(224, 180, 752, 1050);
        Cv2.Rectangle(canvas, card, new Scalar(246, 246, 246), -1);
        Cv2.Rectangle(canvas, card, new Scalar(5, 5, 5), 9);
        Cv2.Rectangle(canvas, new Rect(270, 330, 660, 440),
            new Scalar(artworkTone, 150, 220 - artworkTone / 2), -1);
        Cv2.Rectangle(canvas, new Rect(280, 220, 360, 50), new Scalar(40, 40, 40), -1);
        Cv2.Rectangle(canvas, new Rect(275, 1100, 430, 48), new Scalar(15, 15, 15), -1);
        Cv2.PutText(canvas, "050/195", new Point(290, 1138), HersheyFonts.HersheySimplex,
            1.15, new Scalar(255, 255, 255), 2, LineTypes.AntiAlias);
        if (!rotate180) return canvas;
        var rotated = new Mat();
        Cv2.Rotate(canvas, rotated, RotateFlags.Rotate180);
        canvas.Dispose();
        return rotated;
    }

    public static string DataUrl(int artworkTone = 70)
    {
        using var image = Create(artworkTone);
        return new ImageDataUrlCodec().EncodeJpeg(image, 95);
    }
}

internal sealed class FakeTextRecognitionService(
    Func<Mat, CardRegionKind, string>? recognize = null) : ITextRecognitionService
{
    public Task<TextRecognitionResult> RecognizeAsync(Mat image, string language,
        CardRegionKind region, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var text = recognize?.Invoke(image, region) ?? "050/195";
        var lines = string.IsNullOrWhiteSpace(text)
            ? Array.Empty<RecognizedTextLine>()
            : new[] { new RecognizedTextLine(text, .05, .05, .8, .2) };
        return Task.FromResult(new TextRecognitionResult(true, text, lines, language, 1));
    }
}

internal sealed class FakeRecognitionService(WindowsRecognitionResult result)
    : IWindowsCardRecognitionService
{
    public int RawCalls { get; private set; }
    public int PreparedCalls { get; private set; }

    public Task<WindowsRecognitionResult> RecognizeAsync(string dataUrl, string language,
        string requestedProfile, RecognitionRequestMode mode,
        CancellationToken cancellationToken = default)
    {
        RawCalls++;
        return Task.FromResult(result);
    }

    public Task<WindowsRecognitionResult> RecognizePreparedAsync(Mat normalizedCard,
        string language, string requestedProfile, RecognitionRequestMode mode,
        CancellationToken cancellationToken = default)
    {
        PreparedCalls++;
        return Task.FromResult(result);
    }

    public static WindowsRecognitionResult ExactPokemon(string value = "050/195") => new(
        true, value, Array.Empty<OcrPass>(), "de", "pokemon", "FULL", 0, 12, 1, true,
        new IdentifierResult("pokemon", value, value, "", "", "", "Latin", .96, true),
        2, 3, 5);
}

internal sealed class FakeVisualComparisonService : IVisualComparisonService
{
    public Task<VisualMatchResult> CompareAsync(string scanDataUrl, string referenceUrl,
        bool prepared, bool preparationReliable, string method,
        CancellationToken cancellationToken = default) => Task.FromResult(
            new VisualMatchResult(.91, .9, .88, .94, .86, .89, .83,
                preparationReliable, method, 4));
}

internal sealed class MockCanonAdapter : ICanonEosSdkAdapter
{
    public bool IsSdkAvailable { get; set; } = true;
    public bool IsConnected { get; private set; }
    public string StatusMessage { get; set; } = "Bereit";
    public CanonCameraInfo? ConnectedCamera { get; private set; }
    public bool NeverCompleteCapture { get; set; }
    public bool DisconnectDuringCapture { get; set; }

    public Task<IReadOnlyList<CanonCameraInfo>> EnumerateCamerasAsync(
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<CanonCameraInfo>>(
            new[] { new CanonCameraInfo("eos-1", "Canon EOS 2000D", "mock") });

    public Task ConnectAsync(string cameraId, CancellationToken cancellationToken = default)
    {
        IsConnected = true;
        ConnectedCamera = new CanonCameraInfo(cameraId, "Canon EOS 2000D", "mock");
        return Task.CompletedTask;
    }

    public Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        IsConnected = false;
        ConnectedCamera = null;
        return Task.CompletedTask;
    }

    public async Task<CanonCaptureArtifact> CaptureAsync(string targetDirectory,
        CancellationToken cancellationToken = default)
    {
        if (NeverCompleteCapture)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
        if (DisconnectDuringCapture)
        {
            IsConnected = false;
            ConnectedCamera = null;
            throw new IOException("USB-Verbindung wurde getrennt.");
        }
        Directory.CreateDirectory(targetDirectory);
        var path = Path.Combine(targetDirectory, "mock-" + Guid.NewGuid().ToString("N") + ".jpg");
        var dataUrl = SyntheticCard.DataUrl();
        await File.WriteAllBytesAsync(path, Convert.FromBase64String(dataUrl[(dataUrl.IndexOf(',') + 1)..]),
            cancellationToken);
        return new CanonCaptureArtifact(path, "Canon EOS 2000D");
    }

    public async IAsyncEnumerable<CanonLiveViewFrame> GetLiveViewFramesAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;
        yield break;
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
