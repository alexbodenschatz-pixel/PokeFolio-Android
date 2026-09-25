package de.pokefolio.app.backend;

import de.pokefolio.app.security.RefreshTokenCredential;
import de.pokefolio.app.security.RefreshTokenStore;

import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public final class PokeFolioApiClientTest {
    private static final UUID DEVICE_ID =
            UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final String FIRST_ACCESS_TOKEN = "access-" + repeat('a', 64);
    private static final String ROTATED_ACCESS_TOKEN = "access-" + repeat('b', 64);
    private static final String FIRST_REFRESH_TOKEN = "refresh-" + repeat('c', 64);
    private static final String ROTATED_REFRESH_TOKEN = "refresh-" + repeat('d', 64);

    @Test
    public void loginPersistsOnlyRotatingCredentialAndKeepsTokensOutOfPublicSession()
            throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        RecordingTransport transport = new RecordingTransport(request -> {
            assertEquals("POST", request.method);
            assertEquals("/api/v1/auth/login", request.path);
            assertNull(request.accessToken);
            JSONObject body = new JSONObject(new String(request.body, StandardCharsets.UTF_8));
            assertEquals("android", body.getString("platform"));
            assertEquals("Pixel test", body.getString("deviceName"));
            return jsonResponse(200, sessionBody(
                    DEVICE_ID, FIRST_ACCESS_TOKEN, FIRST_REFRESH_TOKEN));
        });
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);

        PokeFolioAuthenticationResult result = client.login(
                "owner@example.test",
                "correct horse battery staple",
                "Pixel test");

        assertTrue(result.isSucceeded());
        assertEquals(PokeFolioApiPayloadsTest.USER_ID, result.getSession().getUserId());
        assertEquals(DEVICE_ID, client.getCurrentSession().getDevice().getId());
        assertEquals(DEVICE_ID, store.credential.getDeviceId());
        assertEquals(FIRST_REFRESH_TOKEN, store.credential.getRefreshToken());
        assertEquals(1, store.saveCount);
        assertFalse(Arrays.stream(PokeFolioSession.class.getMethods())
                .map(java.lang.reflect.Method::getName)
                .anyMatch(name -> "getAccessToken".equals(name) || "getRefreshToken".equals(name)));
        assertFalse(client.getCurrentSession().toString().contains(FIRST_ACCESS_TOKEN));
        assertTrue(allZero(transport.lastResponseBody));
    }

    @Test
    public void passwordResetUsesAnonymousRoutesAndConfirmationRevokesLocalSession()
            throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        String resetToken = "reset-" + repeat('r', 48);
        RecordingTransport transport = new RecordingTransport(request -> {
            if ("/api/v1/auth/login".equals(request.path)) {
                return jsonResponse(200, sessionBody(
                        DEVICE_ID, FIRST_ACCESS_TOKEN, FIRST_REFRESH_TOKEN));
            }
            assertNull(request.accessToken);
            JSONObject body = new JSONObject(new String(request.body, StandardCharsets.UTF_8));
            if ("/api/v1/auth/password/reset/request".equals(request.path)) {
                assertEquals("owner@example.test", body.getString("email"));
                assertEquals(1, body.length());
                return jsonResponse(202, "");
            }
            if ("/api/v1/auth/password/reset/confirm".equals(request.path)) {
                assertEquals("owner@example.test", body.getString("email"));
                assertEquals(resetToken, body.getString("token"));
                assertEquals("replacement password", body.getString("newPassword"));
                assertEquals(3, body.length());
                return jsonResponse(204, "");
            }
            throw new IOException("Unexpected request: " + request.path);
        });
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);
        client.login("owner@example.test", "valid-password", "Pixel test");

        PokeFolioApiResponse requested = client.requestPasswordReset("owner@example.test");
        PokeFolioApiResponse confirmed = client.confirmPasswordReset(
                "owner@example.test", resetToken, "replacement password");

        assertTrue(requested.isSucceeded());
        assertEquals(202, requested.getStatus());
        assertTrue(confirmed.isSucceeded());
        assertEquals(204, confirmed.getStatus());
        assertNull(client.getCurrentSession());
        assertNull(store.credential);
        assertEquals(1, store.deleteCount);
        assertEquals(3, transport.requests.size());
        assertTrue(allZero(transport.lastResponseBody));
    }

    @Test
    public void deviceManagementUsesAuthenticatedVersionedRoutes() throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        UUID otherDeviceId = UUID.fromString("dddddddd-dddd-dddd-dddd-dddddddddddd");
        RecordingTransport transport = new RecordingTransport(request -> {
            if ("/api/v1/auth/login".equals(request.path)) {
                return jsonResponse(200, sessionBody(
                        DEVICE_ID, FIRST_ACCESS_TOKEN, FIRST_REFRESH_TOKEN));
            }
            assertEquals(FIRST_ACCESS_TOKEN, request.accessToken);
            assertNull(request.body);
            if ("/api/v1/devices".equals(request.path) && "GET".equals(request.method)) {
                return jsonResponse(200, "[]");
            }
            if (("/api/v1/devices/" + otherDeviceId).equals(request.path)
                    && "DELETE".equals(request.method)) {
                return jsonResponse(204, "");
            }
            if ("/api/v1/devices".equals(request.path) && "DELETE".equals(request.method)) {
                return jsonResponse(204, "");
            }
            throw new IOException("Unexpected request: " + request.method + " " + request.path);
        });
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);
        client.login("owner@example.test", "valid-password", "Pixel test");

        assertTrue(client.listDevices().isSucceeded());
        assertTrue(client.revokeDevice(otherDeviceId).isSucceeded());
        assertTrue(client.revokeOtherDevices().isSucceeded());
        assertThrows(IllegalArgumentException.class, () ->
                client.revokeDevice(new UUID(0L, 0L)));
        assertEquals(4, transport.requests.size());
    }

    @Test
    public void invalidAuthenticationEnvelopeNeverActivatesOrPersistsSession() {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        String valid = sessionBody(DEVICE_ID, FIRST_ACCESS_TOKEN, FIRST_REFRESH_TOKEN);
        RecordingTransport transport = new RecordingTransport(request -> jsonResponse(
                200,
                valid.replace("\"accessToken\":", "\"accessToken\":\"duplicate\",\"accessToken\":")));
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);

        assertThrows(IOException.class, () -> client.login(
                "owner@example.test", "valid-password", "Pixel test"));

        assertNull(client.getCurrentSession());
        assertNull(store.credential);
        assertEquals(0, store.saveCount);
        assertTrue(allZero(transport.lastResponseBody));
    }

    @Test
    public void restoreRejectsAnotherDeviceAndDeletesTheStoredCredential() {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        store.credential = new RefreshTokenCredential(DEVICE_ID, FIRST_REFRESH_TOKEN);
        UUID otherDevice = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
        RecordingTransport transport = new RecordingTransport(request -> jsonResponse(
                200,
                sessionBody(otherDevice, ROTATED_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN)));
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);

        assertThrows(IOException.class, client::restoreSession);

        assertNull(client.getCurrentSession());
        assertNull(store.credential);
        assertEquals(1, store.deleteCount);
    }

    @Test
    public void concurrentUnauthorizedCallsShareOneRotatingRefresh() throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        CountDownLatch bothOldTokenRequestsArrived = new CountDownLatch(2);
        AtomicInteger refreshCount = new AtomicInteger();
        RecordingTransport transport = new RecordingTransport(request -> {
            if ("/api/v1/auth/login".equals(request.path)) {
                return jsonResponse(200, sessionBody(
                        DEVICE_ID, FIRST_ACCESS_TOKEN, FIRST_REFRESH_TOKEN));
            }
            if ("/api/v1/test".equals(request.path)
                    && FIRST_ACCESS_TOKEN.equals(request.accessToken)) {
                bothOldTokenRequestsArrived.countDown();
                if (!bothOldTokenRequestsArrived.await(5, TimeUnit.SECONDS)) {
                    throw new IOException("Concurrent authenticated requests did not overlap.");
                }
                return jsonResponse(401, "{\"code\":\"authentication_required\"}");
            }
            if ("/api/v1/auth/refresh".equals(request.path)) {
                refreshCount.incrementAndGet();
                return jsonResponse(200, sessionBody(
                        DEVICE_ID, ROTATED_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN));
            }
            if ("/api/v1/test".equals(request.path)
                    && ROTATED_ACCESS_TOKEN.equals(request.accessToken)) {
                return jsonResponse(200, "{\"ok\":true}");
            }
            throw new IOException("Unexpected request: " + request.path);
        });
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);
        client.login("owner@example.test", "valid-password", "Pixel test");
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<PokeFolioApiResponse> first = executor.submit(() ->
                    client.executeAuthenticated("GET", "/api/v1/test", null, 1024));
            Future<PokeFolioApiResponse> second = executor.submit(() ->
                    client.executeAuthenticated("GET", "/api/v1/test", null, 1024));

            assertTrue(first.get(10, TimeUnit.SECONDS).isSucceeded());
            assertTrue(second.get(10, TimeUnit.SECONDS).isSucceeded());
        } finally {
            executor.shutdownNow();
        }

        assertEquals(1, refreshCount.get());
        assertEquals(2, store.saveCount);
        assertEquals(ROTATED_REFRESH_TOKEN, store.credential.getRefreshToken());
        assertEquals(2, transport.count("/api/v1/test", FIRST_ACCESS_TOKEN));
        assertEquals(2, transport.count("/api/v1/test", ROTATED_ACCESS_TOKEN));
    }

    @Test
    public void secondUnauthorizedResponseIsReturnedWithoutAnUnboundedRetry() throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        AtomicInteger protectedCalls = new AtomicInteger();
        RecordingTransport transport = new RecordingTransport(request -> {
            if ("/api/v1/auth/login".equals(request.path)) {
                return jsonResponse(200, sessionBody(
                        DEVICE_ID, FIRST_ACCESS_TOKEN, FIRST_REFRESH_TOKEN));
            }
            if ("/api/v1/auth/refresh".equals(request.path)) {
                return jsonResponse(200, sessionBody(
                        DEVICE_ID, ROTATED_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN));
            }
            protectedCalls.incrementAndGet();
            return jsonResponse(401, "{\"code\":\"authentication_required\"}");
        });
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);
        client.login("owner@example.test", "valid-password", "Pixel test");

        PokeFolioApiResponse response = client.executeAuthenticated(
                "GET", "/api/v1/test", null, 1024);

        assertFalse(response.isSucceeded());
        assertEquals(401, response.getStatus());
        assertEquals("authentication_required", response.getProblem().getCode());
        assertEquals(2, protectedCalls.get());
    }

    @Test
    public void logoutFailureStillClearsMemoryAndPersistentCredential() throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        RecordingTransport transport = new RecordingTransport(request -> {
            if ("/api/v1/auth/login".equals(request.path)) {
                return jsonResponse(200, sessionBody(
                        DEVICE_ID, FIRST_ACCESS_TOKEN, FIRST_REFRESH_TOKEN));
            }
            return jsonResponse(503, "{\"code\":\"database_unavailable\"}");
        });
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);
        client.login("owner@example.test", "valid-password", "Pixel test");

        PokeFolioLogoutResult result = client.logout();

        assertFalse(result.isServerSessionRevoked());
        assertEquals("database_unavailable", result.getProblem().getCode());
        assertNull(client.getCurrentSession());
        assertNull(store.credential);
        assertEquals(1, store.deleteCount);
    }

    @Test
    public void closeClearsMemoryAndRejectsFurtherRequests() throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        RecordingTransport transport = new RecordingTransport(request -> jsonResponse(
                200,
                sessionBody(DEVICE_ID, FIRST_ACCESS_TOKEN, FIRST_REFRESH_TOKEN)));
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);
        client.login("owner@example.test", "valid-password", "Pixel test");

        client.close();

        assertNull(client.getCurrentSession());
        assertTrue(transport.closed);
        assertThrows(IOException.class, client::restoreSession);
    }

    @Test
    public void catalogAndSyncMethodsUseAuthenticatedVersionedRoutes() throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        RecordingTransport transport = new RecordingTransport(request -> {
            if ("/api/v1/auth/login".equals(request.path)) {
                return jsonResponse(200, sessionBody(
                        DEVICE_ID, FIRST_ACCESS_TOKEN, FIRST_REFRESH_TOKEN));
            }
            assertEquals(FIRST_ACCESS_TOKEN, request.accessToken);
            if ("/api/v1/cards/resolve".equals(request.path)) {
                assertEquals("POST", request.method);
                JSONObject reference = new JSONObject(
                        new String(request.body, StandardCharsets.UTF_8));
                assertEquals("tcgdex", reference.getString("provider"));
                assertEquals("sv8-141", reference.getString("providerCardId"));
                return jsonResponse(201, "{\"card\":{},\"created\":true,\"metadataMatched\":true}");
            }
            if (("/api/v1/cards/" + PokeFolioApiPayloadsTest.USER_ID).equals(request.path)) {
                assertEquals("GET", request.method);
                assertNull(request.body);
                return jsonResponse(200, "{\"id\":\"" + PokeFolioApiPayloadsTest.USER_ID + "\"}");
            }
            if ("/api/v1/sync/operations".equals(request.path)) {
                assertEquals("POST", request.method);
                assertEquals("{\"operations\":[]}",
                        new String(request.body, StandardCharsets.UTF_8));
                return jsonResponse(200, "{\"results\":[]}");
            }
            if ("/api/v1/sync/changes?limit=250&cursor=opaque%2B%2Fcursor%3D".equals(
                    request.path)) {
                assertEquals("GET", request.method);
                assertNull(request.body);
                return jsonResponse(200, "{\"changes\":[],\"nextCursor\":\"next\",\"hasMore\":false}");
            }
            throw new IOException("Unexpected request: " + request.path);
        });
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);
        client.login("owner@example.test", "valid-password", "Pixel test");

        assertTrue(client.resolveCatalogCard(
                "{\"provider\":\"TCGDEX\",\"providerCardId\":\"SV8-141\","
                        + "\"tcg\":\"POKEMON\",\"name\":\"Pikachu\","
                        + "\"setCode\":\"SV8\",\"number\":\"141/191\"}")
                .isSucceeded());
        assertTrue(client.getCatalogCard(PokeFolioApiPayloadsTest.USER_ID).isSucceeded());
        assertTrue(client.pushSyncOperations("{\"operations\":[]}").isSucceeded());
        assertTrue(client.pullSyncChanges("opaque+/cursor=", 250).isSucceeded());
        assertEquals(5, transport.requests.size());
    }

    @Test
    public void invalidCloudInputsFailBeforeAuthenticationOrNetwork() {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        RecordingTransport transport = new RecordingTransport(request -> {
            throw new IOException("Network must not be reached.");
        });
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);

        assertThrows(IllegalArgumentException.class, () ->
                client.pushSyncOperations("[]"));
        assertThrows(IllegalArgumentException.class, () ->
                client.pullSyncChanges(null, 0));
        assertThrows(IllegalArgumentException.class, () ->
                client.getCatalogCard(new UUID(0L, 0L)));
        assertThrows(IllegalArgumentException.class, () ->
                client.resolveCatalogCard("{}"));
        assertEquals(0, transport.requests.size());
    }

    @Test
    public void operationBoundToPreviousAccountIsRejectedBeforeNetworkSend() throws Exception {
        MemoryRefreshTokenStore store = new MemoryRefreshTokenStore();
        UUID secondUser = UUID.fromString("dddddddd-dddd-dddd-dddd-dddddddddddd");
        AtomicInteger loginCount = new AtomicInteger();
        RecordingTransport transport = new RecordingTransport(request -> {
            if (!"/api/v1/auth/login".equals(request.path)) {
                throw new IOException("Cross-account operation must not reach the network.");
            }
            String session = sessionBody(
                    DEVICE_ID,
                    loginCount.incrementAndGet() == 1
                            ? FIRST_ACCESS_TOKEN : ROTATED_ACCESS_TOKEN,
                    loginCount.get() == 1 ? FIRST_REFRESH_TOKEN : ROTATED_REFRESH_TOKEN);
            if (loginCount.get() == 2) {
                session = session.replace(
                        PokeFolioApiPayloadsTest.USER_ID.toString(),
                        secondUser.toString());
            }
            return jsonResponse(200, session);
        });
        PokeFolioApiClient client = new PokeFolioApiClient(store, transport);
        client.login("first@example.test", "valid-password", "Pixel test");
        UUID firstUser = client.getCurrentSession().getUserId();
        client.login("second@example.test", "valid-password", "Pixel test");

        PokeFolioApiResponse result = client.pushSyncOperations(
                "{\"operations\":[]}",
                firstUser);

        assertFalse(result.isSucceeded());
        assertEquals(409, result.getStatus());
        assertEquals("account_changed", result.getProblem().getCode());
        assertEquals(secondUser, client.getCurrentSession().getUserId());
        assertEquals(2, transport.requests.size());
    }

    private static String sessionBody(
            UUID deviceId,
            String accessToken,
            String refreshToken
    ) {
        return new String(PokeFolioApiPayloadsTest.sessionJson(
                "android", deviceId, accessToken, refreshToken), StandardCharsets.UTF_8);
    }

    private static PokeFolioRawResponse jsonResponse(int status, String body) {
        return new PokeFolioRawResponse(status, body.getBytes(StandardCharsets.UTF_8));
    }

    private static String repeat(char value, int count) {
        char[] result = new char[count];
        Arrays.fill(result, value);
        return new String(result);
    }

    private static boolean allZero(byte[] value) {
        if (value == null) return false;
        for (byte item : value) {
            if (item != 0) return false;
        }
        return true;
    }

    private interface Responder {
        PokeFolioRawResponse respond(RecordedRequest request) throws Exception;
    }

    private static final class RecordedRequest {
        final String method;
        final String path;
        final byte[] body;
        final String accessToken;

        RecordedRequest(String method, String path, byte[] body, String accessToken) {
            this.method = method;
            this.path = path;
            this.body = body;
            this.accessToken = accessToken;
        }
    }

    private static final class RecordingTransport implements PokeFolioApiTransport {
        private final Responder responder;
        private final List<RecordedRequest> requests = new ArrayList<>();
        volatile byte[] lastResponseBody;
        volatile boolean closed;

        RecordingTransport(Responder responder) {
            this.responder = responder;
        }

        @Override
        public PokeFolioRawResponse send(
                String method,
                String path,
                byte[] body,
                String accessToken,
                int maximumResponseBytes
        ) throws IOException {
            RecordedRequest request = new RecordedRequest(
                    method,
                    path,
                    body == null ? null : body.clone(),
                    accessToken);
            synchronized (requests) {
                requests.add(request);
            }
            try {
                PokeFolioRawResponse response = responder.respond(request);
                lastResponseBody = response.body;
                return response;
            } catch (IOException error) {
                throw error;
            } catch (Exception error) {
                throw new IOException("Test transport failed.", error);
            }
        }

        int count(String path, String accessToken) {
            synchronized (requests) {
                int matches = 0;
                for (RecordedRequest request : requests) {
                    if (path.equals(request.path) && accessToken.equals(request.accessToken)) {
                        matches++;
                    }
                }
                return matches;
            }
        }

        @Override
        public void close() {
            closed = true;
        }
    }

    private static final class MemoryRefreshTokenStore implements RefreshTokenStore {
        RefreshTokenCredential credential;
        int saveCount;
        int deleteCount;

        @Override
        public synchronized RefreshTokenCredential load() {
            return credential;
        }

        @Override
        public synchronized void save(RefreshTokenCredential value) {
            credential = value;
            saveCount++;
        }

        @Override
        public synchronized void delete() {
            credential = null;
            deleteCount++;
        }
    }
}
