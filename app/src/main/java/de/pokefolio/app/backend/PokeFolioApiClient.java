package de.pokefolio.app.backend;

import de.pokefolio.app.security.RefreshTokenCredential;
import de.pokefolio.app.security.RefreshTokenStore;

import java.io.Closeable;
import java.io.IOException;
import java.util.Arrays;

/** Thread-safe native account client with one rotating device session. */
public final class PokeFolioApiClient implements Closeable {
    private static final int MAXIMUM_AUTH_RESPONSE_BYTES = 128 * 1024;
    private static final PokeFolioApiProblem SESSION_MISSING = new PokeFolioApiProblem(
            401,
            "session_missing",
            "No persistent PokeFolio session is available.",
            null);

    private final Object sessionGate = new Object();
    private final RefreshTokenStore refreshTokenStore;
    private final PokeFolioApiTransport transport;
    private volatile SessionState session;
    private volatile boolean closed;

    public PokeFolioApiClient(
            PokeFolioBackendConfiguration configuration,
            RefreshTokenStore refreshTokenStore
    ) {
        if (configuration == null || !configuration.isConfigured()) {
            throw new IllegalArgumentException("A valid backend configuration is required.");
        }
        if (refreshTokenStore == null) {
            throw new IllegalArgumentException("Refresh-token storage is required.");
        }
        this.refreshTokenStore = refreshTokenStore;
        this.transport = new PokeFolioHttpTransport(configuration.getBackendOrigin());
    }

    PokeFolioApiClient(
            RefreshTokenStore refreshTokenStore,
            PokeFolioApiTransport transport
    ) {
        if (refreshTokenStore == null || transport == null) {
            throw new IllegalArgumentException("Account client dependencies are required.");
        }
        this.refreshTokenStore = refreshTokenStore;
        this.transport = transport;
    }

    public PokeFolioSession getCurrentSession() {
        return toPublicSession(session);
    }

    public PokeFolioAuthenticationResult register(
            String email,
            String password,
            String deviceName
    ) throws IOException {
        return startSession("/api/v1/auth/register", email, password, deviceName);
    }

    public PokeFolioAuthenticationResult login(
            String email,
            String password,
            String deviceName
    ) throws IOException {
        return startSession("/api/v1/auth/login", email, password, deviceName);
    }

    public PokeFolioAuthenticationResult restoreSession() throws IOException {
        throwIfClosed();
        synchronized (sessionGate) {
            throwIfClosed();
            if (session != null) {
                return PokeFolioAuthenticationResult.success(toPublicSession(session));
            }
            RefreshTokenCredential credential = refreshTokenStore.load();
            return credential == null
                    ? PokeFolioAuthenticationResult.failed(SESSION_MISSING)
                    : refreshCore(credential);
        }
    }

    public PokeFolioLogoutResult logout() throws IOException {
        throwIfClosed();
        synchronized (sessionGate) {
            throwIfClosed();
            PokeFolioRawResponse response = null;
            try {
                SessionState current = session;
                if (current == null) {
                    RefreshTokenCredential stored = refreshTokenStore.load();
                    if (stored != null) {
                        PokeFolioAuthenticationResult restored = refreshCore(stored);
                        current = restored.isSucceeded() ? session : null;
                        if (current == null) {
                            return new PokeFolioLogoutResult(false, restored.getProblem());
                        }
                    }
                }
                if (current == null) return new PokeFolioLogoutResult(false, null);

                response = transport.send(
                        "POST",
                        "/api/v1/auth/logout",
                        null,
                        current.accessToken,
                        MAXIMUM_AUTH_RESPONSE_BYTES);
                if (response.status == 401) {
                    clear(response.body);
                    response = null;
                    RefreshTokenCredential stored = refreshTokenStore.load();
                    if (stored != null) {
                        PokeFolioAuthenticationResult refreshed = refreshCore(stored);
                        current = refreshed.isSucceeded() ? session : null;
                        if (current != null) {
                            response = transport.send(
                                    "POST",
                                    "/api/v1/auth/logout",
                                    null,
                                    current.accessToken,
                                    MAXIMUM_AUTH_RESPONSE_BYTES);
                        }
                    }
                }
                if (response == null) {
                    return new PokeFolioLogoutResult(false, SESSION_MISSING);
                }
                return response.isSuccess()
                        ? new PokeFolioLogoutResult(true, null)
                        : new PokeFolioLogoutResult(
                                false,
                                PokeFolioApiPayloads.parseProblem(response.status, response.body));
            } finally {
                if (response != null) clear(response.body);
                session = null;
                refreshTokenStore.delete();
            }
        }
    }

    PokeFolioApiResponse executeAuthenticated(
            String method,
            String path,
            byte[] body,
            int maximumResponseBytes
    ) throws IOException {
        throwIfClosed();
        SessionResolution resolution = ensureSession();
        SessionState current = resolution.session;
        if (current == null) {
            return new PokeFolioApiResponse(
                    resolution.problem.getStatus(),
                    "",
                    resolution.problem);
        }

        PokeFolioRawResponse response = transport.send(
                method,
                path,
                body,
                current.accessToken,
                maximumResponseBytes);
        if (response.status == 401) {
            clear(response.body);
            SessionResolution refreshed = refreshAfterUnauthorized(current.accessToken);
            if (refreshed.session == null) {
                return new PokeFolioApiResponse(
                        refreshed.problem.getStatus(),
                        "",
                        refreshed.problem);
            }
            response = transport.send(
                    method,
                    path,
                    body,
                    refreshed.session.accessToken,
                    maximumResponseBytes);
        }

        try {
            String responseBody = PokeFolioApiPayloads.decodeUtf8(response.body);
            return response.isSuccess()
                    ? new PokeFolioApiResponse(response.status, responseBody, null)
                    : new PokeFolioApiResponse(
                            response.status,
                            responseBody,
                            PokeFolioApiPayloads.parseProblem(response.status, response.body));
        } finally {
            clear(response.body);
        }
    }

    private PokeFolioAuthenticationResult startSession(
            String path,
            String email,
            String password,
            String deviceName
    ) throws IOException {
        throwIfClosed();
        byte[] body = PokeFolioApiPayloads.serializeLogin(email, password, deviceName);
        synchronized (sessionGate) {
            PokeFolioRawResponse response = null;
            try {
                throwIfClosed();
                response = transport.send(
                        "POST",
                        path,
                        body,
                        null,
                        MAXIMUM_AUTH_RESPONSE_BYTES);
                if (!response.isSuccess()) {
                    return PokeFolioAuthenticationResult.failed(
                            PokeFolioApiPayloads.parseProblem(response.status, response.body));
                }
                PokeFolioApiPayloads.AuthEnvelope envelope =
                        PokeFolioApiPayloads.parseSession(response.body);
                activateSession(envelope);
                return PokeFolioAuthenticationResult.success(toPublicSession(session));
            } finally {
                if (response != null) clear(response.body);
                clear(body);
            }
        }
    }

    private PokeFolioAuthenticationResult refreshCore(
            RefreshTokenCredential credential
    ) throws IOException {
        byte[] body = PokeFolioApiPayloads.serializeRefresh(credential.getRefreshToken());
        PokeFolioRawResponse response = null;
        try {
            response = transport.send(
                    "POST",
                    "/api/v1/auth/refresh",
                    body,
                    null,
                    MAXIMUM_AUTH_RESPONSE_BYTES);
            if (!response.isSuccess()) {
                PokeFolioApiProblem problem =
                        PokeFolioApiPayloads.parseProblem(response.status, response.body);
                if (response.status == 400 || response.status == 401) invalidateLocalSession();
                return PokeFolioAuthenticationResult.failed(problem);
            }
            try {
                PokeFolioApiPayloads.AuthEnvelope envelope =
                        PokeFolioApiPayloads.parseSession(response.body);
                if (!envelope.device.id.equals(credential.getDeviceId())) {
                    throw new IOException("Refresh response belongs to a different device session.");
                }
                activateSession(envelope);
                return PokeFolioAuthenticationResult.success(toPublicSession(session));
            } catch (IOException | RuntimeException error) {
                session = null;
                try {
                    refreshTokenStore.delete();
                } catch (IOException | RuntimeException deleteError) {
                    error.addSuppressed(deleteError);
                }
                throw error;
            }
        } finally {
            if (response != null) clear(response.body);
            clear(body);
        }
    }

    private SessionResolution ensureSession() throws IOException {
        SessionState current = session;
        if (current != null) return new SessionResolution(current, null);
        synchronized (sessionGate) {
            throwIfClosed();
            current = session;
            if (current != null) return new SessionResolution(current, null);
            RefreshTokenCredential credential = refreshTokenStore.load();
            if (credential == null) return new SessionResolution(null, SESSION_MISSING);
            PokeFolioAuthenticationResult result = refreshCore(credential);
            return result.isSucceeded()
                    ? new SessionResolution(session, null)
                    : new SessionResolution(null, result.getProblem());
        }
    }

    private SessionResolution refreshAfterUnauthorized(String rejectedAccessToken) throws IOException {
        synchronized (sessionGate) {
            throwIfClosed();
            SessionState current = session;
            if (current != null && !current.accessToken.equals(rejectedAccessToken)) {
                return new SessionResolution(current, null);
            }
            RefreshTokenCredential credential = refreshTokenStore.load();
            if (credential == null) return new SessionResolution(null, SESSION_MISSING);
            PokeFolioAuthenticationResult result = refreshCore(credential);
            return result.isSucceeded()
                    ? new SessionResolution(session, null)
                    : new SessionResolution(null, result.getProblem());
        }
    }

    private void activateSession(PokeFolioApiPayloads.AuthEnvelope envelope) throws IOException {
        try {
            refreshTokenStore.save(new RefreshTokenCredential(
                    envelope.device.id,
                    envelope.refreshToken));
        } catch (IOException | RuntimeException saveError) {
            session = null;
            try {
                refreshTokenStore.delete();
            } catch (IOException | RuntimeException deleteError) {
                saveError.addSuppressed(deleteError);
            }
            throw new IOException("Rotated refresh token could not be persisted.", saveError);
        }
        session = new SessionState(
                envelope.userId,
                envelope.accessToken,
                envelope.accessTokenExpiresAt,
                new PokeFolioDevice(
                        envelope.device.id,
                        envelope.device.name,
                        envelope.device.platform,
                        envelope.device.createdAt,
                        envelope.device.lastSeenAt));
    }

    private void invalidateLocalSession() throws IOException {
        session = null;
        refreshTokenStore.delete();
    }

    private static PokeFolioSession toPublicSession(SessionState value) {
        return value == null
                ? null
                : new PokeFolioSession(value.userId, value.device, value.accessTokenExpiresAt);
    }

    private void throwIfClosed() throws IOException {
        if (closed) throw new IOException("PokeFolio API client is closed.");
    }

    @Override
    public void close() throws IOException {
        synchronized (sessionGate) {
            if (closed) return;
            closed = true;
            session = null;
            transport.close();
        }
    }

    private static void clear(byte[] value) {
        if (value != null) Arrays.fill(value, (byte) 0);
    }

    private static final class SessionState {
        final java.util.UUID userId;
        final String accessToken;
        final java.time.Instant accessTokenExpiresAt;
        final PokeFolioDevice device;

        SessionState(
                java.util.UUID userId,
                String accessToken,
                java.time.Instant accessTokenExpiresAt,
                PokeFolioDevice device
        ) {
            this.userId = userId;
            this.accessToken = accessToken;
            this.accessTokenExpiresAt = accessTokenExpiresAt;
            this.device = device;
        }
    }

    private static final class SessionResolution {
        final SessionState session;
        final PokeFolioApiProblem problem;

        SessionResolution(SessionState session, PokeFolioApiProblem problem) {
            this.session = session;
            this.problem = problem;
        }
    }
}
