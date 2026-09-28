package de.pokefolio.app.sync;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Comparator;
import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

public final class AccountSyncStateStoreTest {
    private static final String EMPTY_SNAPSHOT = "{\"schemaVersion\":1,"
            + "\"state\":{\"schemaVersion\":1,\"cursor\":\"\",\"lastSequence\":0,"
            + "\"pending\":[],\"conflicts\":[],\"rejected\":[],\"entityVersions\":{}},"
            + "\"entities\":{}}";

    @Test
    public void roundTripsAtomicallyAndKeepsAccountsSeparate() throws Exception {
        File root = temporaryRoot();
        try {
            AccountSyncStateStore store = new AccountSyncStateStore(root);
            UUID firstUser = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
            UUID secondUser = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
            String secondSnapshot = EMPTY_SNAPSHOT.replace(
                    "\"entities\":{}",
                    "\"entities\":{\"holding:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\":{}}");

            assertNull(store.load(firstUser));
            store.save(firstUser, EMPTY_SNAPSHOT);
            store.save(secondUser, secondSnapshot);

            assertEquals(EMPTY_SNAPSHOT, store.load(firstUser));
            assertEquals(secondSnapshot, store.load(secondUser));
            assertEquals(2, root.listFiles((directory, name) -> name.endsWith(".json")).length);
            assertEquals(0, root.listFiles((directory, name) -> name.endsWith(".tmp")).length);
            assertFalse(store.storageFileFor(firstUser).getName().contains("aaaaaaaa"));
            assertEquals(77, store.storageFileFor(firstUser).getName().length());
        } finally {
            deleteTree(root);
        }
    }

    @Test
    public void rejectsInvalidSnapshotWithoutReplacingValidData() throws Exception {
        File root = temporaryRoot();
        try {
            AccountSyncStateStore store = new AccountSyncStateStore(root);
            UUID userId = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
            store.save(userId, EMPTY_SNAPSHOT);

            assertThrows(IOException.class, () -> store.save(
                    userId,
                    "{\"schemaVersion\":1,\"state\":{},\"entities\":{},"
                            + "\"accessToken\":\"secret\"}"));
            assertThrows(IOException.class, () -> store.save(
                    userId,
                    "{\"schemaVersion\":1,\"state\":{},\"state\":{},\"entities\":{}}"));
            assertEquals(EMPTY_SNAPSHOT, store.load(userId));
            assertThrows(IllegalArgumentException.class, () ->
                    store.load(new UUID(0L, 0L)));
        } finally {
            deleteTree(root);
        }
    }

    @Test
    public void corruptSnapshotFailsClosedAndRemainsAvailableForRecovery() throws Exception {
        File root = temporaryRoot();
        try {
            AccountSyncStateStore store = new AccountSyncStateStore(root);
            UUID userId = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
            Files.createDirectories(root.toPath());
            File storage = store.storageFileFor(userId);
            Files.write(storage.toPath(), "{not-json".getBytes(StandardCharsets.UTF_8));

            assertThrows(IOException.class, () -> store.load(userId));
            assertEquals("{not-json", new String(
                    Files.readAllBytes(storage.toPath()), StandardCharsets.UTF_8));
        } finally {
            deleteTree(root);
        }
    }

    private static File temporaryRoot() throws IOException {
        return Files.createTempDirectory("pokefolio-android-sync-store-").toFile();
    }

    private static void deleteTree(File root) throws IOException {
        if (!root.exists()) return;
        try (java.util.stream.Stream<java.nio.file.Path> paths = Files.walk(root.toPath())) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException error) {
                    throw new RuntimeException(error);
                }
            });
        } catch (RuntimeException error) {
            if (error.getCause() instanceof IOException) throw (IOException) error.getCause();
            throw error;
        }
    }
}
