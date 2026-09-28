package de.pokefolio.app.sync;

import de.pokefolio.app.backend.StrictJsonValidator;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;

/** Atomic, account-partitioned persistence for the shared offline sync snapshot. */
public final class AccountSyncStateStore {
    static final int SCHEMA_VERSION = 1;
    static final int MAXIMUM_SNAPSHOT_BYTES = 32 * 1024 * 1024;
    private static final UUID EMPTY_UUID = new UUID(0L, 0L);
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private static final Set<String> SNAPSHOT_PROPERTIES = Collections.unmodifiableSet(
            new HashSet<>(Arrays.asList("schemaVersion", "state", "entities")));

    private final File root;

    public AccountSyncStateStore(File root) {
        if (root == null) throw new IllegalArgumentException("Storage root is required.");
        this.root = root;
    }

    public synchronized String load(UUID userId) throws IOException {
        File storage = resolveFile(userId);
        if (!storage.isFile()) return null;
        long length = storage.length();
        if (length < 2 || length > MAXIMUM_SNAPSHOT_BYTES) {
            throw new IOException("Account sync snapshot has an invalid size.");
        }
        byte[] bytes = Files.readAllBytes(storage.toPath());
        try {
            String json = decodeUtf8(bytes);
            validate(json);
            return json;
        } finally {
            Arrays.fill(bytes, (byte) 0);
        }
    }

    public synchronized void save(UUID userId, String snapshotJson) throws IOException {
        File storage = resolveFile(userId);
        byte[] bytes = encodeUtf8(snapshotJson);
        File temporary = new File(storage.getPath() + ".tmp");
        try {
            if (bytes.length < 2 || bytes.length > MAXIMUM_SNAPSHOT_BYTES) {
                throw new IOException("Account sync snapshot exceeds its size limit.");
            }
            validate(snapshotJson);
            if (!root.isDirectory() && !root.mkdirs()) {
                throw new IOException("Account sync directory cannot be created.");
            }
            try (FileOutputStream output = new FileOutputStream(temporary, false)) {
                output.write(bytes);
                output.flush();
                output.getFD().sync();
            }
            moveAtomically(temporary, storage);
        } finally {
            Arrays.fill(bytes, (byte) 0);
            try {
                Files.deleteIfExists(temporary.toPath());
            } catch (IOException ignored) {
                // Keep the original write error; stale temporary files are never loaded.
            }
        }
    }

    File storageFileFor(UUID userId) {
        return resolveFile(userId);
    }

    private File resolveFile(UUID userId) {
        if (userId == null || EMPTY_UUID.equals(userId)) {
            throw new IllegalArgumentException("User id must be a non-empty UUID.");
        }
        return new File(root, "sync-v1-" + accountKey(userId) + ".json");
    }

    private static String accountKey(UUID userId) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(userId.toString().getBytes(StandardCharsets.US_ASCII));
            StringBuilder result = new StringBuilder(hash.length * 2);
            for (byte value : hash) {
                int unsigned = value & 0xff;
                result.append(HEX[unsigned >>> 4]);
                result.append(HEX[unsigned & 0x0f]);
            }
            Arrays.fill(hash, (byte) 0);
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable.", impossible);
        }
    }

    private static void validate(String json) throws IOException {
        StrictJsonValidator.validateObject(json);
        try {
            JSONObject root = new JSONObject(json);
            Set<String> properties = new HashSet<>();
            Iterator<String> keys = root.keys();
            while (keys.hasNext()) properties.add(keys.next());
            Object schemaVersion = root.opt("schemaVersion");
            if (!properties.equals(SNAPSHOT_PROPERTIES)
                    || !(schemaVersion instanceof Integer)
                    || ((Integer) schemaVersion) != SCHEMA_VERSION
                    || !(root.opt("state") instanceof JSONObject)
                    || !(root.opt("entities") instanceof JSONObject)) {
                throw new IOException("Account sync snapshot violates the storage contract.");
            }
        } catch (org.json.JSONException error) {
            throw new IOException("Account sync snapshot is invalid JSON.", error);
        }
    }

    private static byte[] encodeUtf8(String value) throws IOException {
        if (value == null) throw new IllegalArgumentException("Sync snapshot is required.");
        try {
            ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .encode(CharBuffer.wrap(value));
            byte[] bytes = new byte[encoded.remaining()];
            encoded.get(bytes);
            return bytes;
        } catch (CharacterCodingException error) {
            throw new IOException("Account sync snapshot is not valid Unicode.", error);
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
            throw new IOException("Account sync snapshot is not valid UTF-8.", error);
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
}
