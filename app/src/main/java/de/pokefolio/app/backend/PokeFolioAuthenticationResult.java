package de.pokefolio.app.backend;

public final class PokeFolioAuthenticationResult {
    private final PokeFolioSession session;
    private final PokeFolioApiProblem problem;

    private PokeFolioAuthenticationResult(
            PokeFolioSession session,
            PokeFolioApiProblem problem
    ) {
        this.session = session;
        this.problem = problem;
    }

    static PokeFolioAuthenticationResult success(PokeFolioSession session) {
        return new PokeFolioAuthenticationResult(session, null);
    }

    static PokeFolioAuthenticationResult failed(PokeFolioApiProblem problem) {
        return new PokeFolioAuthenticationResult(null, problem);
    }

    public boolean isSucceeded() {
        return session != null;
    }

    public PokeFolioSession getSession() {
        return session;
    }

    public PokeFolioApiProblem getProblem() {
        return problem;
    }
}
