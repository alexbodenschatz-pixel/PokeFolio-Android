package de.pokefolio.app.backend;

import de.pokefolio.app.security.RefreshTokenStore;

import java.io.Closeable;
import java.io.IOException;
import java.util.UUID;

/** Owns the one native Android account session that later catalog and sync bridges will share. */
public final class PokeFolioCloudService implements Closeable {
    private final PokeFolioBackendConfiguration configuration;
    private final PokeFolioApiClient client;
    private volatile boolean closed;

    public PokeFolioCloudService(
            PokeFolioBackendConfiguration configuration,
            RefreshTokenStore refreshTokenStore
    ) {
        this(
                requireConfiguration(configuration),
                configuration.isConfigured()
                        ? new PokeFolioApiClient(configuration, refreshTokenStore)
                        : null);
    }

    PokeFolioCloudService(
            PokeFolioBackendConfiguration configuration,
            PokeFolioApiClient client
    ) {
        this.configuration = requireConfiguration(configuration);
        if (configuration.isConfigured() != (client != null)) {
            throw new IllegalArgumentException(
                    "Configured cloud services require exactly one API client.");
        }
        this.client = client;
    }

    public PokeFolioAccountStatus getAccountStatus() {
        throwIfClosed();
        PokeFolioSession current = client == null ? null : client.getCurrentSession();
        return new PokeFolioAccountStatus(
                configuration.isConfigured(),
                configuration.getBackendOrigin() == null
                        ? null : configuration.getBackendOrigin().toString(),
                configurationMessage(),
                current);
    }

    public PokeFolioAuthenticationResult register(
            String email,
            String password,
            String deviceName
    ) throws IOException {
        throwIfClosed();
        return client == null
                ? unavailableAuthentication()
                : client.register(email, password, deviceName);
    }

    public PokeFolioAuthenticationResult login(
            String email,
            String password,
            String deviceName
    ) throws IOException {
        throwIfClosed();
        return client == null
                ? unavailableAuthentication()
                : client.login(email, password, deviceName);
    }

    public PokeFolioAuthenticationResult restoreSession() throws IOException {
        throwIfClosed();
        return client == null
                ? unavailableAuthentication()
                : client.restoreSession();
    }

    public PokeFolioLogoutResult logout() throws IOException {
        throwIfClosed();
        return client == null
                ? new PokeFolioLogoutResult(false, unavailableProblem())
                : client.logout();
    }

    public PokeFolioApiResponse pushSyncOperations(String operationBatchJson) throws IOException {
        return pushSyncOperations(operationBatchJson, null);
    }

    PokeFolioApiResponse pushSyncOperations(String operationBatchJson, UUID expectedUserId)
            throws IOException {
        throwIfClosed();
        return client == null
                ? unavailableResponse()
                : client.pushSyncOperations(operationBatchJson, expectedUserId);
    }

    public PokeFolioApiResponse pullSyncChanges(String cursor, int limit) throws IOException {
        return pullSyncChanges(cursor, limit, null);
    }

    PokeFolioApiResponse pullSyncChanges(String cursor, int limit, UUID expectedUserId)
            throws IOException {
        throwIfClosed();
        return client == null
                ? unavailableResponse()
                : client.pullSyncChanges(cursor, limit, expectedUserId);
    }

    public PokeFolioApiResponse resolveCatalogCard(String cardReferenceJson) throws IOException {
        return resolveCatalogCard(cardReferenceJson, null);
    }

    PokeFolioApiResponse resolveCatalogCard(String cardReferenceJson, UUID expectedUserId)
            throws IOException {
        throwIfClosed();
        return client == null
                ? unavailableResponse()
                : client.resolveCatalogCard(cardReferenceJson, expectedUserId);
    }

    public PokeFolioApiResponse getCatalogCard(UUID cardId) throws IOException {
        return getCatalogCard(cardId, null);
    }

    PokeFolioApiResponse getCatalogCard(UUID cardId, UUID expectedUserId) throws IOException {
        throwIfClosed();
        return client == null
                ? unavailableResponse()
                : client.getCatalogCard(cardId, expectedUserId);
    }

    private PokeFolioAuthenticationResult unavailableAuthentication() {
        return PokeFolioAuthenticationResult.failed(unavailableProblem());
    }

    private PokeFolioApiProblem unavailableProblem() {
        return new PokeFolioApiProblem(
                503,
                "backend_not_configured",
                configurationMessage(),
                null);
    }

    private PokeFolioApiResponse unavailableResponse() {
        PokeFolioApiProblem problem = unavailableProblem();
        return new PokeFolioApiResponse(problem.getStatus(), "", problem);
    }

    private String configurationMessage() {
        if (configuration.isConfigured()) return null;
        return configuration.getError() == null
                ? "PokeFolio backend is not configured."
                : configuration.getError();
    }

    private static PokeFolioBackendConfiguration requireConfiguration(
            PokeFolioBackendConfiguration configuration
    ) {
        if (configuration == null) {
            throw new IllegalArgumentException("Backend configuration is required.");
        }
        return configuration;
    }

    private void throwIfClosed() {
        if (closed) throw new IllegalStateException("PokeFolio cloud service is closed.");
    }

    @Override
    public synchronized void close() throws IOException {
        if (closed) return;
        closed = true;
        if (client != null) client.close();
    }
}
