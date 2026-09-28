package de.pokefolio.app.backend;

public final class PokeFolioLogoutResult {
    private final boolean serverSessionRevoked;
    private final PokeFolioApiProblem problem;

    PokeFolioLogoutResult(boolean serverSessionRevoked, PokeFolioApiProblem problem) {
        this.serverSessionRevoked = serverSessionRevoked;
        this.problem = problem;
    }

    public boolean isServerSessionRevoked() {
        return serverSessionRevoked;
    }

    public PokeFolioApiProblem getProblem() {
        return problem;
    }
}
