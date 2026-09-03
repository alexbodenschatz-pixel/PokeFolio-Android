namespace PokeFolio.Desktop.Capture.Canon;

public sealed class UnavailableCanonEosSdkAdapter(string message) : ICanonEosSdkAdapter
{
    public bool IsSdkAvailable => false;
    public bool IsConnected => false;
    public string StatusMessage { get; } = message;
    public CanonCameraInfo? ConnectedCamera => null;

    public Task<IReadOnlyList<CanonCameraInfo>> EnumerateCamerasAsync(
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<CanonCameraInfo>>(Array.Empty<CanonCameraInfo>());

    public Task ConnectAsync(string cameraId, CancellationToken cancellationToken = default) =>
        Task.FromException(new InvalidOperationException(StatusMessage));

    public Task DisconnectAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

    public Task<CanonCaptureArtifact> CaptureAsync(string targetDirectory,
        CancellationToken cancellationToken = default) =>
        Task.FromException<CanonCaptureArtifact>(new InvalidOperationException(StatusMessage));

    public async IAsyncEnumerable<CanonLiveViewFrame> GetLiveViewFramesAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;
        yield break;
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
