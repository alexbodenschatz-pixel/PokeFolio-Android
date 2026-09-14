package de.pokefolio.app.backend;

import de.pokefolio.app.security.RefreshTokenCredential;
import de.pokefolio.app.security.RefreshTokenStore;

import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public final class PokeFolioAccountBridgeTest {
    private static final UUID DEVICE_ID =
            UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final String ACCESS_TOKEN = "access-" + repeat('a', 64);
    private static final String REFRESH_TOKEN = "refresh-" + repeat('b', 64);

    @Test
    public void unconfiguredCloudServiceReportsAStableUnavailableProblem() throws Exception {
        PokeFolioCloudService cloud = new PokeFolioCloudService(
                PokeFolioBackendConfiguration.parse(""),
                new MemoryRefreshTokenStore());
        try {
            PokeFolioAccountStatus status = cloud.getAccountStatus();
            PokeFolioAuthenticationResult result = cloud.restoreSession();

            assertFalse(status.isConfigured());
            assertFalse(status.isAuthenticated());
            assertNull(status.getBackendOrigin());
            assertEquals("PokeFolio backend is not configured.", status.getConfigurationError());
            assertFalse(result.isSucceeded());
            assertEquals("backend_not_configured", result.getProblem().getCode());
            PokeFolioApiResponse sync = cloud.pullSyncChanges(null, 100);
            assertFalse(sync.isSucceeded());
            assertEquals(503, sync.getStatus());
            assertEquals("backend_not_configured", sync.getProblem().getCode());
        } finally {
            cloud.close();
        }
    }

    @Test
    public void loginCallbackContainsTokenFreeAccountAndDeviceState() throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        PokeFolioApiTransport transport = new SingleResponseTransport(new PokeFolioRawResponse(
                200,
                PokeFolioApiPayloadsTest.sessionJson(
                        "android", DEVICE_ID, ACCESS_TOKEN, REFRESH_TOKEN)));
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);
        PokeFolioCloudService cloud = new PokeFolioCloudService(
                PokeFolioBackendConfiguration.parse("https://api.example.test/"),
                client);
        CapturingCallback callbacks = new CapturingCallback();
        PokeFolioAccountBridge bridge = new PokeFolioAccountBridge(cloud, callbacks);
        try {
            bridge.login(
                    "owner@example.test",
                    "correct horse battery staple",
                    "Pixel test",
                    "account-1");

            CallbackRecord callback = callbacks.results.poll(2, TimeUnit.SECONDS);
            assertNotNull(callback);
            assertEquals("onAndroidAccountResult", callback.function);
            assertEquals("account-1", callback.payload.getString("requestId"));
            assertEquals("login", callback.payload.getString("operation"));
            assertTrue(callback.payload.getBoolean("ok"));
            JSONObject status = callback.payload.getJSONObject("status");
            assertTrue(status.getBoolean("configured"));
            assertTrue(status.getBoolean("authenticated"));
            assertTrue(status.isNull("configurationError"));
            assertEquals(
                    PokeFolioApiPayloadsTest.USER_ID.toString(),
                    status.getJSONObject("session").getString("userId"));
            assertEquals(
                    DEVICE_ID.toString(),
                    status.getJSONObject("session").getJSONObject("device").getString("id"));
            assertEquals(DEVICE_ID, store.credential.getDeviceId());
            assertEquals(REFRESH_TOKEN, store.credential.getRefreshToken());

            String serialized = callback.payload.toString();
            assertFalse(serialized.contains(ACCESS_TOKEN));
            assertFalse(serialized.contains(REFRESH_TOKEN));
            assertFalse(bridge.getStatusJson().contains(ACCESS_TOKEN));
            assertFalse(bridge.getStatusJson().contains(REFRESH_TOKEN));
        } finally {
            bridge.close();
            cloud.close();
        }
    }

    @Test
    public void validationFailureIsReturnedWithoutNetworkAccess() throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        CountingTransport transport = new CountingTransport();
        PokeFolioCloudService cloud = new PokeFolioCloudService(
                PokeFolioBackendConfiguration.parse("https://api.example.test/"),
                new PokeFolioApiClient(store, transport));
        CapturingCallback callbacks = new CapturingCallback();
        PokeFolioAccountBridge bridge = new PokeFolioAccountBridge(cloud, callbacks);
        try {
            bridge.login("", "valid-password", "Pixel test", "account-2");

            CallbackRecord callback = callbacks.results.poll(2, TimeUnit.SECONDS);
            assertNotNull(callback);
            assertFalse(callback.payload.getBoolean("ok"));
            assertEquals("validation", callback.payload.getString("errorType"));
            assertEquals(0, transport.calls);
        } finally {
            bridge.close();
            cloud.close();
        }
    }

    @Test
    public void bridgeRejectsUntrustedIdsAndDoesNotOwnTheProcessCloudService() throws Exception {
        PokeFolioCloudService cloud = new PokeFolioCloudService(
                PokeFolioBackendConfiguration.parse(""),
                new MemoryRefreshTokenStore());
        PokeFolioAccountBridge bridge = new PokeFolioAccountBridge(
                cloud,
                (function, payload) -> { });
        try {
            assertThrows(IllegalArgumentException.class, () ->
                    bridge.restore("bad request\nidentifier"));
            bridge.close();
            assertFalse(cloud.getAccountStatus().isConfigured());
            assertThrows(IllegalStateException.class, () -> bridge.restore("account-closed"));
        } finally {
            bridge.close();
            cloud.close();
        }
    }

    private static String repeat(char value, int count) {
        char[] result = new char[count];
        Arrays.fill(result, value);
        return new String(result);
    }

    private static final class CallbackRecord {
        final String function;
        final JSONObject payload;

        CallbackRecord(String function, JSONObject payload) {
            this.function = function;
            this.payload = payload;
        }
    }

    private static final class CapturingCallback implements PokeFolioAccountBridge.Callback {
        final LinkedBlockingQueue<CallbackRecord> results = new LinkedBlockingQueue<>();

        @Override
        public void send(String function, JSONObject payload) {
            results.add(new CallbackRecord(function, payload));
        }
    }

    private static final class MemoryRefreshTokenStore implements RefreshTokenStore {
        volatile RefreshTokenCredential credential;

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

    private static final class SingleResponseTransport implements PokeFolioApiTransport {
        private final PokeFolioRawResponse response;
        private boolean used;

        SingleResponseTransport(PokeFolioRawResponse response) {
            this.response = response;
        }

        @Override
        public synchronized PokeFolioRawResponse send(
                String method,
                String path,
                byte[] body,
                String accessToken,
                int maximumResponseBytes
        ) throws IOException {
            if (used) throw new IOException("Unexpected additional test request.");
            used = true;
            assertEquals("/api/v1/auth/login", path);
            assertNull(accessToken);
            return response;
        }

        @Override
        public void close() {
        }
    }

    private static final class CountingTransport implements PokeFolioApiTransport {
        volatile int calls;

        @Override
        public PokeFolioRawResponse send(
                String method,
                String path,
                byte[] body,
                String accessToken,
                int maximumResponseBytes
        ) throws IOException {
            calls++;
            throw new IOException("Network must not be reached.");
        }

        @Override
        public void close() {
        }
    }
}
