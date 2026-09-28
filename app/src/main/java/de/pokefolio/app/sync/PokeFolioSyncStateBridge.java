package de.pokefolio.app.sync;

import de.pokefolio.app.backend.PokeFolioAccountStatus;
import de.pokefolio.app.backend.PokeFolioCloudService;
import de.pokefolio.app.backend.PokeFolioSession;

import java.io.IOException;
import java.util.UUID;

/** Token-free WebView storage boundary whose account owner always comes from native auth state. */
public final class PokeFolioSyncStateBridge {
    private static final UUID EMPTY_UUID = new UUID(0L, 0L);

    private final PokeFolioCloudService cloud;
    private final AccountSyncStateStore store;

    public PokeFolioSyncStateBridge(
            PokeFolioCloudService cloud,
            AccountSyncStateStore store
    ) {
        if (cloud == null || store == null) {
            throw new IllegalArgumentException("Sync-state bridge dependencies are required.");
        }
        this.cloud = cloud;
        this.store = store;
    }

    public String load() throws IOException {
        String snapshot = store.load(authenticatedUserId());
        return snapshot == null ? "" : snapshot;
    }

    public boolean save(String snapshotJson) throws IOException {
        store.save(authenticatedUserId(), snapshotJson);
        return true;
    }

    private UUID authenticatedUserId() {
        PokeFolioAccountStatus status = cloud.getAccountStatus();
        PokeFolioSession session = status.getSession();
        if (!status.isAuthenticated() || session == null
                || session.getUserId() == null || EMPTY_UUID.equals(session.getUserId())) {
            throw new IllegalStateException(
                    "An authenticated account is required for account sync storage.");
        }
        return session.getUserId();
    }
}
