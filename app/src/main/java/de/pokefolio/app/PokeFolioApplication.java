package de.pokefolio.app;

import android.app.Application;

import de.pokefolio.app.backend.PokeFolioBackendConfiguration;
import de.pokefolio.app.backend.PokeFolioCloudService;
import de.pokefolio.app.security.ProtectedRefreshTokenStore;
import de.pokefolio.app.sync.AccountSyncStateStore;

import java.io.File;

/** Process-scoped owner for the one rotating Android device session. */
public final class PokeFolioApplication extends Application {
    private volatile PokeFolioCloudService cloudService;
    private volatile AccountSyncStateStore syncStateStore;

    @Override
    public void onCreate() {
        super.onCreate();
        PokeFolioBackendConfiguration configuration =
                PokeFolioBackendConfiguration.parse(BuildConfig.POKEFOLIO_BACKEND_ORIGIN);
        cloudService = new PokeFolioCloudService(
                configuration,
                new ProtectedRefreshTokenStore(this));
        syncStateStore = new AccountSyncStateStore(new File(getFilesDir(), "sync"));
    }

    public PokeFolioCloudService getCloudService() {
        PokeFolioCloudService current = cloudService;
        if (current == null) {
            throw new IllegalStateException("PokeFolio cloud service is not initialized.");
        }
        return current;
    }

    public AccountSyncStateStore getSyncStateStore() {
        AccountSyncStateStore current = syncStateStore;
        if (current == null) {
            throw new IllegalStateException("PokeFolio sync-state store is not initialized.");
        }
        return current;
    }
}
