using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using PokeFolio.Desktop.Capture;
using PokeFolio.Desktop.Diagnostics;
using PokeFolio.Desktop.Recognition;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Bridge;

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public sealed class PokeNativeBridge : IDisposable
{
    private const int MaximumDataUrlCharacters = 42 * 1024 * 1024;
    private readonly IJavaScriptCallbackDispatcher callbacks;
    private readonly HttpBridgeService http;
    private readonly LocalDataService localData;
    private readonly DesktopStatusService status;
    private readonly ICardCaptureDevice fileCapture;
    private readonly IReadOnlyList<ICardCaptureDevice> captureDevices;
    private readonly IWindowsVisionPipeline vision;
    private readonly ImageDataUrlCodec codec;
    private readonly IWindowsCardRecognitionService recognition;
    private readonly IVisualComparisonService visualComparison;
    private readonly CanonEosCapture canon;
    private readonly SemaphoreSlim recognitionGate = new(2, 2);
    private readonly SemaphoreSlim visualGate = new(2, 2);
    private readonly SemaphoreSlim eosCaptureGate = new(1, 1);
    private readonly CancellationTokenSource lifetime = new();
    private readonly LiveViewCardAnalyzer liveAnalyzer = new(new CardDetector());
    private readonly AutoCaptureStateMachine autoCapture = new();
    private CancellationTokenSource? liveView;
    private volatile bool autoCaptureEnabled;
    private string autoCaptureMode = "quick";
    private string autoCaptureSide = "front";
    private bool disposed;

    public PokeNativeBridge(
        IJavaScriptCallbackDispatcher callbacks,
        HttpBridgeService http,
        LocalDataService localData,
        DesktopStatusService status,
        ICardCaptureDevice fileCapture,
        IReadOnlyList<ICardCaptureDevice> captureDevices,
        IWindowsVisionPipeline vision,
        ImageDataUrlCodec codec,
        IWindowsCardRecognitionService recognition,
        IVisualComparisonService visualComparison,
        CanonEosCapture canon)
    {
        this.callbacks = callbacks;
        this.http = http;
        this.localData = localData;
        this.status = status;
        this.fileCapture = fileCapture;
        this.captureDevices = captureDevices;
        this.vision = vision;
        this.codec = codec;
        this.recognition = recognition;
        this.visualComparison = visualComparison;
        this.canon = canon;
    }

    public string consumeCaptureMetadata() => "";

    public void recognizeCard(string dataUrl, string requestId, string language) =>
        QueueRecognition(dataUrl, requestId, language, "auto", RecognitionRequestMode.Full);

    public void recognizeCardProfiled(string dataUrl, string requestId, string language, string profile) =>
        QueueRecognition(dataUrl, requestId, language, profile, RecognitionRequestMode.Full);

    public void recognizePrimaryIdentifier(string dataUrl, string requestId, string language, string profile) =>
        QueueRecognition(dataUrl, requestId, language, profile, RecognitionRequestMode.PrimaryIdentifier);

    public void recognizeBulkIdentifier(string dataUrl, string requestId, string language, string profile) =>
        QueueRecognition(dataUrl, requestId, language, profile, RecognitionRequestMode.BulkFast);

    public void recognizeText(string dataUrl, string requestId, string language) =>
        QueueRecognition(dataUrl, requestId, language, "auto", RecognitionRequestMode.Full);

    public void httpGet(string url, string requestId) => _ = RunHttpGetAsync(url, requestId);

    public void prepareCardImage(string dataUrl, string requestId) =>
        _ = PrepareCardImageAsync(dataUrl, requestId);

    public void compareCardImage(string dataUrl, string imageUrl, string requestId) =>
        _ = CompareAsync(dataUrl, imageUrl, requestId, false, false, "windows-import");

    public void comparePreparedCardImage(string dataUrl, string imageUrl, string requestId,
        bool reliable, string method) =>
        _ = CompareAsync(dataUrl, imageUrl, requestId, true, reliable, method);

    public void openBulkScanner(string requestId) =>
        _ = CaptureAsync(requestId, "bulk", "onNativeBulkScannerResult");

    public void selectImage(string requestId, string side) =>
        _ = CaptureAsync(requestId, side, "onDesktopImageSelected");

    public void vibrateBulkSuccess()
    {
        // Desktop feedback is visual; this compatibility no-op keeps the shared UI portable.
    }

    public string getDesktopStatus() => JsonSerializer.Serialize(status.GetStatus());

    public string getCaptureDevices()
    {
        var devices = captureDevices.Select(device =>
        {
            var deviceStatus = device.GetStatusAsync().GetAwaiter().GetResult();
            return new
            {
                id = device.Id,
                name = device.DisplayName,
                connected = deviceStatus.Connected,
                available = deviceStatus.Available,
                message = deviceStatus.Message
            };
        });
        return JsonSerializer.Serialize(devices);
    }

    public string getEosStatus()
    {
        var cameraStatus = canon.GetStatusAsync().GetAwaiter().GetResult();
        return JsonSerializer.Serialize(new
        {
            connected = cameraStatus.Connected,
            available = cameraStatus.Available,
            message = cameraStatus.Message,
            model = canon.DisplayName
        });
    }

    public void enumerateEosCameras(string requestId) => _ = EnumerateEosAsync(requestId);
    public void connectEos(string cameraId, string requestId) => _ = ConnectEosAsync(cameraId, requestId);
    public void disconnectEos(string requestId) => _ = DisconnectEosAsync(requestId);
    public void captureEos(string requestId, string side) => _ = CaptureEosAsync(requestId, side);
    public void startEosLiveView(string requestId) => _ = StartLiveViewAsync(requestId);
    public void stopEosLiveView(string requestId) => _ = StopLiveViewAsync(requestId);
    public void setEosAutoCapture(bool enabled, string mode, string side)
    {
        autoCaptureEnabled = enabled;
        autoCaptureMode = mode is "bulk" or "precision" ? mode : "quick";
        autoCaptureSide = side == "back" ? "back" : "front";
    }

    public string loadLocalData(string key) => localData.Load(key) ?? "";

    public bool saveLocalData(string key, string json)
    {
        try
        {
            localData.Save(key, json);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public bool deleteLocalData(string key)
    {
        try
        {
            localData.Delete(key);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private void QueueRecognition(string dataUrl, string requestId, string language,
        string profile, RecognitionRequestMode mode) =>
        _ = RecognizeAsync(dataUrl, requestId, language, profile, mode);

    private async Task RecognizeAsync(string dataUrl, string requestId, string language,
        string profile, RecognitionRequestMode mode)
    {
        var entered = false;
        try
        {
            ValidateImageDataUrl(dataUrl);
            await recognitionGate.WaitAsync(lifetime.Token);
            entered = true;
            var result = await recognition.RecognizeAsync(dataUrl, language, profile, mode,
                lifetime.Token);
            DesktopLog.Info("CARD_RECOGNIZED",
                ("profile", result.Profile), ("mode", result.RecognitionMode),
                ("identifier", result.Identifier.Value.Length > 0 ? "present" : "missing"),
                ("ocrMs", result.TotalOcrMilliseconds));
            await callbacks.SendAsync("onNativeOcrResult", RecognitionPayload(requestId, result));
        }
        catch (Exception error) when (error is not OperationCanceledException || !disposed)
        {
            DesktopLog.Warning("OCR_FAILED", ("type", error.GetType().Name));
            await SendFailureAsync("onNativeOcrResult", requestId,
                error is InvalidDataException ? error.Message : "Lokale Windows-OCR ist fehlgeschlagen.",
                language, profile, mode.ToString().ToUpperInvariant());
        }
        finally
        {
            if (entered) recognitionGate.Release();
        }
    }

    private static object RecognitionPayload(string requestId, WindowsRecognitionResult result)
    {
        var pokemonRoi = result.Profile == "pokemon" ? new
        {
            x = 0d,
            y = 0.80,
            width = 0.72,
            height = 0.185,
            source = "normalizedCardImage"
        } : null;
        return new
        {
            requestId,
            ok = result.Ok,
            text = result.Text,
            passes = result.Passes.Select(pass => new
            {
                variant = pass.Variant,
                region = pass.Region,
                width = pass.Width,
                height = pass.Height,
                text = pass.Text,
                elapsedMs = pass.ElapsedMilliseconds,
                lines = pass.Lines.Select(line => new
                {
                    text = line.Text,
                    x = line.X,
                    y = line.Y,
                    w = line.Width,
                    h = line.Height,
                    confidence = line.Confidence
                })
            }),
            language = result.Language,
            profile = result.Profile,
            detectedProfile = result.Profile,
            mode = result.RecognitionMode,
            platform = "windows",
            orientation = result.Orientation,
            orientationBestRotation = result.Orientation,
            orientationScore = result.OrientationScore,
            orientationSecondScore = result.OrientationSecondScore,
            orientationMargin = Math.Max(0, result.OrientationScore - result.OrientationSecondScore),
            orientationConfident = result.OrientationConfident,
            identifier = new
            {
                value = result.Identifier.Value,
                collectorNumber = result.Identifier.CollectorNumber,
                setCode = result.Identifier.SetCode,
                passcode = result.Identifier.Passcode,
                cardCode = result.Identifier.CardCode,
                script = result.Identifier.Script,
                confidence = result.Identifier.Confidence,
                exact = result.Identifier.IsExact
            },
            priorityRoi = pokemonRoi,
            orientationMs = result.OrientationMilliseconds,
            detailedOcrMs = result.DetailedOcrMilliseconds,
            totalOcrMs = result.TotalOcrMilliseconds,
            warning = result.Warning,
            error = result.Ok ? null : "Auf dem Bild wurde kein lesbarer Kartentext gefunden."
        };
    }

    private async Task RunHttpGetAsync(string url, string requestId)
    {
        var result = await http.GetAsync(url, lifetime.Token);
        await callbacks.SendAsync("onNativeHttpResult", new
        {
            requestId,
            url,
            ok = result.Ok,
            status = result.Status,
            body = result.Body,
            errorType = result.ErrorType,
            error = result.Error,
            retryAfterMs = result.RetryAfterMs
        });
    }

    private async Task PrepareCardImageAsync(string dataUrl, string requestId)
    {
        try
        {
            ValidateImageDataUrl(dataUrl);
            using var preparation = vision.Prepare(dataUrl);
            var detection = preparation.Detection;
            DesktopLog.Info("CARD_PREPARED",
                ("cropConfidence", detection.Confidence),
                ("cropMs", preparation.ProcessingMilliseconds),
                ("fallback", preparation.FallbackUsed));
            await callbacks.SendAsync("onNativePreparedCard", new
            {
                requestId,
                ok = true,
                dataUrl = codec.EncodeJpeg(preparation.Image),
                reliable = preparation.Reliable,
                method = detection.CropMethod,
                width = preparation.Image.Width,
                height = preparation.Image.Height,
                confidence = detection.Confidence,
                cardCoverage = detection.CardCoverage,
                fallbackUsed = preparation.FallbackUsed,
                detectedQuad = detection.DetectedQuad.Select(point => new[] { point.X, point.Y }),
                detectedAspectRatio = detection.DetectedAspectRatio,
                safetyMargin = preparation.SafetyMargin,
                correctedRotationDegrees = preparation.CorrectedRotationDegrees,
                fourCornersDetected = detection.FourCornersDetected,
                perspectiveCorrected = preparation.PerspectiveCorrected,
                borderComplete = detection.BorderComplete,
                sourceExifApplied = preparation.SourceExifApplied,
                sourceExifOrientation = preparation.OriginalExifOrientation,
                cropMs = preparation.ProcessingMilliseconds,
                quality = preparation.Quality,
                platform = "windows"
            });
        }
        catch (Exception error)
        {
            DesktopLog.Warning("CARD_PREPARATION_FAILED", ("type", error.GetType().Name));
            await SendFailureAsync("onNativePreparedCard", requestId, error.Message);
        }
    }

    private async Task CompareAsync(string dataUrl, string imageUrl, string requestId,
        bool prepared, bool reliable, string method)
    {
        var entered = false;
        try
        {
            ValidateImageDataUrl(dataUrl);
            await visualGate.WaitAsync(lifetime.Token);
            entered = true;
            var result = await visualComparison.CompareAsync(dataUrl, imageUrl, prepared,
                reliable, method, lifetime.Token);
            DesktopLog.Info("VISUAL_MATCH", ("score", result.Similarity),
                ("ms", result.ElapsedMilliseconds));
            await callbacks.SendAsync("onNativeVisualResult", new
            {
                requestId,
                imageUrl,
                ok = true,
                similarity = result.Similarity,
                whole = result.Whole,
                header = result.Header,
                artwork = result.Artwork,
                text = result.Text,
                footer = result.Footer,
                feature = result.Feature,
                reliable = result.Reliable,
                method = result.Method,
                elapsedMs = result.ElapsedMilliseconds,
                platform = "windows"
            });
        }
        catch (Exception error) when (error is not OperationCanceledException || !disposed)
        {
            DesktopLog.Warning("VISUAL_MATCH_FAILED", ("type", error.GetType().Name));
            await SendFailureAsync("onNativeVisualResult", requestId, error.Message);
        }
        finally
        {
            if (entered) visualGate.Release();
        }
    }

    private async Task CaptureAsync(string requestId, string side, string callback)
    {
        var intent = CaptureIntent(side);
        var result = await fileCapture.CaptureAsync(new CardCaptureRequest(intent, requestId),
            lifetime.Token);
        await callbacks.SendAsync(callback, CapturePayload(requestId, side, result));
    }

    private async Task EnumerateEosAsync(string requestId)
    {
        try
        {
            var cameras = await canon.EnumerateAsync(lifetime.Token);
            await callbacks.SendAsync("onDesktopEosCameras", new
            {
                requestId,
                ok = true,
                cameras = cameras.Select(camera => new
                {
                    id = camera.Id,
                    model = camera.Model,
                    serialNumber = camera.SerialNumber
                })
            });
        }
        catch (Exception error)
        {
            await SendFailureAsync("onDesktopEosCameras", requestId, error.Message);
        }
    }

    private async Task ConnectEosAsync(string cameraId, string requestId)
    {
        try
        {
            await canon.ConnectAsync(cameraId, lifetime.Token);
            await SendEosStatusAsync(requestId, true);
        }
        catch (Exception error)
        {
            await SendEosStatusAsync(requestId, false, error.Message);
        }
    }

    private async Task DisconnectEosAsync(string requestId)
    {
        try
        {
            liveView?.Cancel();
            await canon.DisconnectAsync(lifetime.Token);
            await SendEosStatusAsync(requestId, true);
        }
        catch (Exception error)
        {
            await SendEosStatusAsync(requestId, false, error.Message);
        }
    }

    private async Task CaptureEosAsync(string requestId, string side)
    {
        if (!await eosCaptureGate.WaitAsync(0, lifetime.Token)) return;
        try
        {
            var result = await canon.CaptureAsync(new CardCaptureRequest(CaptureIntent(side), requestId),
                lifetime.Token);
            await callbacks.SendAsync("onDesktopImageSelected", CapturePayload(requestId, side, result));
        }
        finally
        {
            eosCaptureGate.Release();
        }
    }

    private async Task StartLiveViewAsync(string requestId)
    {
        liveView?.Cancel();
        liveView?.Dispose();
        liveView = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        var token = liveView.Token;
        await callbacks.SendAsync("onDesktopEosLiveStatus", new
        {
            requestId,
            ok = true,
            active = true,
            message = "Live View wird gestartet."
        });
        try
        {
            var lastFrameAt = Stopwatch.GetTimestamp();
            await foreach (var frame in canon.GetLiveViewFramesAsync(token).WithCancellation(token))
            {
                var now = Stopwatch.GetTimestamp();
                if (Stopwatch.GetElapsedTime(lastFrameAt, now) < TimeSpan.FromMilliseconds(90)) continue;
                lastFrameAt = now;
                await callbacks.SendAsync("onDesktopEosLiveFrame", new
                {
                    requestId,
                    ok = true,
                    dataUrl = "data:image/jpeg;base64," + Convert.ToBase64String(frame.JpegBytes),
                    width = frame.Width,
                    height = frame.Height,
                    timestamp = frame.Timestamp
                });
                if (!autoCaptureEnabled) continue;
                var analysis = liveAnalyzer.Analyze(frame.JpegBytes);
                var decision = autoCapture.Update(new AutoCaptureObservation(
                    analysis.Detection.FourCornersDetected,
                    analysis.Detection.Confidence,
                    analysis.MotionScore,
                    analysis.SharpnessScore,
                    analysis.ExposureScore,
                    analysis.Fingerprint,
                    frame.Timestamp));
                await callbacks.SendAsync("onDesktopEosDetection", new
                {
                    requestId,
                    state = decision.State,
                    stableFrames = decision.StableFrames,
                    confidence = analysis.Detection.Confidence,
                    coverage = analysis.Detection.CardCoverage,
                    motion = analysis.MotionScore,
                    sharpness = analysis.SharpnessScore,
                    exposure = analysis.ExposureScore,
                    detectorMs = analysis.ElapsedMilliseconds,
                    quad = analysis.Detection.DetectedQuad.Select(point => new[] { point.X, point.Y })
                });
                if (!decision.ShouldCapture) continue;
                autoCapture.MarkCaptured(analysis.Fingerprint, frame.Timestamp);
                var captureSide = autoCaptureMode == "bulk" ? "bulk" : autoCaptureSide;
                _ = CaptureEosAsync("eos-auto-" + Guid.NewGuid().ToString("N"), captureSide);
            }
        }
        catch (OperationCanceledException)
        {
            // User requested stop/disconnect/close.
        }
        catch (Exception error)
        {
            DesktopLog.Warning("LIVE_VIEW_FAILED", ("type", error.GetType().Name));
            await callbacks.SendAsync("onDesktopEosLiveStatus", new
            {
                requestId,
                ok = false,
                active = false,
                error = error.Message
            });
        }
    }

    private async Task StopLiveViewAsync(string requestId)
    {
        liveView?.Cancel();
        await callbacks.SendAsync("onDesktopEosLiveStatus", new
        {
            requestId,
            ok = true,
            active = false,
            message = "Live View beendet."
        });
    }

    private async Task SendEosStatusAsync(string requestId, bool ok, string? error = null)
    {
        var cameraStatus = await canon.GetStatusAsync(lifetime.Token);
        await callbacks.SendAsync("onDesktopEosStatus", new
        {
            requestId,
            ok,
            connected = cameraStatus.Connected,
            available = cameraStatus.Available,
            model = canon.DisplayName,
            message = error ?? cameraStatus.Message,
            error
        });
    }

    private async Task SendFailureAsync(string callback, string requestId, string error,
        string? language = null, string? profile = null, string? mode = null)
    {
        await callbacks.SendAsync(callback, new
        {
            requestId,
            ok = false,
            text = "",
            passes = Array.Empty<object>(),
            language,
            profile,
            mode,
            platform = "windows",
            error
        });
    }

    private static object CapturePayload(string requestId, string side, CardCaptureResult result) => new
    {
        requestId,
        side,
        ok = result.Ok,
        dataUrl = result.DataUrl,
        fileName = result.FileName,
        cancelled = result.Cancelled,
        error = result.Error,
        source = result.Source,
        normalized = false
    };

    private static CardCaptureIntent CaptureIntent(string side) => side.ToLowerInvariant() switch
    {
        "back" => CardCaptureIntent.Back,
        "bulk" => CardCaptureIntent.Bulk,
        "precision" => CardCaptureIntent.Precision,
        _ => CardCaptureIntent.Front
    };

    private static void ValidateImageDataUrl(string dataUrl)
    {
        if (!IsSupportedImageDataUrl(dataUrl))
            throw new InvalidDataException("Das importierte Bild ist ungültig oder zu groß.");
    }

    private static bool IsSupportedImageDataUrl(string dataUrl) =>
        !string.IsNullOrWhiteSpace(dataUrl)
        && dataUrl.Length <= MaximumDataUrlCharacters
        && (dataUrl.StartsWith("data:image/jpeg;base64,", StringComparison.OrdinalIgnoreCase)
            || dataUrl.StartsWith("data:image/png;base64,", StringComparison.OrdinalIgnoreCase)
            || dataUrl.StartsWith("data:image/webp;base64,", StringComparison.OrdinalIgnoreCase)
            || dataUrl.StartsWith("data:image/bmp;base64,", StringComparison.OrdinalIgnoreCase)
            || dataUrl.StartsWith("data:image/heic;base64,", StringComparison.OrdinalIgnoreCase)
            || dataUrl.StartsWith("data:image/heif;base64,", StringComparison.OrdinalIgnoreCase));

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        lifetime.Cancel();
        liveView?.Cancel();
        liveView?.Dispose();
        // Gates can still be held by fire-and-forget bridge callbacks while cancellation unwinds.
        // Disposing them here would turn an orderly shutdown into ObjectDisposedException in finally.
        lifetime.Dispose();
    }
}
