using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PokeFolio.Desktop.Security;

public sealed class ProtectedRefreshTokenStore : IRefreshTokenStore
{
    private const int SchemaVersion = 1;
    private const int MaximumEncryptedBytes = 128 * 1024;
    private static readonly byte[] OptionalEntropy =
        SHA256.HashData(Encoding.UTF8.GetBytes("PokeFolio.Desktop.RefreshToken.v1"));
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    private readonly string storagePath;
    private readonly ISecretProtector protector;

    public ProtectedRefreshTokenStore(string? storageDirectory = null)
        : this(storageDirectory, new CurrentUserSecretProtector())
    {
    }

    internal ProtectedRefreshTokenStore(
        string? storageDirectory,
        ISecretProtector protector)
    {
        ArgumentNullException.ThrowIfNull(protector);
        string directory = storageDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PokeFolio",
            "Security");
        storagePath = Path.Combine(directory, "refresh-token.bin");
        this.protector = protector;
    }

    internal string StoragePath => storagePath;

    public RefreshTokenCredential? Load()
    {
        if (!File.Exists(storagePath)) return null;

        var information = new FileInfo(storagePath);
        if (information.Length is < 1 or > MaximumEncryptedBytes)
        {
            throw new InvalidDataException("Protected refresh-token storage has an invalid size.");
        }

        byte[] encrypted = File.ReadAllBytes(storagePath);
        byte[] plaintext = [];
        try
        {
            plaintext = protector.Unprotect(encrypted);
            TokenEnvelope? envelope = JsonSerializer.Deserialize<TokenEnvelope>(
                plaintext,
                JsonOptions);
            if (envelope is null || envelope.SchemaVersion != SchemaVersion)
            {
                throw new InvalidDataException("Protected refresh-token storage has an unsupported schema.");
            }

            var credential = new RefreshTokenCredential(envelope.DeviceId, envelope.RefreshToken);
            Validate(credential);
            return credential;
        }
        catch (Exception error) when (
            error is CryptographicException or JsonException or NotSupportedException or ArgumentException)
        {
            throw new InvalidDataException(
                "Protected refresh-token storage cannot be decrypted or parsed.",
                error);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
            CryptographicOperations.ZeroMemory(encrypted);
        }
    }

    public void Save(RefreshTokenCredential credential)
    {
        ArgumentNullException.ThrowIfNull(credential);
        Validate(credential);

        byte[] plaintext = JsonSerializer.SerializeToUtf8Bytes(
            new TokenEnvelope(SchemaVersion, credential.DeviceId, credential.RefreshToken),
            JsonOptions);
        byte[] encrypted = [];
        try
        {
            encrypted = protector.Protect(plaintext);
            if (encrypted.Length > MaximumEncryptedBytes)
            {
                throw new InvalidDataException("Protected refresh-token storage exceeds its size limit.");
            }

            string? directory = Path.GetDirectoryName(storagePath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                throw new InvalidOperationException("Protected refresh-token path has no directory.");
            }
            Directory.CreateDirectory(directory);

            string temporaryPath = storagePath + ".tmp";
            using (var stream = new FileStream(
                       temporaryPath,
                       FileMode.Create,
                       FileAccess.Write,
                       FileShare.None,
                       4096,
                       FileOptions.WriteThrough))
            {
                stream.Write(encrypted);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporaryPath, storagePath, overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
            CryptographicOperations.ZeroMemory(encrypted);
        }
    }

    public void Delete()
    {
        DeleteIfPresent(storagePath);
        DeleteIfPresent(storagePath + ".tmp");
    }

    private static void Validate(RefreshTokenCredential credential)
    {
        if (credential.DeviceId == Guid.Empty)
        {
            throw new ArgumentException("Device id must be a non-empty UUID.", nameof(credential));
        }
        int refreshTokenLength = credential.RefreshToken?.Length ?? 0;
        if (refreshTokenLength is < 32 or > 1024)
        {
            throw new ArgumentException(
                "Refresh token must contain 32 to 1024 characters.",
                nameof(credential));
        }
    }

    private static void DeleteIfPresent(string path)
    {
        if (File.Exists(path)) File.Delete(path);
    }

    private sealed record TokenEnvelope(int SchemaVersion, Guid DeviceId, string RefreshToken);

    internal interface ISecretProtector
    {
        byte[] Protect(byte[] plaintext);

        byte[] Unprotect(byte[] ciphertext);
    }

    private sealed class CurrentUserSecretProtector : ISecretProtector
    {
        public byte[] Protect(byte[] plaintext) => ProtectedData.Protect(
            plaintext,
            OptionalEntropy,
            DataProtectionScope.CurrentUser);

        public byte[] Unprotect(byte[] ciphertext) => ProtectedData.Unprotect(
            ciphertext,
            OptionalEntropy,
            DataProtectionScope.CurrentUser);
    }
}
