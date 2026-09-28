package de.pokefolio.app.backend;

import java.io.Closeable;
import java.io.IOException;

interface PokeFolioApiTransport extends Closeable {
    PokeFolioRawResponse send(
            String method,
            String path,
            byte[] body,
            String accessToken,
            int maximumResponseBytes
    ) throws IOException;
}
