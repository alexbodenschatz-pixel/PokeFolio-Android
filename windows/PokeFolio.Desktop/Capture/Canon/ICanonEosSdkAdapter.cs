namespace PokeFolio.Desktop.Capture.Canon;

public sealed record CanonCameraInfo(string Id, string Model, string? SerialNumber = null);
public sealed record CanonCaptureArtifact(string FilePath, string CameraModel);
public sealed record CanonLiveViewFrame(byte[] JpegBytes, int Width, int Height, DateTimeOffset Timestamp);

/// <summary>
/// Adapter seam implemented by a separately licensed local Canon plug-in. This repository
/// intentionally contains neither Canon headers nor EDSDK binaries.
/// </summary>
public interface ICanonEosSdkAdapter : IAsyncDisposable
{
    bool IsSdkAvailable { get; }
    bool IsConnected { get; }
    string StatusMessage { get; }
    CanonCameraInfo? ConnectedCamera { get; }

    Task<IReadOnlyList<CanonCameraInfo>> EnumerateCamerasAsync(
        CancellationToken cancellationToken = default);
    Task ConnectAsync(string cameraId, CancellationToken cancellationToken = default);
    Task DisconnectAsync(CancellationToken cancellationToken = default);
    Task<CanonCaptureArtifact> CaptureAsync(string targetDirectory,
        CancellationToken cancellationToken = default);
    IAsyncEnumerable<CanonLiveViewFrame> GetLiveViewFramesAsync(
        CancellationToken cancellationToken = default);
}
