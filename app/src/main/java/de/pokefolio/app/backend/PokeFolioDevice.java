package de.pokefolio.app.backend;

import java.time.Instant;
import java.util.UUID;

public final class PokeFolioDevice {
    private final UUID id;
    private final String name;
    private final String platform;
    private final Instant createdAt;
    private final Instant lastSeenAt;

    PokeFolioDevice(UUID id, String name, String platform, Instant createdAt, Instant lastSeenAt) {
        this.id = id;
        this.name = name;
        this.platform = platform;
        this.createdAt = createdAt;
        this.lastSeenAt = lastSeenAt;
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getPlatform() {
        return platform;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getLastSeenAt() {
        return lastSeenAt;
    }
}
