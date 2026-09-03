namespace PokeFolio.Desktop.Capture;

public enum CardCaptureIntent
{
    Front,
    Back,
    Bulk,
    Precision
}

public sealed record CardCaptureRequest(CardCaptureIntent Intent, string RequestId = "");

public sealed record CardCaptureStatus(bool Connected, bool Available, string Message);

public sealed record CardCaptureResult(
    bool Ok,
    string? DataUrl = null,
    string? FileName = null,
    bool Cancelled = false,
    string? Error = null,
    string Source = "unknown");

public interface ICardCaptureDevice
{
    string Id { get; }

    string DisplayName { get; }

    Task<CardCaptureStatus> GetStatusAsync(CancellationToken cancellationToken = default);

    Task<CardCaptureResult> CaptureAsync(CardCaptureRequest request, CancellationToken cancellationToken = default);
}
