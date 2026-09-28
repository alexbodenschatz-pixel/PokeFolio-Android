package de.pokefolio.app.backend;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.Arrays;
import java.util.Locale;

final class PokeFolioHttpTransport implements PokeFolioApiTransport {
    private static final int BUFFER_SIZE = 16 * 1024;
    private final URI backendOrigin;

    PokeFolioHttpTransport(URI backendOrigin) {
        PokeFolioBackendConfiguration configuration =
                PokeFolioBackendConfiguration.parse(backendOrigin == null
                        ? null : backendOrigin.toString());
        if (!configuration.isConfigured()) {
            throw new IllegalArgumentException("Backend origin is invalid.");
        }
        this.backendOrigin = configuration.getBackendOrigin();
    }

    @Override
    public PokeFolioRawResponse send(
            String method,
            String path,
            byte[] body,
            String accessToken,
            int maximumResponseBytes
    ) throws IOException {
        if (!("GET".equals(method) || "POST".equals(method)
                || "PATCH".equals(method) || "DELETE".equals(method))) {
            throw new IllegalArgumentException("HTTP method is not supported.");
        }
        if (maximumResponseBytes < 1 || maximumResponseBytes > 8 * 1024 * 1024) {
            throw new IllegalArgumentException("Response limit is invalid.");
        }
        if (body != null && body.length > 1024 * 1024) {
            throw new IllegalArgumentException("Request body exceeds its size limit.");
        }
        URI target = buildTarget(path);
        HttpURLConnection connection = (HttpURLConnection) new URL(target.toString()).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(5_000);
            connection.setReadTimeout(15_000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "PokeFolio-Android/0.16.5");
            if (accessToken != null) {
                if (accessToken.length() < 32 || accessToken.length() > 16_384
                        || accessToken.indexOf('\r') >= 0 || accessToken.indexOf('\n') >= 0) {
                    throw new IllegalArgumentException("Access token is invalid.");
                }
                connection.setRequestProperty("Authorization", "Bearer " + accessToken);
            }
            if (body != null) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }
            }

            int status = connection.getResponseCode();
            long declaredLength = connection.getContentLengthLong();
            if (declaredLength > maximumResponseBytes) {
                throw new IOException("Backend response exceeds its size limit.");
            }
            InputStream raw = status >= 200 && status < 400
                    ? connection.getInputStream() : connection.getErrorStream();
            byte[] responseBody = raw == null
                    ? new byte[0] : readBounded(raw, maximumResponseBytes);
            return new PokeFolioRawResponse(status, responseBody);
        } finally {
            connection.disconnect();
        }
    }

    private URI buildTarget(String path) {
        if (path == null || !path.startsWith("/api/v1/") || path.startsWith("//")
                || path.indexOf('\\') >= 0 || path.indexOf('\r') >= 0 || path.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("Backend path must stay below /api/v1/.");
        }
        String lowerPath = path.toLowerCase(Locale.ROOT);
        if (lowerPath.contains("%2e") || lowerPath.contains("%2f")
                || lowerPath.contains("%5c")) {
            throw new IllegalArgumentException("Backend path contains encoded traversal syntax.");
        }
        URI target = backendOrigin.resolve(path.substring(1));
        if (!backendOrigin.getScheme().equalsIgnoreCase(target.getScheme())
                || !backendOrigin.getHost().equalsIgnoreCase(target.getHost())
                || effectivePort(backendOrigin) != effectivePort(target)
                || target.getRawUserInfo() != null || target.getRawFragment() != null
                || target.getRawPath() == null
                || !target.getRawPath().startsWith("/api/v1/")) {
            throw new IllegalArgumentException("Backend request escaped its configured origin.");
        }
        return target;
    }

    private static int effectivePort(URI value) {
        if (value.getPort() >= 0) return value.getPort();
        return "https".equalsIgnoreCase(value.getScheme()) ? 443 : 80;
    }

    private static byte[] readBounded(InputStream input, int maximumBytes) throws IOException {
        try (InputStream source = input;
             ByteArrayOutputStream output = new ByteArrayOutputStream(
                     Math.min(maximumBytes, BUFFER_SIZE))) {
            byte[] buffer = new byte[BUFFER_SIZE];
            try {
                int read;
                while ((read = source.read(buffer)) != -1) {
                    if (output.size() + read > maximumBytes) {
                        throw new IOException("Backend response exceeds its size limit.");
                    }
                    output.write(buffer, 0, read);
                }
                return output.toByteArray();
            } finally {
                Arrays.fill(buffer, (byte) 0);
            }
        }
    }

    @Override
    public void close() {
        // HttpURLConnection has no shared client resource; each request disconnects in finally.
    }
}
