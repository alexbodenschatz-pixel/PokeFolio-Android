using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PokeFolio.Desktop.Backend;

internal static class PokeFolioApiPayloads
{
    private const int MaximumCatalogRequestBytes = 16 * 1024;
    private const int MaximumSyncRequestBytes = 1024 * 1024;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private static readonly Dictionary<string, string> CatalogProviderTcgs =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["pokemon-tcg-api"] = "pokemon",
            ["tcgdex"] = "pokemon",
            ["ygoprodeck"] = "yugioh",
            ["optcgapi"] = "onepiece"
        };
    private static readonly HashSet<string> CatalogReferenceProperties =
        new(StringComparer.Ordinal)
        {
            "provider",
            "providerCardId",
            "tcg",
            "name",
            "setCode",
            "number"
        };
    private static readonly HashSet<string> DeviceProperties =
        new(StringComparer.Ordinal)
        {
            "id",
            "name",
            "platform",
            "createdAt",
            "lastSeenAt",
            "current"
        };
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
            email = email.Trim(),
            password,
            deviceName = deviceName.Trim(),
            platform = "windows"
        }, JsonOptions);
    }

    public static byte[] SerializePasswordResetRequest(string email)
    {
        ValidateEmail(email);
        return JsonSerializer.SerializeToUtf8Bytes(new
        {
            email = email.Trim()
        }, JsonOptions);
    }

    public static byte[] SerializePasswordChange(
        string currentPassword,
        string newPassword)
    {
        ValidatePassword(currentPassword, 1, nameof(currentPassword), "Current password");
        ValidatePassword(newPassword, 12, nameof(newPassword), "New password");
        if (string.Equals(currentPassword, newPassword, StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "New password must differ from the current password.",
                nameof(newPassword));
        }
        return JsonSerializer.SerializeToUtf8Bytes(new
        {
            currentPassword,
            newPassword
        }, JsonOptions);
    }

    public static byte[] SerializePasswordResetConfirm(
        string email,
        string token,
        string newPassword)
    {
        ValidateEmail(email);
        if (token is null || token.Length is < 32 or > 512)
        {
            throw new ArgumentException(
                "Password reset token must contain 32 to 512 characters.",
                nameof(token));
        }
        if (newPassword is null || newPassword.Length is < 12 or > 128)
        {
            throw new ArgumentException(
                "New password must contain 12 to 128 characters.",
                nameof(newPassword));
        }
        return JsonSerializer.SerializeToUtf8Bytes(new
        {
            email = email.Trim(),
            token,
            newPassword
        }, JsonOptions);
    }

    public static byte[] SerializeRefresh(string refreshToken) =>
        JsonSerializer.SerializeToUtf8Bytes(new { refreshToken }, JsonOptions);

    public static byte[] NormalizeCatalogCardReference(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        byte[] input = StrictUtf8.GetBytes(json);
        try
        {
            if (input.Length is < 2 or > MaximumCatalogRequestBytes)
            {
                throw new ArgumentException(
                    "Catalog card reference has an invalid size.",
                    nameof(json));
            }

            using JsonDocument document = JsonDocument.Parse(input);
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                HasDuplicateProperty(root) ||
                root.EnumerateObject().Count() != CatalogReferenceProperties.Count ||
                root.EnumerateObject().Any(property =>
                    !CatalogReferenceProperties.Contains(property.Name)))
            {
                throw new ArgumentException(
                    "Catalog card reference must contain exactly the contract fields.",
                    nameof(json));
            }

            string provider = RequiredString(root, "provider").Trim().ToLowerInvariant();
            string providerCardId = RequiredString(root, "providerCardId")
                .Trim()
                .ToLowerInvariant();
            string tcg = RequiredString(root, "tcg").Trim().ToLowerInvariant();
            string name = NormalizeCatalogText(root, "name", 240);
            string setCode = NormalizeCatalogText(root, "setCode", 64);
            string number = NormalizeCatalogText(root, "number", 64);

            if (!CatalogProviderTcgs.TryGetValue(provider, out string? providerTcg))
            {
                throw new ArgumentException("Catalog provider is not supported.", nameof(json));
            }
            if (!string.Equals(providerTcg, tcg, StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "Catalog provider does not match the selected TCG.",
                    nameof(json));
            }
            if (providerCardId.Length is < 1 or > 160 ||
                providerCardId.Any(character =>
                    !char.IsAsciiLetterOrDigit(character) &&
                    character is not '-' and not '_' and not '.' and not ':' and not '/'))
            {
                throw new ArgumentException(
                    "Provider card id contains invalid characters.",
                    nameof(json));
            }

            return JsonSerializer.SerializeToUtf8Bytes(new
            {
                provider,
                providerCardId,
                tcg,
                name,
                setCode,
                number
            }, JsonOptions);
        }
        catch (JsonException error)
        {
            throw new ArgumentException(
                "Catalog card reference must be valid JSON.",
                nameof(json),
                error);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(input);
        }
    }

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
            envelope.UserId == Guid.Empty ||
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

    public static IReadOnlyList<PokeFolioManagedDevice> ParseDeviceList(
        string json,
        Guid expectedCurrentDeviceId)
    {
        if (expectedCurrentDeviceId == Guid.Empty)
        {
            throw new InvalidDataException("Current device id is missing.");
        }
        byte[] body;
        try
        {
            body = StrictUtf8.GetBytes(json ?? throw new InvalidDataException(
                "Device response is missing."));
        }
        catch (EncoderFallbackException error)
        {
            throw new InvalidDataException("Device response is not valid UTF-8.", error);
        }
        try
        {
            using JsonDocument document = JsonDocument.Parse(body);
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Array || HasDuplicateProperty(root))
            {
                throw new InvalidDataException("Device response must be one strict JSON array.");
            }
            JsonElement.ArrayEnumerator entries = root.EnumerateArray();
            var result = new List<PokeFolioManagedDevice>();
            int currentCount = 0;
            foreach (JsonElement entry in entries)
            {
                if (result.Count >= 1000 ||
                    entry.ValueKind != JsonValueKind.Object ||
                    entry.EnumerateObject().Count() != DeviceProperties.Count ||
                    entry.EnumerateObject().Any(property =>
                        !DeviceProperties.Contains(property.Name)))
                {
                    throw new InvalidDataException("Device response violates the API contract.");
                }
                if (!entry.TryGetProperty("id", out JsonElement idValue) ||
                    !idValue.TryGetGuid(out Guid id) || id == Guid.Empty ||
                    !entry.TryGetProperty("createdAt", out JsonElement createdValue) ||
                    !createdValue.TryGetDateTimeOffset(out DateTimeOffset createdAt) ||
                    createdAt == default ||
                    !entry.TryGetProperty("lastSeenAt", out JsonElement seenValue) ||
                    !seenValue.TryGetDateTimeOffset(out DateTimeOffset lastSeenAt) ||
                    lastSeenAt == default ||
                    !entry.TryGetProperty("current", out JsonElement currentValue) ||
                    currentValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                {
                    throw new InvalidDataException("Device response contains invalid values.");
                }
                string name = DeviceString(entry, "name", 120);
                string platform = DeviceString(entry, "platform", 32);
                bool current = currentValue.GetBoolean();
                if ((current && id != expectedCurrentDeviceId) ||
                    (!current && id == expectedCurrentDeviceId))
                {
                    throw new InvalidDataException("Device response has an invalid current marker.");
                }
                if (current) currentCount++;
                result.Add(new PokeFolioManagedDevice(
                    id, name, platform, createdAt, lastSeenAt, current));
            }
            if (currentCount != 1)
            {
                throw new InvalidDataException(
                    "Device response must contain the current session once.");
            }
            return result;
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Device response is invalid JSON.", error);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(body);
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

    private static string RequiredString(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out JsonElement value) ||
            value.ValueKind != JsonValueKind.String)
        {
            throw new ArgumentException(
                $"Catalog field {propertyName} must be a string.",
                nameof(root));
        }
        return value.GetString()!;
    }

    private static string DeviceString(
        JsonElement root,
        string propertyName,
        int maximumLength)
    {
        if (!root.TryGetProperty(propertyName, out JsonElement value) ||
            value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"Device field {propertyName} must be text.");
        }
        string result = value.GetString()!;
        if (string.IsNullOrWhiteSpace(result) ||
            result.Length > maximumLength)
        {
            throw new InvalidDataException($"Device field {propertyName} is invalid.");
        }
        return result;
    }

    private static string NormalizeCatalogText(
        JsonElement root,
        string propertyName,
        int maximumLength)
    {
        string value = RequiredString(root, propertyName).Trim();
        if (value.Length is < 1 ||
            value.Length > maximumLength ||
            value.Any(char.IsControl))
        {
            throw new ArgumentException(
                $"Catalog field {propertyName} is invalid.",
                nameof(root));
        }
        return value;
    }

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
        ValidateEmail(email);
        if (string.IsNullOrEmpty(password) || password.Length > 128)
        {
            throw new ArgumentException("Password must contain 1 to 128 characters.", nameof(password));
        }
        if (string.IsNullOrWhiteSpace(deviceName) || deviceName.Trim().Length > 120)
        {
            throw new ArgumentException("Device name must contain 1 to 120 characters.", nameof(deviceName));
        }
    }

    private static void ValidateEmail(string email)
    {
        if (string.IsNullOrWhiteSpace(email) || email.Trim().Length > 254)
        {
            throw new ArgumentException("Email must contain 1 to 254 characters.", nameof(email));
        }
    }

    private static void ValidatePassword(
        string password,
        int minimumLength,
        string parameterName,
        string fieldName)
    {
        if (password is null || password.Length < minimumLength || password.Length > 128)
        {
            throw new ArgumentException(
                $"{fieldName} must contain {minimumLength} to 128 characters.",
                parameterName);
        }
    }
}

internal sealed record PokeFolioAuthSessionEnvelope(
    Guid UserId,
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

internal sealed record PokeFolioManagedDevice(
    Guid Id,
    string Name,
    string Platform,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastSeenAt,
    bool Current);
