using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;

namespace PokeFolio.Desktop.Bridge;

public sealed record HttpBridgeResult(
    bool Ok,
    int Status,
    string Body,
    string ErrorType = "",
    string Error = "",
    long RetryAfterMs = 0);

public sealed class HttpBridgeService : IDisposable
{
    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "api.pokemontcg.io",
        "api.tcgdex.net",
        "db.ygoprodeck.com",
        "optcgapi.com"
    };

    private readonly HttpClient client;
    private readonly bool ownsClient;

    public HttpBridgeService(HttpClient? client = null)
    {
        ownsClient = client is null;
        this.client = client ?? new HttpClient(new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.Brotli | DecompressionMethods.Deflate | DecompressionMethods.GZip
        });
        this.client.Timeout = TimeSpan.FromSeconds(15);
        this.client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        this.client.DefaultRequestHeaders.UserAgent.ParseAdd("PokeFolio-Desktop/0.16.5");
    }

    public static bool IsAllowed(Uri uri) => uri.Scheme == Uri.UriSchemeHttps && AllowedHosts.Contains(uri.Host);

    public async Task<HttpBridgeResult> GetAsync(string url, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || !IsAllowed(uri))
        {
            return new HttpBridgeResult(false, 0, "", "security", "Diese Netzwerkadresse ist nicht freigegeben.");
        }

        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                if (body.Length > 8_000_000)
                {
                    return new HttpBridgeResult(false, (int)response.StatusCode, "", "response-too-large",
                        "Die Antwort der Kartendatenbank ist zu groß.");
                }
                var retryAfterMs = ParseRetryAfter(response.Headers.RetryAfter);
                if (response.IsSuccessStatusCode)
                {
                    Debug.WriteLine($"[PokeFolio HTTP] success host={uri.Host} status={(int)response.StatusCode}");
                    return new HttpBridgeResult(true, (int)response.StatusCode, body, RetryAfterMs: retryAfterMs);
                }

                var retryable = (int)response.StatusCode >= 500
                    || response.StatusCode is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests;
                Debug.WriteLine($"[PokeFolio HTTP] http host={uri.Host} status={(int)response.StatusCode} attempt={attempt + 1}");
                if (retryable && attempt == 0)
                {
                    await Task.Delay(TimeSpan.FromMilliseconds(Math.Clamp(retryAfterMs, 200, 1500)), cancellationToken);
                    continue;
                }
                return new HttpBridgeResult(
                    false,
                    (int)response.StatusCode,
                    body,
                    "http",
                    $"HTTP {(int)response.StatusCode}",
                    retryAfterMs);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return new HttpBridgeResult(false, 0, "", "timeout", "Die Kartendatenbank antwortet nicht.");
            }
            catch (HttpRequestException error)
            {
                if (attempt == 0)
                {
                    await Task.Delay(250, cancellationToken);
                    continue;
                }
                return new HttpBridgeResult(false, 0, "", "network", error.Message);
            }
        }

        return new HttpBridgeResult(false, 0, "", "network", "Netzwerkanfrage fehlgeschlagen.");
    }

    private static long ParseRetryAfter(RetryConditionHeaderValue? retryAfter)
    {
        if (retryAfter?.Delta is { } delta)
        {
            return (long)Math.Clamp(delta.TotalMilliseconds, 0, 3000);
        }
        if (retryAfter?.Date is { } date)
        {
            return (long)Math.Clamp((date - DateTimeOffset.UtcNow).TotalMilliseconds, 0, 3000);
        }
        return 250;
    }

    public void Dispose()
    {
        if (ownsClient)
        {
            client.Dispose();
        }
    }
}
