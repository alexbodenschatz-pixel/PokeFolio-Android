package de.pokefolio.app.backend;

/** Token-free account state shared by the native host and its narrow WebView bridge. */
public final class PokeFolioAccountStatus {
    private final boolean configured;
    private final String backendOrigin;
    private final String configurationError;
    private final PokeFolioSession session;

    PokeFolioAccountStatus(
            boolean configured,
            String backendOrigin,
            String configurationError,
            PokeFolioSession session
    ) {
        this.configured = configured;
        this.backendOrigin = backendOrigin;
        this.configurationError = configurationError;
        this.session = session;
    }

    public boolean isConfigured() {
        return configured;
    }

    public boolean isAuthenticated() {
        return session != null;
    }

    public String getBackendOrigin() {
        return backendOrigin;
    }

    public String getConfigurationError() {
        return configurationError;
    }

    public PokeFolioSession getSession() {
        return session;
    }
}
