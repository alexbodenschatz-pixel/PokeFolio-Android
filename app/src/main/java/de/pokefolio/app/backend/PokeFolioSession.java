package de.pokefolio.app.backend;

import java.time.Instant;
import java.util.UUID;

/** Public account state intentionally excludes access and refresh token material. */
public final class PokeFolioSession {
    private final UUID userId;
    private final PokeFolioDevice device;
    private final Instant accessTokenExpiresAt;

    PokeFolioSession(UUID userId, PokeFolioDevice device, Instant accessTokenExpiresAt) {
        this.userId = userId;
        this.device = device;
        this.accessTokenExpiresAt = accessTokenExpiresAt;
    }

    public UUID getUserId() {
        return userId;
    }

    public PokeFolioDevice getDevice() {
        return device;
    }

    public Instant getAccessTokenExpiresAt() {
        return accessTokenExpiresAt;
    }
}
