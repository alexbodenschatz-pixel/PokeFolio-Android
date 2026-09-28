using System.Diagnostics;
using System.Net;
using OpenCvSharp;

namespace PokeFolio.Desktop.Vision;

public interface IVisualComparisonService
{
    Task<VisualMatchResult> CompareAsync(string scanDataUrl, string referenceUrl,
        bool prepared, bool preparationReliable, string method,
        CancellationToken cancellationToken = default);
}

public sealed class VisualComparisonService : IVisualComparisonService, IDisposable
{
    private static readonly HashSet<string> AllowedImageHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "images.pokemontcg.io",
        "images.scrydex.com",
        "assets.tcgdex.net",
        "images.ygoprodeck.com",
        "optcgapi.com"
    };

    private readonly IWindowsVisionPipeline vision;
    private readonly ImageDataUrlCodec codec;
    private readonly CardVisualMatcher matcher;
    private readonly HttpClient client;
    private readonly bool ownsClient;

    public VisualComparisonService(IWindowsVisionPipeline vision, ImageDataUrlCodec codec,
        CardVisualMatcher matcher, HttpClient? client = null)
    {
        this.vision = vision;
        this.codec = codec;
        this.matcher = matcher;
        ownsClient = client is null;
        this.client = client ?? new HttpClient(new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.Brotli | DecompressionMethods.Deflate
                | DecompressionMethods.GZip
        });
        this.client.Timeout = TimeSpan.FromSeconds(12);
        this.client.DefaultRequestHeaders.UserAgent.ParseAdd("PokeFolio-Desktop/0.16.5");
    }

    public async Task<VisualMatchResult> CompareAsync(string scanDataUrl, string referenceUrl,
        bool prepared, bool preparationReliable, string method,
        CancellationToken cancellationToken = default)
    {
        using var scan = prepared ? codec.Decode(scanDataUrl) : null;
        using var preparedScan = prepared ? null : vision.Prepare(scanDataUrl);
        var scanMat = prepared ? scan!.Pixels : preparedScan!.Image;
        using var reference = await LoadReferenceAsync(referenceUrl, cancellationToken);
        return matcher.Compare(scanMat, reference, prepared ? preparationReliable : preparedScan!.Reliable,
            prepared ? method : preparedScan!.Detection.CropMethod);
    }

    private async Task<Mat> LoadReferenceAsync(string value, CancellationToken cancellationToken)
    {
        if (value.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
        {
            using var decoded = codec.Decode(value);
            return decoded.Pixels.Clone();
        }
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || !AllowedImageHosts.Contains(uri.Host))
        {
            throw new InvalidOperationException("Die Referenzbild-Adresse ist nicht freigegeben.");
        }
        using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is > 8_000_000)
            throw new InvalidDataException("Das Referenzbild ist größer als 8 MB.");
        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        if (bytes.Length is 0 or > 8_000_000)
            throw new InvalidDataException("Das Referenzbild ist leer oder zu groß.");
        var image = Cv2.ImDecode(bytes, ImreadModes.Color | ImreadModes.IgnoreOrientation);
        if (image.Empty())
        {
            image.Dispose();
            throw new InvalidDataException("Das Referenzbild konnte nicht dekodiert werden.");
        }
        return image;
    }

    public void Dispose()
    {
        if (ownsClient) client.Dispose();
    }
}
