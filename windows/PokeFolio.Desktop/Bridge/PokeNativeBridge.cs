using System.Runtime.InteropServices;
using System.Text.Json;
using PokeFolio.Desktop.Capture;

namespace PokeFolio.Desktop.Bridge;

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.AutoDual)]
public sealed class PokeNativeBridge
{
    private const int MaximumDataUrlCharacters = 42 * 1024 * 1024;
    private readonly IJavaScriptCallbackDispatcher callbacks;
    private readonly HttpBridgeService http;
    private readonly LocalDataService localData;
    private readonly DesktopStatusService status;
    private readonly ICardCaptureDevice fileCapture;
    private readonly IReadOnlyList<ICardCaptureDevice> captureDevices;

    public PokeNativeBridge(
        IJavaScriptCallbackDispatcher callbacks,
        HttpBridgeService http,
        LocalDataService localData,
        DesktopStatusService status,
        ICardCaptureDevice fileCapture,
        IReadOnlyList<ICardCaptureDevice> captureDevices)
    {
        this.callbacks = callbacks;
        this.http = http;
        this.localData = localData;
        this.status = status;
        this.fileCapture = fileCapture;
        this.captureDevices = captureDevices;
    }

    public string consumeCaptureMetadata() => "";

    public void recognizeCard(string dataUrl, string requestId, string language) =>
        QueueOcrUnavailable(requestId, language, "auto", "FULL");

    public void recognizeCardProfiled(string dataUrl, string requestId, string language, string profile) =>
        QueueOcrUnavailable(requestId, language, profile, "FULL");

    public void recognizePrimaryIdentifier(string dataUrl, string requestId, string language, string profile) =>
        QueueOcrUnavailable(requestId, language, profile, "PRIMARY_IDENTIFIER");

    public void recognizeBulkIdentifier(string dataUrl, string requestId, string language, string profile) =>
        QueueOcrUnavailable(requestId, language, profile, "BULK_FAST");

    public void recognizeText(string dataUrl, string requestId, string language) =>
        QueueOcrUnavailable(requestId, language, "auto", "FULL");

    public void httpGet(string url, string requestId) => _ = RunHttpGetAsync(url, requestId);

    public void prepareCardImage(string dataUrl, string requestId) => _ = PrepareCardImageAsync(dataUrl, requestId);

    public void compareCardImage(string dataUrl, string imageUrl, string requestId) =>
        QueueVisualUnavailable(requestId);

    public void comparePreparedCardImage(
        string dataUrl,
        string imageUrl,
        string requestId,
        bool reliable,
        string method) => QueueVisualUnavailable(requestId);

    public void openBulkScanner(string requestId) => _ = CaptureAsync(requestId, "bulk", "onNativeBulkScannerResult");

    public void selectImage(string requestId, string side) => _ = CaptureAsync(requestId, side, "onDesktopImageSelected");

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

    private void QueueOcrUnavailable(string requestId, string language, string profile, string mode)
    {
        _ = callbacks.SendAsync("onNativeOcrResult", new
        {
            requestId,
            ok = true,
            text = "",
            passes = Array.Empty<object>(),
            language,
            profile,
            mode,
            platform = "windows",
            orientation = 0,
            orientationScore = 0,
            orientationSecondScore = 0,
            orientationMargin = 0,
            orientationConfident = false,
            warning = "ML-Kit-OCR ist nur im Android-Host verfügbar; Suche, API-Daten und manuelle Zuordnung bleiben nutzbar."
        });
    }

    private void QueueVisualUnavailable(string requestId)
    {
        _ = callbacks.SendAsync("onNativeVisualResult", new
        {
            requestId,
            ok = false,
            platform = "windows",
            error = "Der native Windows-Bildvergleich ist in dieser Foundation noch nicht verfügbar."
        });
    }

    private async Task RunHttpGetAsync(string url, string requestId)
    {
        var result = await http.GetAsync(url);
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
        var valid = IsSupportedImageDataUrl(dataUrl);
        object payload;
        if (valid)
        {
            payload = new
            {
                requestId,
                ok = true,
                dataUrl,
                reliable = false,
                method = "windows-import-passthrough",
                confidence = 0,
                fallbackUsed = true,
                fourCornersDetected = false,
                perspectiveCorrected = false,
                borderComplete = false,
                platform = "windows"
            };
        }
        else
        {
            payload = new
            {
                requestId,
                ok = false,
                dataUrl = "",
                reliable = false,
                method = "windows-import-invalid",
                confidence = 0,
                fallbackUsed = true,
                fourCornersDetected = false,
                perspectiveCorrected = false,
                borderComplete = false,
                platform = "windows",
                error = "Das importierte Bild ist ungültig oder zu groß."
            };
        }
        await callbacks.SendAsync("onNativePreparedCard", payload);
    }

    private async Task CaptureAsync(string requestId, string side, string callback)
    {
        var intent = side.ToLowerInvariant() switch
        {
            "back" => CardCaptureIntent.Back,
            "bulk" => CardCaptureIntent.Bulk,
            "precision" => CardCaptureIntent.Precision,
            _ => CardCaptureIntent.Front
        };
        var result = await fileCapture.CaptureAsync(new CardCaptureRequest(intent, requestId));
        await callbacks.SendAsync(callback, new
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
        });
    }

    private static bool IsSupportedImageDataUrl(string dataUrl) =>
        !string.IsNullOrWhiteSpace(dataUrl)
        && dataUrl.Length <= MaximumDataUrlCharacters
        && (dataUrl.StartsWith("data:image/jpeg;base64,", StringComparison.OrdinalIgnoreCase)
            || dataUrl.StartsWith("data:image/png;base64,", StringComparison.OrdinalIgnoreCase)
            || dataUrl.StartsWith("data:image/webp;base64,", StringComparison.OrdinalIgnoreCase)
            || dataUrl.StartsWith("data:image/bmp;base64,", StringComparison.OrdinalIgnoreCase)
            || dataUrl.StartsWith("data:image/heic;base64,", StringComparison.OrdinalIgnoreCase));
}
