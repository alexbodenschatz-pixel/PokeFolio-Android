package de.pokefolio.app.backend;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Validates the non-secret API origin before any account transport is created. */
public final class PokeFolioBackendConfiguration {
    private final URI backendOrigin;
    private final String error;

    private PokeFolioBackendConfiguration(URI backendOrigin, String error) {
        this.backendOrigin = backendOrigin;
        this.error = error;
    }

    public static PokeFolioBackendConfiguration parse(String value) {
        if (value == null || value.trim().isEmpty()) {
            return new PokeFolioBackendConfiguration(null, null);
        }

        try {
            URI candidate = new URI(value.trim());
            String scheme = candidate.getScheme() == null
                    ? "" : candidate.getScheme().toLowerCase(Locale.ROOT);
            String host = candidate.getHost();
            String rawPath = candidate.getRawPath();
            boolean pathFree = rawPath == null || rawPath.isEmpty() || "/".equals(rawPath);
            boolean https = "https".equals(scheme);
            boolean loopbackHttp = "http".equals(scheme) && isLoopbackHost(host);
            if (candidate.isOpaque()
                    || host == null || host.isBlank()
                    || candidate.getRawUserInfo() != null
                    || candidate.getRawQuery() != null
                    || candidate.getRawFragment() != null
                    || candidate.getPort() > 65535
                    || !pathFree
                    || (!https && !loopbackHttp)) {
                return invalid();
            }

            String normalizedHost = host.toLowerCase(Locale.ROOT);
            if (normalizedHost.indexOf(':') >= 0 && !normalizedHost.startsWith("[")) {
                normalizedHost = "[" + normalizedHost + "]";
            }
            String authority = normalizedHost + (candidate.getPort() < 0
                    ? "" : ":" + candidate.getPort());
            return new PokeFolioBackendConfiguration(
                    new URI(scheme + "://" + authority + "/"),
                    null);
        } catch (IllegalArgumentException | URISyntaxException ignored) {
            return invalid();
        }
    }

    public boolean isConfigured() {
        return backendOrigin != null;
    }

    public URI getBackendOrigin() {
        return backendOrigin;
    }

    public String getError() {
        return error;
    }

    private static boolean isLoopbackHost(String host) {
        if (host == null) return false;
        String normalized = host.toLowerCase(Locale.ROOT);
        return "localhost".equals(normalized)
                || "127.0.0.1".equals(normalized)
                || "::1".equals(normalized)
                || "[::1]".equals(normalized);
    }

    private static PokeFolioBackendConfiguration invalid() {
        return new PokeFolioBackendConfiguration(
                null,
                "POKEFOLIO_BACKEND_ORIGIN must be path-free HTTPS, or loopback HTTP for local development.");
    }
}
