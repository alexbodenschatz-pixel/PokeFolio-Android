package de.pokefolio.app.backend;

import de.pokefolio.app.security.RefreshTokenCredential;
import de.pokefolio.app.security.RefreshTokenStore;

import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public final class PokeFolioCloudBridgeTest {
    private static final UUID DEVICE_ID =
            UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final UUID CARD_ID =
            UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final String ACCESS_TOKEN =
            "access-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String REFRESH_TOKEN =
            "refresh-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    @Test
    public void catalogAndSyncCallbacksExposeValidatedDataWithoutTokens() throws Exception {
        TestTransport transport = new TestTransport(false);
        PokeFolioCloudService cloud = authenticatedCloud(transport);
        CapturingCallback callbacks = new CapturingCallback();
        PokeFolioCloudBridge bridge = new PokeFolioCloudBridge(cloud, callbacks);
        try {
            bridge.resolveCatalogCard(catalogReference(), "catalog-1");
            CallbackRecord catalog = callbacks.results.poll(2, TimeUnit.SECONDS);
            assertNotNull(catalog);
            assertEquals("onPokeCatalogResult", catalog.function);
            assertTrue(catalog.payload.getBoolean("ok"));
            assertEquals(CARD_ID.toString(), catalog.payload
                    .getJSONObject("data")
                    .getJSONObject("card")
                    .getString("id"));

            bridge.pushSyncOperations("{\"operations\":[]}", "sync-1");
            CallbackRecord push = callbacks.results.poll(2, TimeUnit.SECONDS);
            assertNotNull(push);
            assertEquals("onPokeSyncResult", push.function);
            assertTrue(push.payload.getBoolean("ok"));
            assertEquals(0, push.payload.getJSONObject("data").getJSONArray("results").length());

            bridge.pullSyncChanges("opaque+/cursor=", 250, "sync-2");
            CallbackRecord pull = callbacks.results.poll(2, TimeUnit.SECONDS);
            assertNotNull(pull);
            assertTrue(pull.payload.getBoolean("ok"));
            assertEquals("next", pull.payload.getJSONObject("data").getString("nextCursor"));
            assertFalse(pull.payload.toString().contains(ACCESS_TOKEN));
            assertFalse(pull.payload.toString().contains(REFRESH_TOKEN));
            assertEquals(4, transport.calls);
        } finally {
            bridge.close();
            cloud.close();
        }
    }

    @Test
    public void invalidBackendEnvelopeFailsClosedAndBridgeDoesNotOwnCloud() throws Exception {
        TestTransport transport = new TestTransport(true);
        PokeFolioCloudService cloud = authenticatedCloud(transport);
        CapturingCallback callbacks = new CapturingCallback();
        PokeFolioCloudBridge bridge = new PokeFolioCloudBridge(cloud, callbacks);
        try {
            bridge.pushSyncOperations("{\"operations\":[]}", "sync-invalid");
            CallbackRecord result = callbacks.results.poll(2, TimeUnit.SECONDS);
            assertNotNull(result);
            assertFalse(result.payload.getBoolean("ok"));
            assertEquals("invalid-response", result.payload.getString("errorType"));
            assertTrue(result.payload.isNull("data"));
            assertThrows(IllegalArgumentException.class, () ->
                    bridge.getCatalogCard("not-a-uuid", "catalog-invalid"));

            bridge.close();
            assertTrue(cloud.getAccountStatus().isAuthenticated());
            assertThrows(IllegalStateException.class, () ->
                    bridge.pushSyncOperations("{\"operations\":[]}", "sync-closed"));
        } finally {
            bridge.close();
            cloud.close();
        }
    }

    private static PokeFolioCloudService authenticatedCloud(TestTransport transport)
            throws IOException {
        PokeFolioCloudService cloud = new PokeFolioCloudService(
                PokeFolioBackendConfiguration.parse("https://api.example.test/"),
                new PokeFolioApiClient(new MemoryRefreshTokenStore(), transport));
        PokeFolioAuthenticationResult login = cloud.login(
                "owner@example.test", "valid-password", "Pixel test");
        assertTrue(login.isSucceeded());
        return cloud;
    }

    private static String catalogReference() {
        return "{\"provider\":\"tcgdex\",\"providerCardId\":\"sv8-141\","
                + "\"tcg\":\"pokemon\",\"name\":\"Pikachu\","
                + "\"setCode\":\"SV8\",\"number\":\"141/191\"}";
    }

    private static String catalogResponse() {
        return "{\"card\":{"
                + "\"id\":\"" + CARD_ID + "\","
                + "\"provider\":\"tcgdex\",\"providerCardId\":\"sv8-141\","
                + "\"tcg\":\"pokemon\",\"name\":\"Pikachu\","
                + "\"setCode\":\"SV8\",\"number\":\"141/191\","
                + "\"createdAt\":\"2026-09-14T00:00:00Z\","
                + "\"updatedAt\":\"2026-09-14T00:00:00Z\"},"
                + "\"created\":true,\"metadataMatched\":true}";
    }

    private static final class CallbackRecord {
        final String function;
        final JSONObject payload;

        CallbackRecord(String function, JSONObject payload) {
            this.function = function;
            this.payload = payload;
        }
    }

    private static final class CapturingCallback implements PokeFolioCloudBridge.Callback {
        final LinkedBlockingQueue<CallbackRecord> results = new LinkedBlockingQueue<>();

        @Override
        public void send(String function, JSONObject payload) {
            results.add(new CallbackRecord(function, payload));
        }
    }

    private static final class TestTransport implements PokeFolioApiTransport {
        private final boolean invalidSyncResponse;
        volatile int calls;

        TestTransport(boolean invalidSyncResponse) {
            this.invalidSyncResponse = invalidSyncResponse;
        }

        @Override
        public synchronized PokeFolioRawResponse send(
                String method,
                String path,
                byte[] body,
                String accessToken,
                int maximumResponseBytes
        ) throws IOException {
            calls++;
            if ("/api/v1/auth/login".equals(path)) {
                return response(200, new String(PokeFolioApiPayloadsTest.sessionJson(
                        "android", DEVICE_ID, ACCESS_TOKEN, REFRESH_TOKEN),
                        StandardCharsets.UTF_8));
            }
            assertEquals(ACCESS_TOKEN, accessToken);
            if ("/api/v1/cards/resolve".equals(path)) return response(201, catalogResponse());
            if ("/api/v1/sync/operations".equals(path)) {
                return response(200, invalidSyncResponse
                        ? "{\"results\":[],\"unexpected\":true}"
                        : "{\"results\":[]}");
            }
            if ("/api/v1/sync/changes?limit=250&cursor=opaque%2B%2Fcursor%3D".equals(path)) {
                return response(200, "{\"changes\":[],\"nextCursor\":\"next\","
                        + "\"hasMore\":false}");
            }
            throw new IOException("Unexpected request: " + path);
        }

        private static PokeFolioRawResponse response(int status, String body) {
            return new PokeFolioRawResponse(status, body.getBytes(StandardCharsets.UTF_8));
        }

        @Override
        public void close() {
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
