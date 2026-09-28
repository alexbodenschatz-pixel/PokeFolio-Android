using System.Buffers;
using System.Net;
using System.Net.Http.Headers;

namespace PokeFolio.Desktop.Backend;

internal sealed class PokeFolioApiTransport : IDisposable
{
    private readonly HttpClient client;

    public PokeFolioApiTransport(Uri backendOrigin)
        : this(backendOrigin, CreateHandler())
    {
    }

    public PokeFolioApiTransport(Uri backendOrigin, HttpMessageHandler handler)
    {
        BackendOrigin = NormalizeAndValidateOrigin(backendOrigin);
        ArgumentNullException.ThrowIfNull(handler);
        client = new HttpClient(handler, disposeHandler: true)
        {
            Timeout = TimeSpan.FromSeconds(20)
        };
    }

    public Uri BackendOrigin { get; }

    public static bool IsAllowedBackendOrigin(Uri? origin)
    {
        if (origin is null || !origin.IsAbsoluteUri ||
            !string.IsNullOrEmpty(origin.UserInfo) ||
            !string.IsNullOrEmpty(origin.Query) ||
            !string.IsNullOrEmpty(origin.Fragment) ||
            !string.Equals(origin.AbsolutePath, "/", StringComparison.Ordinal))
        {
            return false;
        }

        return string.Equals(origin.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
               (string.Equals(origin.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
                origin.IsLoopback);
    }

    public async Task<PokeFolioRawResponse> SendAsync(
        HttpMethod method,
        string path,
        byte[]? body,
        string? accessToken,
        int maximumResponseBytes,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, BuildUri(path));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.UserAgent.ParseAdd("PokeFolio-Desktop/0.16.5");
        if (accessToken is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        }
        if (body is not null)
        {
            request.Content = new ByteArrayContent(body);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json")
            {
                CharSet = "utf-8"
            };
        }

        using HttpResponseMessage response = await client.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        byte[] responseBody = await ReadBoundedAsync(
            response.Content,
            maximumResponseBytes,
            cancellationToken);
        return new PokeFolioRawResponse((int)response.StatusCode, responseBody);
    }

    private Uri BuildUri(string path)
    {
        if (!path.StartsWith("/", StringComparison.Ordinal) ||
            path.StartsWith("//", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Backend paths must be rooted relative paths.");
        }
        var target = new Uri(BackendOrigin, path[1..]);
        if (!string.Equals(target.Scheme, BackendOrigin.Scheme, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(target.Host, BackendOrigin.Host, StringComparison.OrdinalIgnoreCase) ||
            target.Port != BackendOrigin.Port)
        {
            throw new InvalidOperationException("Backend request escaped its configured origin.");
        }
        return target;
    }

    private static async Task<byte[]> ReadBoundedAsync(
        HttpContent content,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength is > 0 and var declaredLength &&
            declaredLength > maximumBytes)
        {
            throw new InvalidDataException("Backend response exceeds its size limit.");
        }

        await using Stream input = await content.ReadAsStreamAsync(cancellationToken);
        using var output = new MemoryStream();
        byte[] buffer = ArrayPool<byte>.Shared.Rent(16 * 1024);
        try
        {
            while (true)
            {
                int read = await input.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
                if (read == 0) break;
                if (output.Length + read > maximumBytes)
                {
                    throw new InvalidDataException("Backend response exceeds its size limit.");
                }
                output.Write(buffer, 0, read);
            }
            return output.ToArray();
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer, clearArray: true);
        }
    }

    private static Uri NormalizeAndValidateOrigin(Uri origin)
    {
        ArgumentNullException.ThrowIfNull(origin);
        if (!IsAllowedBackendOrigin(origin))
        {
            throw new ArgumentException(
                "Backend origin must be path-free HTTPS, or loopback HTTP for local development.",
                nameof(origin));
        }
        return new Uri(origin.GetLeftPart(UriPartial.Authority) + "/", UriKind.Absolute);
    }

    private static SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression =
            DecompressionMethods.Brotli | DecompressionMethods.Deflate | DecompressionMethods.GZip
    };

    public void Dispose() => client.Dispose();
}

internal sealed record PokeFolioRawResponse(int Status, byte[] Body)
{
    public bool IsSuccess => Status is >= 200 and < 300;
}
