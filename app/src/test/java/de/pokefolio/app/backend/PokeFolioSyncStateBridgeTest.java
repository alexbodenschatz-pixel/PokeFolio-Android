package de.pokefolio.app.backend;

import de.pokefolio.app.security.RefreshTokenCredential;
import de.pokefolio.app.security.RefreshTokenStore;
import de.pokefolio.app.sync.AccountSyncStateStore;
import de.pokefolio.app.sync.PokeFolioSyncStateBridge;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Comparator;
import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public final class PokeFolioSyncStateBridgeTest {
    private static final UUID DEVICE_ID =
            UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final String SNAPSHOT = "{\"schemaVersion\":1,"
            + "\"state\":{},\"entities\":{}}";

    @Test
    public void bridgeDerivesStorageAccountOnlyFromAuthenticatedNativeSession() throws Exception {
        File root = Files.createTempDirectory("pokefolio-sync-state-bridge-").toFile();
        MemoryRefreshTokenStore credentials = new MemoryRefreshTokenStore();
        PokeFolioApiTransport transport = new PokeFolioApiTransport() {
            @Override
            public PokeFolioRawResponse send(
                    String method,
                    String path,
                    byte[] body,
                    String accessToken,
                    int maximumResponseBytes
            ) throws IOException {
                if (!"/api/v1/auth/login".equals(path)) {
                    throw new IOException("Unexpected request: " + path);
                }
                return new PokeFolioRawResponse(200, PokeFolioApiPayloadsTest.sessionJson(
                        "android",
                        DEVICE_ID,
                        "access-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "refresh-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
            }

            @Override
            public void close() {
            }
        };
        PokeFolioCloudService cloud = new PokeFolioCloudService(
                PokeFolioBackendConfiguration.parse("https://api.example.test/"),
                new PokeFolioApiClient(credentials, transport));
        AccountSyncStateStore store = new AccountSyncStateStore(root);
        PokeFolioSyncStateBridge bridge = new PokeFolioSyncStateBridge(cloud, store);
        try {
            assertThrows(IllegalStateException.class, bridge::load);
            cloud.login("owner@example.test", "valid-password", "Pixel test");

            assertTrue(bridge.save(SNAPSHOT));
            assertEquals(SNAPSHOT, bridge.load());
        } finally {
            cloud.close();
            deleteTree(root);
        }
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

    private static final class MemoryRefreshTokenStore implements RefreshTokenStore {
        private RefreshTokenCredential credential;

        @Override
        public RefreshTokenCredential load() {
            return credential;
        }

        @Override
        public void save(RefreshTokenCredential value) {
            credential = value;
        }

        @Override
        public void delete() {
            credential = null;
        }
    }
}
