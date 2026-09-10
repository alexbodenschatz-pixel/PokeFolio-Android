using System.Security.Cryptography;
using System.Text;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Security;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class ProtectedRefreshTokenStoreTests
{
    private const string FirstToken =
        "first-refresh-token-material-that-is-long-enough-for-the-server-contract";
    private const string RotatedToken =
        "rotated-refresh-token-material-that-is-also-long-enough-for-the-contract";

    [TestMethod]
    public void RefreshTokenRoundTripsThroughConfiguredProtectionWithoutPlaintextOnDisk()
    {
        using var directory = new TemporaryDirectory();
        var store = CreateTestStore(directory.Path);
        var credential = new RefreshTokenCredential(Guid.NewGuid(), FirstToken);

        store.Save(credential);

        CollectionAssert.AreEqual(
            new[] { "refresh-token.bin" },
            Directory.GetFiles(directory.Path).Select(Path.GetFileName).ToArray());
        string raw = Encoding.UTF8.GetString(File.ReadAllBytes(store.StoragePath));
        Assert.IsFalse(raw.Contains(FirstToken, StringComparison.Ordinal));
        Assert.AreEqual(credential, CreateTestStore(directory.Path).Load());
    }

    [TestMethod]
    public void RotatedTokenAtomicallyReplacesThePreviousCredentialAndCanBeDeleted()
    {
        using var directory = new TemporaryDirectory();
        var store = CreateTestStore(directory.Path);
        Guid deviceId = Guid.NewGuid();
        store.Save(new RefreshTokenCredential(deviceId, FirstToken));

        store.Save(new RefreshTokenCredential(deviceId, RotatedToken));

        Assert.AreEqual(RotatedToken, store.Load()?.RefreshToken);
        Assert.IsFalse(File.Exists(store.StoragePath + ".tmp"));
        store.Delete();
        Assert.IsNull(store.Load());
    }

    [TestMethod]
    public void CorruptCiphertextFailsClosedWithoutDeletingRecoveryEvidence()
    {
        using var directory = new TemporaryDirectory();
        var store = CreateTestStore(directory.Path);
        Directory.CreateDirectory(directory.Path);
        File.WriteAllBytes(store.StoragePath, Encoding.UTF8.GetBytes("not-dpapi-ciphertext"));

        Assert.ThrowsExactly<InvalidDataException>(() => store.Load());
        Assert.IsTrue(File.Exists(store.StoragePath));
    }

    [TestMethod]
    public void DecryptedInvalidCredentialFailsClosedWithoutDeletingRecoveryEvidence()
    {
        using var directory = new TemporaryDirectory();
        var protector = new DeterministicTestProtector();
        var store = new ProtectedRefreshTokenStore(directory.Path, protector);
        Guid deviceId = Guid.NewGuid();
        byte[] plaintext = Encoding.UTF8.GetBytes(
            $$"""{"schemaVersion":1,"deviceId":"{{deviceId}}","refreshToken":"short"}""");
        Directory.CreateDirectory(directory.Path);
        File.WriteAllBytes(store.StoragePath, protector.Protect(plaintext));

        Assert.ThrowsExactly<InvalidDataException>(() => store.Load());
        Assert.IsTrue(File.Exists(store.StoragePath));
    }

    [TestMethod]
    public void InvalidCredentialsAreRejectedBeforeAnyFileIsWritten()
    {
        using var directory = new TemporaryDirectory();
        var store = CreateTestStore(directory.Path);

        Assert.ThrowsExactly<ArgumentException>(() => store.Save(
            new RefreshTokenCredential(Guid.Empty, FirstToken)));
        Assert.ThrowsExactly<ArgumentException>(() => store.Save(
            new RefreshTokenCredential(Guid.NewGuid(), "short")));
        Assert.IsFalse(Directory.Exists(directory.Path));
    }

    [TestMethod]
    public void CurrentUserDpapiRoundTripsWhenTheHostHasALoadedUserProfile()
    {
        using var directory = new TemporaryDirectory();
        var store = new ProtectedRefreshTokenStore(directory.Path);
        var credential = new RefreshTokenCredential(Guid.NewGuid(), FirstToken);
        try
        {
            store.Save(credential);
            Assert.AreEqual(credential, store.Load());
        }
        catch (CryptographicException error)
        {
            Assert.Inconclusive(
                $"Current-user DPAPI is unavailable in this host process: {error.GetType().Name}");
        }
        catch (InvalidDataException error) when (error.InnerException is CryptographicException)
        {
            Assert.Inconclusive(
                $"Current-user DPAPI is unavailable in this host process: {error.InnerException.GetType().Name}");
        }
    }

    private static ProtectedRefreshTokenStore CreateTestStore(string directory) =>
        new(directory, new DeterministicTestProtector());

    private sealed class DeterministicTestProtector : ProtectedRefreshTokenStore.ISecretProtector
    {
        private const byte Mask = 0xa5;

        public byte[] Protect(byte[] plaintext) => Transform(plaintext);

        public byte[] Unprotect(byte[] ciphertext) => Transform(ciphertext);

        private static byte[] Transform(byte[] value) =>
            value.Select(item => (byte)(item ^ Mask)).ToArray();
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "pokefolio-token-store-test-" + Guid.NewGuid().ToString("N"));
        }

        public string Path { get; }

        public void Dispose()
        {
            if (Directory.Exists(Path)) Directory.Delete(Path, recursive: true);
        }
    }
}
