package de.pokefolio.app.backend;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class PokeFolioApiProblem {
    private final int status;
    private final String code;
    private final String title;
    private final Map<String, List<String>> errors;

    PokeFolioApiProblem(
            int status,
            String code,
            String title,
            Map<String, List<String>> errors
    ) {
        this.status = status;
        this.code = code;
        this.title = title;
        if (errors == null) {
            this.errors = null;
        } else {
            Map<String, List<String>> copy = new LinkedHashMap<>();
            for (Map.Entry<String, List<String>> entry : errors.entrySet()) {
                List<String> messages = entry.getValue() == null
                        ? Collections.emptyList()
                        : Collections.unmodifiableList(new ArrayList<>(entry.getValue()));
                copy.put(entry.getKey(), messages);
            }
            this.errors = Collections.unmodifiableMap(copy);
        }
    }

    public int getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public String getTitle() {
        return title;
    }

    public Map<String, List<String>> getErrors() {
        return errors;
    }
}
