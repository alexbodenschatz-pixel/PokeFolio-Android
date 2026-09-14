package de.pokefolio.app.backend;

public final class PokeFolioApiResponse {
    private final int status;
    private final String body;
    private final PokeFolioApiProblem problem;

    PokeFolioApiResponse(int status, String body, PokeFolioApiProblem problem) {
        this.status = status;
        this.body = body;
        this.problem = problem;
    }

    public int getStatus() {
        return status;
    }

    public String getBody() {
        return body;
    }

    public PokeFolioApiProblem getProblem() {
        return problem;
    }

    public boolean isSucceeded() {
        return status >= 200 && status < 300;
    }
}
