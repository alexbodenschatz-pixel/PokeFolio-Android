package de.pokefolio.app.security;

import java.util.UUID;

/** Refresh credentials remain native and are never exposed to WebView JavaScript. */
public final class RefreshTokenCredential {
    private final UUID deviceId;
    private final String refreshToken;

    public RefreshTokenCredential(UUID deviceId, String refreshToken) {
        this.deviceId = deviceId;
        this.refreshToken = refreshToken;
    }

    public UUID getDeviceId() {
        return deviceId;
    }

    public String getRefreshToken() {
        return refreshToken;
    }
}
