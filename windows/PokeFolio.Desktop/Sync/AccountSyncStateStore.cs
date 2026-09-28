using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PokeFolio.Desktop.Sync;

public sealed class AccountSyncStateStore : IAccountSyncStateStore
{
    internal const int SchemaVersion = 1;
    internal const int MaximumSnapshotBytes = 32 * 1024 * 1024;

    private static readonly UTF8Encoding Utf8 = new(false, true);
    private readonly object gate = new();
    private readonly string root;

    public AccountSyncStateStore(string? root = null)
    {
        this.root = root ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PokeFolio",
            "Sync");
    }

    internal string Root => root;

    internal string StoragePathFor(Guid userId) => ResolvePath(userId);

    public string? Load(Guid userId)
    {
        string path = ResolvePath(userId);
        lock (gate)
        {
            if (!File.Exists(path)) return null;
            var information = new FileInfo(path);
            if (information.Length is < 2 or > MaximumSnapshotBytes)
            {
                throw new InvalidDataException("Account sync snapshot has an invalid size.");
            }

            string json;
            try
            {
                json = Utf8.GetString(File.ReadAllBytes(path));
            }
            catch (DecoderFallbackException error)
            {
                throw new InvalidDataException("Account sync snapshot is not valid UTF-8.", error);
            }
            Validate(json);
            return json;
        }
    }

    public void Save(Guid userId, string snapshotJson)
    {
        ArgumentNullException.ThrowIfNull(snapshotJson);
        string path = ResolvePath(userId);
        if (snapshotJson.Length < 2 || snapshotJson.Length > MaximumSnapshotBytes)
        {
            throw new InvalidDataException("Account sync snapshot exceeds its size limit.");
        }
        int byteCount;
        try
        {
            byteCount = Utf8.GetByteCount(snapshotJson);
        }
        catch (EncoderFallbackException error)
        {
            throw new InvalidDataException("Account sync snapshot is not valid Unicode.", error);
        }
        if (byteCount > MaximumSnapshotBytes)
        {
            throw new InvalidDataException("Account sync snapshot exceeds its size limit.");
        }
        Validate(snapshotJson);
        byte[] bytes = Utf8.GetBytes(snapshotJson);

        lock (gate)
        {
            Directory.CreateDirectory(root);
            string temporaryPath = path + ".tmp";
            try
            {
                using (var stream = new FileStream(
                           temporaryPath,
                           FileMode.Create,
                           FileAccess.Write,
                           FileShare.None,
                           64 * 1024,
                           FileOptions.WriteThrough))
                {
                    stream.Write(bytes);
                    stream.Flush(flushToDisk: true);
                }
                File.Move(temporaryPath, path, overwrite: true);
            }
            finally
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }
        }
    }

    private string ResolvePath(Guid userId)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("User id must be a non-empty UUID.", nameof(userId));
        }
        string accountKey = Convert.ToHexString(SHA256.HashData(userId.ToByteArray()))
            .ToLowerInvariant();
        return Path.Combine(root, $"sync-v1-{accountKey}.json");
    }

    private static void Validate(string json)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(json, new JsonDocumentOptions
            {
                MaxDepth = 128
            });
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || HasDuplicateProperty(root))
            {
                throw new InvalidDataException(
                    "Account sync snapshot must be one JSON object without duplicate properties.");
            }

            var propertyNames = root.EnumerateObject()
                .Select(property => property.Name)
                .ToHashSet(StringComparer.Ordinal);
            if (!propertyNames.SetEquals(["schemaVersion", "state", "entities"]) ||
                !root.TryGetProperty("schemaVersion", out JsonElement schemaVersion) ||
                schemaVersion.ValueKind != JsonValueKind.Number ||
                !schemaVersion.TryGetInt32(out int version) || version != SchemaVersion ||
                !root.TryGetProperty("state", out JsonElement state) ||
                state.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("entities", out JsonElement entities) ||
                entities.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidDataException("Account sync snapshot violates the storage contract.");
            }
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Account sync snapshot is invalid JSON.", error);
        }
    }

    private static bool HasDuplicateProperty(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Array)
        {
            return value.EnumerateArray().Any(HasDuplicateProperty);
        }
        if (value.ValueKind != JsonValueKind.Object) return false;

        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonProperty property in value.EnumerateObject())
        {
            if (!names.Add(property.Name) || HasDuplicateProperty(property.Value)) return true;
        }
        return false;
    }
}
