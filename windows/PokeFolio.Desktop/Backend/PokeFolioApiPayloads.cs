using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PokeFolio.Desktop.Backend;

internal static class PokeFolioApiPayloads
{
    private const int MaximumSyncRequestBytes = 1024 * 1024;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    public static byte[] SerializeLogin(
        string email,
        string password,
        string deviceName)
    {
        ValidateLoginInput(email, password, deviceName);
        return JsonSerializer.SerializeToUtf8Bytes(new
        {
            email,
            password,
            deviceName,
            platform = "windows"
        }, JsonOptions);
    }

    public static byte[] SerializeRefresh(string refreshToken) =>
        JsonSerializer.SerializeToUtf8Bytes(new { refreshToken }, JsonOptions);

    public static byte[] ValidateSyncOperationBatch(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        byte[] body = StrictUtf8.GetBytes(json);
        try
        {
            if (body.Length is < 2 or > MaximumSyncRequestBytes)
            {
                throw new ArgumentException("Sync operation batch has an invalid size.", nameof(json));
            }
            using JsonDocument document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                HasDuplicateProperty(document.RootElement))
            {
                throw new ArgumentException(
                    "Sync operation batch must be one JSON object without duplicate properties.",
                    nameof(json));
            }
            return body;
        }
        catch (JsonException error)
        {
            CryptographicOperations.ZeroMemory(body);
            throw new ArgumentException("Sync operation batch must be valid JSON.", nameof(json), error);
        }
        catch
        {
            CryptographicOperations.ZeroMemory(body);
            throw;
        }
    }

    public static PokeFolioAuthSessionEnvelope ParseSession(byte[] body)
    {
        PokeFolioAuthSessionEnvelope? envelope;
        try
        {
            using JsonDocument document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                HasDuplicateProperty(document.RootElement))
            {
                throw new JsonException(
                    "Authentication response must be one JSON object without duplicate properties.");
            }
            envelope = document.RootElement.Deserialize<PokeFolioAuthSessionEnvelope>(JsonOptions);
        }
        catch (Exception error) when (error is JsonException or NotSupportedException)
        {
            throw new InvalidDataException("Authentication response is invalid.", error);
        }
        if (envelope is null ||
            string.IsNullOrEmpty(envelope.AccessToken) ||
            envelope.AccessToken.Length is < 32 or > 16_384 ||
            string.IsNullOrEmpty(envelope.RefreshToken) ||
            envelope.RefreshToken.Length is < 32 or > 1024 ||
            envelope.AccessTokenExpiresAt == default ||
            envelope.Device is null ||
            envelope.Device.Id == Guid.Empty ||
            string.IsNullOrWhiteSpace(envelope.Device.Name) ||
            envelope.Device.Name.Length > 120 ||
            !string.Equals(envelope.Device.Platform, "windows", StringComparison.Ordinal) ||
            envelope.Device.CreatedAt == default ||
            envelope.Device.LastSeenAt == default ||
            !envelope.Device.Current)
        {
            throw new InvalidDataException("Authentication response violates the client contract.");
        }
        return envelope;
    }

    public static PokeFolioApiProblem ParseProblem(PokeFolioRawResponse response)
    {
        string fallbackCode = response.Status == (int)HttpStatusCode.Unauthorized
            ? "authentication_required"
            : "api_request_failed";
        string fallbackTitle = $"Backend request failed with HTTP {response.Status}.";
        if (response.Body.Length == 0)
        {
            return new PokeFolioApiProblem(response.Status, fallbackCode, fallbackTitle);
        }

        try
        {
            using JsonDocument document = JsonDocument.Parse(response.Body);
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return new PokeFolioApiProblem(response.Status, fallbackCode, fallbackTitle);
            }

            string code = TryReadString(root, "code") ?? fallbackCode;
            string title = TryReadString(root, "title") ?? fallbackTitle;
            IReadOnlyDictionary<string, string[]>? errors = TryReadErrors(root);
            return new PokeFolioApiProblem(response.Status, code, title, errors);
        }
        catch (JsonException)
        {
            return new PokeFolioApiProblem(response.Status, fallbackCode, fallbackTitle);
        }
    }

    public static string DecodeBody(byte[] body)
    {
        try
        {
            return StrictUtf8.GetString(body);
        }
        catch (DecoderFallbackException error)
        {
            throw new InvalidDataException("Backend response is not valid UTF-8.", error);
        }
    }

    private static bool HasDuplicateProperty(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Array)
        {
            return value.EnumerateArray().Any(HasDuplicateProperty);
        }
        if (value.ValueKind != JsonValueKind.Object) return false;

        var propertyNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonProperty property in value.EnumerateObject())
        {
            if (!propertyNames.Add(property.Name) || HasDuplicateProperty(property.Value))
            {
                return true;
            }
        }
        return false;
    }

    private static string? TryReadString(JsonElement root, string propertyName) =>
        root.TryGetProperty(propertyName, out JsonElement value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static IReadOnlyDictionary<string, string[]>? TryReadErrors(JsonElement root)
    {
        if (!root.TryGetProperty("errors", out JsonElement errorsElement) ||
            errorsElement.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        foreach (JsonProperty property in errorsElement.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.Array) continue;
            string[] messages = property.Value.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString()!)
                .ToArray();
            if (messages.Length > 0) errors[property.Name] = messages;
        }
        return errors.Count == 0 ? null : errors;
    }

    private static void ValidateLoginInput(string email, string password, string deviceName)
    {
        if (string.IsNullOrWhiteSpace(email) || email.Length > 254)
        {
            throw new ArgumentException("Email must contain 1 to 254 characters.", nameof(email));
        }
        if (string.IsNullOrEmpty(password) || password.Length > 128)
        {
            throw new ArgumentException("Password must contain 1 to 128 characters.", nameof(password));
        }
        if (string.IsNullOrWhiteSpace(deviceName) || deviceName.Trim().Length > 120)
        {
            throw new ArgumentException("Device name must contain 1 to 120 characters.", nameof(deviceName));
        }
    }
}

internal sealed record PokeFolioAuthSessionEnvelope(
    string AccessToken,
    string RefreshToken,
    DateTimeOffset AccessTokenExpiresAt,
    PokeFolioAuthDeviceEnvelope Device);

internal sealed record PokeFolioAuthDeviceEnvelope(
    Guid Id,
    string Name,
    string Platform,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastSeenAt,
    bool Current);
