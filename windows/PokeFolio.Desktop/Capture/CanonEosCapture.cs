using PokeFolio.Desktop.Capture.Canon;
using PokeFolio.Desktop.Diagnostics;

namespace PokeFolio.Desktop.Capture;

/// <summary>
/// Canon capture coordinator. Proprietary calls live in an optional external adapter and never
/// leak into the rest of PokéFolio.
/// </summary>
public sealed class CanonEosCapture : ICardCaptureDevice, IAsyncDisposable
{
    private const long MaximumImageBytes = 64L * 1024 * 1024;
    private readonly ICanonEosSdkAdapter adapter;
    private readonly TimeSpan captureTimeout;

    public CanonEosCapture() : this(CanonEosAdapterFactory.Create())
    {
    }

    public CanonEosCapture(ICanonEosSdkAdapter adapter, TimeSpan? captureTimeout = null)
    {
        this.adapter = adapter;
        this.captureTimeout = captureTimeout ?? TimeSpan.FromSeconds(35);
    }

    public string Id => "canon-eos";
    public string DisplayName => adapter.ConnectedCamera?.Model ?? "Canon EOS 2000D";

    public Task<CardCaptureStatus> GetStatusAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(new CardCaptureStatus(adapter.IsConnected, adapter.IsSdkAvailable,
            adapter.StatusMessage));

    public Task<IReadOnlyList<CanonCameraInfo>> EnumerateAsync(
        CancellationToken cancellationToken = default) =>
        adapter.EnumerateCamerasAsync(cancellationToken);

    public async Task ConnectAsync(string cameraId, CancellationToken cancellationToken = default)
    {
        DesktopLog.Info("CAMERA_CONNECTING", ("cameraId", cameraId));
        await adapter.ConnectAsync(cameraId, cancellationToken);
        DesktopLog.Info("CAMERA_CONNECTED", ("model", adapter.ConnectedCamera?.Model ?? "unknown"));
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        await adapter.DisconnectAsync(cancellationToken);
        DesktopLog.Info("CAMERA_DISCONNECTED");
    }

    public async Task<CardCaptureResult> CaptureAsync(
        CardCaptureRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!adapter.IsSdkAvailable || !adapter.IsConnected)
            return new CardCaptureResult(false, Error: adapter.StatusMessage, Source: Id);
        var directory = Path.Combine(Path.GetTempPath(), "PokeFolio", "CanonCapture");
        Directory.CreateDirectory(directory);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(captureTimeout);
        string? capturedPath = null;
        try
        {
            DesktopLog.Info("CAPTURE_STARTED", ("source", Id), ("intent", request.Intent));
            var artifact = await adapter.CaptureAsync(directory, timeout.Token);
            capturedPath = artifact.FilePath;
            var file = new FileInfo(artifact.FilePath);
            if (!file.Exists || file.Length is <= 0 or > MaximumImageBytes)
                throw new InvalidDataException("Die EOS-Aufnahme ist leer oder zu groß.");
            var bytes = await File.ReadAllBytesAsync(file.FullName, timeout.Token);
            var mime = WindowsFileCapture.MimeTypeForExtension(file.Extension) ?? "image/jpeg";
            DesktopLog.Info("CAPTURE_FINISHED", ("source", Id), ("bytes", bytes.Length));
            return new CardCaptureResult(true,
                $"data:{mime};base64,{Convert.ToBase64String(bytes)}", file.Name, Source: Id);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            DesktopLog.Warning("CAPTURE_TIMEOUT", ("source", Id));
            return new CardCaptureResult(false,
                Error: "Die EOS-Aufnahme hat das Zeitlimit überschritten.", Source: Id);
        }
        catch (Exception error) when (error is IOException or InvalidOperationException)
        {
            DesktopLog.Warning("CAPTURE_FAILED", ("source", Id), ("type", error.GetType().Name));
            return new CardCaptureResult(false, Error: error.Message, Source: Id);
        }
        finally
        {
            try
            {
                if (capturedPath is not null && File.Exists(capturedPath)) File.Delete(capturedPath);
            }
            catch (IOException)
            {
                DesktopLog.Warning("CAPTURE_TEMP_CLEANUP_FAILED", ("source", Id));
            }
        }
    }

    public IAsyncEnumerable<CanonLiveViewFrame> GetLiveViewFramesAsync(
        CancellationToken cancellationToken = default) => adapter.GetLiveViewFramesAsync(cancellationToken);

    public ValueTask DisposeAsync() => adapter.DisposeAsync();
}
