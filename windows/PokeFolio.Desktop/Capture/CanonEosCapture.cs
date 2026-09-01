namespace PokeFolio.Desktop.Capture;

/// <summary>
/// Extension seam for a future, separately licensed Canon EDSDK adapter.
/// No proprietary SDK binaries or API calls are included in this repository.
/// </summary>
public sealed class CanonEosCapture : ICardCaptureDevice
{
    public string Id => "canon-eos";

    public string DisplayName => "Canon EOS (vorbereitet)";

    public Task<CardCaptureStatus> GetStatusAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(new CardCaptureStatus(
            false,
            false,
            "Canon EDSDK ist nicht installiert. Die EOS-Schnittstelle ist vorbereitet."));

    public Task<CardCaptureResult> CaptureAsync(
        CardCaptureRequest request,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(new CardCaptureResult(
            false,
            Error: "Keine Canon-Kamera verbunden. EDSDK-Unterstützung folgt separat.",
            Source: Id));
}
