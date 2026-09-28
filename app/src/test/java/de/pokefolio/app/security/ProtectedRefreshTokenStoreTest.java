package de.pokefolio.app.security;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import java.util.UUID;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public final class ProtectedRefreshTokenStoreTest {
    private File root;
    private TestProtector protector;
    private ProtectedRefreshTokenStore store;

    @Before
    public void setUp() throws IOException {
        root = Files.createTempDirectory("pokefolio-refresh-store-").toFile();
        protector = new TestProtector();
        store = new ProtectedRefreshTokenStore(root, protector);
    }

    @After
    public void tearDown() throws IOException {
        if (root != null && root.isDirectory()) {
            try (var files = Files.walk(root.toPath())) {
                files.sorted((left, right) -> right.compareTo(left))
                        .forEach(path -> {
                            try {
                                Files.deleteIfExists(path);
                            } catch (IOException ignored) {
                                // The test assertions already report the material failure.
                            }
                        });
            }
        }
    }

    @Test
    public void encryptedCredentialRoundTripsWithoutPlaintextOrTemporaryFile() throws Exception {
        UUID deviceId = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        String token = "refresh-token-material-0123456789abcdef";

        store.save(new RefreshTokenCredential(deviceId, token));
        RefreshTokenCredential loaded = store.load();

        assertEquals(deviceId, loaded.getDeviceId());
        assertEquals(token, loaded.getRefreshToken());
        byte[] disk = Files.readAllBytes(store.getStorageFile().toPath());
        assertFalse(new String(disk, StandardCharsets.UTF_8).contains(token));
        assertFalse(new File(store.getStorageFile().getPath() + ".tmp").exists());
    }

    @Test
    public void missingCredentialReturnsNullAndDeleteRemovesFinalAndTemporaryFiles() throws Exception {
        assertNull(store.load());
        store.save(validCredential());
        Files.write(new File(store.getStorageFile().getPath() + ".tmp").toPath(), new byte[]{1});

        store.delete();

        assertFalse(store.getStorageFile().exists());
        assertFalse(new File(store.getStorageFile().getPath() + ".tmp").exists());
        assertNull(store.load());
    }

    @Test
    public void corruptCiphertextFailsClosedAndRemainsAvailableForDiagnosis() throws Exception {
        store.save(validCredential());
        byte[] corrupt = Files.readAllBytes(store.getStorageFile().toPath());
        corrupt[0] ^= 0x7f;
        Files.write(store.getStorageFile().toPath(), corrupt);

        assertThrows(IOException.class, store::load);
        assertArrayEquals(corrupt, Files.readAllBytes(store.getStorageFile().toPath()));
    }

    @Test
    public void failedReplacementPreservesTheLastValidCredential() throws Exception {
        RefreshTokenCredential original = validCredential();
        store.save(original);
        byte[] before = Files.readAllBytes(store.getStorageFile().toPath());
        protector.returnOversizedCiphertext = true;

        assertThrows(IOException.class, () -> store.save(new RefreshTokenCredential(
                UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
                "replacement-refresh-token-0123456789abcdef")));

        assertArrayEquals(before, Files.readAllBytes(store.getStorageFile().toPath()));
        assertFalse(new File(store.getStorageFile().getPath() + ".tmp").exists());
    }

    @Test
    public void invalidDeviceOrTokenNeverCreatesStorage() {
        assertThrows(IllegalArgumentException.class, () -> store.save(
                new RefreshTokenCredential(new UUID(0L, 0L),
                        "refresh-token-material-0123456789abcdef")));
        assertThrows(IllegalArgumentException.class, () -> store.save(
                new RefreshTokenCredential(UUID.randomUUID(), "too-short")));
        assertThrows(IllegalArgumentException.class, () -> store.save(
                new RefreshTokenCredential(UUID.randomUUID(), new String(new char[1025]))));
        assertFalse(store.getStorageFile().exists());
    }

    private static RefreshTokenCredential validCredential() {
        return new RefreshTokenCredential(
                UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                "refresh-token-material-0123456789abcdef");
    }

    private static final class TestProtector implements SecretProtector {
        private static final byte[] PREFIX = {0x50, 0x46, 0x54, 0x31};
        boolean returnOversizedCiphertext;

        @Override
        public byte[] protect(byte[] plaintext) {
            if (returnOversizedCiphertext) {
                return new byte[ProtectedRefreshTokenStore.MAXIMUM_ENCRYPTED_BYTES + 1];
            }
            byte[] output = Arrays.copyOf(PREFIX, PREFIX.length + plaintext.length);
            for (int index = 0; index < plaintext.length; index++) {
                output[PREFIX.length + index] = (byte) (plaintext[index] ^ 0x5a);
            }
            return output;
        }

        @Override
        public byte[] unprotect(byte[] ciphertext) throws GeneralSecurityException {
            if (ciphertext.length < PREFIX.length
                    || !Arrays.equals(PREFIX, Arrays.copyOf(ciphertext, PREFIX.length))) {
                throw new GeneralSecurityException("Invalid test envelope.");
            }
            byte[] output = new byte[ciphertext.length - PREFIX.length];
            for (int index = 0; index < output.length; index++) {
                output[index] = (byte) (ciphertext[PREFIX.length + index] ^ 0x5a);
            }
            return output;
        }
    }
}
