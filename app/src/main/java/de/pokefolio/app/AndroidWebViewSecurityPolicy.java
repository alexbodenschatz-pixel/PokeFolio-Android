package de.pokefolio.app;

import java.net.URI;
import java.util.Locale;

/** Pure URL policy for the bundled Android WebView application. */
final class AndroidWebViewSecurityPolicy {
    private static final String ASSET_ROOT = "/android_asset/";

    private AndroidWebViewSecurityPolicy() {
    }

    static boolean isTrustedAssetUrl(String value) {
        if (value == null || value.isBlank()) return false;
        try {
            URI uri = URI.create(value);
            if (!"file".equalsIgnoreCase(uri.getScheme())) return false;
            if (uri.getAuthority() != null && !uri.getAuthority().isEmpty()) return false;
            String rawPath = uri.getRawPath();
            if (rawPath == null || rawPath.indexOf('\\') >= 0) return false;

            // Encoded separators or dot segments can otherwise make a prefix check ambiguous.
            String lowerPath = rawPath.toLowerCase(Locale.ROOT);
            if (lowerPath.contains("%2e") || lowerPath.contains("%2f") || lowerPath.contains("%5c")) {
                return false;
            }
            String normalizedPath = uri.normalize().getPath();
            return normalizedPath != null && normalizedPath.startsWith(ASSET_ROOT);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }
}
