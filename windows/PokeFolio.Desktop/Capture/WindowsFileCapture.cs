namespace PokeFolio.Desktop.Capture;

public sealed class WindowsFileCapture(Func<CancellationToken, Task<string?>> selectFile) : ICardCaptureDevice
{
    private const long MaximumImageBytes = 30L * 1024L * 1024L;

    public string Id => "windows-file";

    public string DisplayName => "Bilddatei";

    public Task<CardCaptureStatus> GetStatusAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(new CardCaptureStatus(true, true, "Dateiimport ist verfügbar."));

    public async Task<CardCaptureResult> CaptureAsync(
        CardCaptureRequest request,
        CancellationToken cancellationToken = default)
    {
        var path = await selectFile(cancellationToken);
        if (string.IsNullOrWhiteSpace(path))
        {
            return new CardCaptureResult(false, Cancelled: true, Source: Id);
        }

        try
        {
            var file = new FileInfo(path);
            if (!file.Exists)
            {
                return new CardCaptureResult(false, Error: "Die ausgewählte Bilddatei existiert nicht.", Source: Id);
            }
            if (file.Length <= 0 || file.Length > MaximumImageBytes)
            {
                return new CardCaptureResult(false, Error: "Die Bilddatei ist leer oder größer als 30 MB.", Source: Id);
            }

            var mime = MimeTypeForExtension(file.Extension);
            if (mime is null)
            {
                return new CardCaptureResult(false, Error: "Dieses Bildformat wird nicht unterstützt.", Source: Id);
            }
            var bytes = await File.ReadAllBytesAsync(file.FullName, cancellationToken);
            return new CardCaptureResult(
                true,
                $"data:{mime};base64,{Convert.ToBase64String(bytes)}",
                file.Name,
                Source: Id);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return new CardCaptureResult(false, Error: error.Message, Source: Id);
        }
    }

    internal static string? MimeTypeForExtension(string extension) => extension.ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".heic" or ".heif" => "image/heic",
        _ => null
    };
}
