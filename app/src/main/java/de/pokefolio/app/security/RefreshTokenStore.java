package de.pokefolio.app.security;

import java.io.IOException;

public interface RefreshTokenStore {
    RefreshTokenCredential load() throws IOException;

    void save(RefreshTokenCredential credential) throws IOException;

    void delete() throws IOException;
}
