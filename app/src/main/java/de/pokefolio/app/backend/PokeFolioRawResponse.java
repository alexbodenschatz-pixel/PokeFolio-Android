package de.pokefolio.app.backend;

final class PokeFolioRawResponse {
    final int status;
    final byte[] body;

    PokeFolioRawResponse(int status, byte[] body) {
        this.status = status;
        this.body = body;
    }

    boolean isSuccess() {
        return status >= 200 && status < 300;
    }
}
