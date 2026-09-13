package de.pokefolio.app.security;

import android.content.Context;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import java.util.UUID;

/** Atomic native credential storage backed by a non-exportable Android Keystore key. */
public final class ProtectedRefreshTokenStore implements RefreshTokenStore {
    static final int MAXIMUM_ENCRYPTED_BYTES = 128 * 1024;
    private static final int MAGIC = 0x50465231; // PFR1
    private static final int VERSION = 1;
    private static final int MAXIMUM_TOKEN_BYTES = 4096;
    private static final UUID EMPTY_UUID = new UUID(0L, 0L);

    private final File storageFile;
    private final SecretProtector protector;

    public ProtectedRefreshTokenStore(Context context) {
        if (context == null) throw new IllegalArgumentException("Context is required.");
        this.storageFile = new File(
                new File(context.getNoBackupFilesDir(), "security"),
                "refresh-token.bin");
        this.protector = new AndroidKeystoreSecretProtector();
    }

    ProtectedRefreshTokenStore(File storageDirectory, SecretProtector protector) {
        if (storageDirectory == null) {
            throw new IllegalArgumentException("Storage directory is required.");
        }
        if (protector == null) throw new IllegalArgumentException("Protector is required.");
        this.storageFile = new File(storageDirectory, "refresh-token.bin");
        this.protector = protector;
    }

    @Override
    public synchronized RefreshTokenCredential load() throws IOException {
        if (!storageFile.isFile()) return null;
        long length = storageFile.length();
        if (length < 1 || length > MAXIMUM_ENCRYPTED_BYTES) {
            throw new IOException("Protected refresh-token storage has an invalid size.");
        }

        byte[] encrypted = Files.readAllBytes(storageFile.toPath());
        byte[] plaintext = null;
        try {
            plaintext = protector.unprotect(encrypted);
            return decodeCredential(plaintext);
        } catch (GeneralSecurityException | IllegalArgumentException error) {
            throw new IOException("Protected refresh-token storage cannot be decrypted.", error);
        } finally {
            clear(encrypted);
            clear(plaintext);
        }
    }

    @Override
    public synchronized void save(RefreshTokenCredential credential) throws IOException {
        validate(credential);
        byte[] plaintext = encodeCredential(credential);
        byte[] encrypted = null;
        File temporary = new File(storageFile.getPath() + ".tmp");
        try {
            encrypted = protector.protect(plaintext);
            if (encrypted == null || encrypted.length < 1
                    || encrypted.length > MAXIMUM_ENCRYPTED_BYTES) {
                throw new IOException("Protected refresh-token storage exceeds its size limit.");
            }
            File directory = storageFile.getParentFile();
            if (directory == null || (!directory.isDirectory() && !directory.mkdirs())) {
                throw new IOException("Protected refresh-token directory cannot be created.");
            }
            try (FileOutputStream output = new FileOutputStream(temporary, false)) {
                output.write(encrypted);
                output.flush();
                output.getFD().sync();
            }
            moveAtomically(temporary, storageFile);
        } catch (GeneralSecurityException | IllegalArgumentException error) {
            throw new IOException("Refresh token cannot be protected.", error);
        } finally {
            clear(plaintext);
            clear(encrypted);
            try {
                Files.deleteIfExists(temporary.toPath());
            } catch (IOException ignored) {
                // Preserve the original write failure; stale temp files are never loaded.
            }
        }
    }

    @Override
    public synchronized void delete() throws IOException {
        Files.deleteIfExists(storageFile.toPath());
        Files.deleteIfExists(new File(storageFile.getPath() + ".tmp").toPath());
    }

    File getStorageFile() {
        return storageFile;
    }

    private static byte[] encodeCredential(RefreshTokenCredential credential) throws IOException {
        byte[] token = encodeUtf8(credential.getRefreshToken());
        if (token.length > MAXIMUM_TOKEN_BYTES) {
            clear(token);
            throw new IllegalArgumentException("Refresh token exceeds its byte limit.");
        }
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream(64 + token.length);
             DataOutputStream output = new DataOutputStream(bytes)) {
            output.writeInt(MAGIC);
            output.writeInt(VERSION);
            output.writeLong(credential.getDeviceId().getMostSignificantBits());
            output.writeLong(credential.getDeviceId().getLeastSignificantBits());
            output.writeInt(token.length);
            output.write(token);
            output.flush();
            return bytes.toByteArray();
        } finally {
            clear(token);
        }
    }

    private static RefreshTokenCredential decodeCredential(byte[] plaintext) throws IOException {
        if (plaintext == null || plaintext.length < 28
                || plaintext.length > MAXIMUM_TOKEN_BYTES + 28) {
            throw new IOException("Protected refresh-token payload has an invalid size.");
        }
        try (DataInputStream input = new DataInputStream(new ByteArrayInputStream(plaintext))) {
            if (input.readInt() != MAGIC || input.readInt() != VERSION) {
                throw new IOException("Protected refresh-token payload has an unsupported format.");
            }
            UUID deviceId = new UUID(input.readLong(), input.readLong());
            int tokenLength = input.readInt();
            if (tokenLength < 1 || tokenLength > MAXIMUM_TOKEN_BYTES
                    || tokenLength != input.available()) {
                throw new IOException("Protected refresh-token payload is malformed.");
            }
            byte[] token = new byte[tokenLength];
            input.readFully(token);
            try {
                RefreshTokenCredential credential = new RefreshTokenCredential(
                        deviceId,
                        decodeUtf8(token));
                validate(credential);
                return credential;
            } finally {
                clear(token);
            }
        }
    }

    private static byte[] encodeUtf8(String value) {
        try {
            ByteBuffer buffer = StandardCharsets.UTF_8.newEncoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .encode(java.nio.CharBuffer.wrap(value));
            byte[] bytes = new byte[buffer.remaining()];
            buffer.get(bytes);
            return bytes;
        } catch (CharacterCodingException error) {
            throw new IllegalArgumentException("Refresh token is not valid Unicode.", error);
        }
    }

    private static String decodeUtf8(byte[] value) throws IOException {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(value))
                    .toString();
        } catch (CharacterCodingException error) {
            throw new IOException("Refresh token is not valid UTF-8.", error);
        }
    }

    private static void validate(RefreshTokenCredential credential) {
        if (credential == null) throw new IllegalArgumentException("Credential is required.");
        if (credential.getDeviceId() == null || EMPTY_UUID.equals(credential.getDeviceId())) {
            throw new IllegalArgumentException("Device id must be a non-empty UUID.");
        }
        int tokenLength = credential.getRefreshToken() == null
                ? 0 : credential.getRefreshToken().length();
        if (tokenLength < 32 || tokenLength > 1024) {
            throw new IllegalArgumentException(
                    "Refresh token must contain 32 to 1024 characters.");
        }
    }

    private static void moveAtomically(File source, File destination) throws IOException {
        try {
            Files.move(
                    source.toPath(),
                    destination.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException ignored) {
            Files.move(
                    source.toPath(),
                    destination.toPath(),
                    StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static void clear(byte[] value) {
        if (value != null) Arrays.fill(value, (byte) 0);
    }
}
