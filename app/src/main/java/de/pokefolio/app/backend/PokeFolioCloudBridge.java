package de.pokefolio.app.backend;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.Closeable;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/** Bounded token-free bridge for authenticated catalog and sync operations. */
public final class PokeFolioCloudBridge implements Closeable {
    public interface Callback {
        void send(String function, JSONObject payload);
    }

    private interface CloudAction {
        PokeFolioApiResponse run() throws IOException;
    }

    private static final String CATALOG_CALLBACK = "onPokeCatalogResult";
    private static final String SYNC_CALLBACK = "onPokeSyncResult";
    private static final Pattern REQUEST_ID = Pattern.compile("[A-Za-z0-9._:-]{1,128}");
    private static final int MAXIMUM_PENDING_ACTIONS = 12;
    private static final UUID EMPTY_UUID = new UUID(0L, 0L);
    private static final Set<String> RESOLUTION_PROPERTIES = immutableSet(
            "card", "created", "metadataMatched");
    private static final Set<String> CARD_PROPERTIES = immutableSet(
            "id", "provider", "providerCardId", "tcg", "name", "setCode", "number",
            "createdAt", "updatedAt");
    private static final Set<String> PUSH_PROPERTIES = immutableSet("results");
    private static final Set<String> PULL_PROPERTIES = immutableSet(
            "changes", "nextCursor", "hasMore");
    private static final Map<String, String> PROVIDER_TCGS;

    static {
        Map<String, String> providers = new HashMap<>();
        providers.put("pokemon-tcg-api", "pokemon");
        providers.put("tcgdex", "pokemon");
        providers.put("ygoprodeck", "yugioh");
        providers.put("optcgapi", "onepiece");
        PROVIDER_TCGS = Collections.unmodifiableMap(providers);
    }

    private final PokeFolioCloudService cloud;
    private final Callback callback;
    private final ThreadPoolExecutor executor;
    private volatile boolean closed;

    public PokeFolioCloudBridge(PokeFolioCloudService cloud, Callback callback) {
        if (cloud == null || callback == null) {
            throw new IllegalArgumentException("Cloud bridge dependencies are required.");
        }
        this.cloud = cloud;
        this.callback = callback;
        AtomicInteger threadNumber = new AtomicInteger();
        ThreadFactory threads = runnable -> {
            Thread thread = new Thread(
                    runnable,
                    "pokefolio-cloud-" + threadNumber.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
        executor = new ThreadPoolExecutor(
                2,
                2,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(MAXIMUM_PENDING_ACTIONS),
                threads,
                new ThreadPoolExecutor.AbortPolicy());
    }

    public void resolveCatalogCard(String cardReferenceJson, String requestId) {
        UUID expectedUserId = authenticatedUserId();
        queueCatalog(
                "resolve",
                requestId,
                () -> cloud.resolveCatalogCard(cardReferenceJson, expectedUserId));
    }

    public void getCatalogCard(String cardId, String requestId) {
        UUID expectedUserId = authenticatedUserId();
        UUID parsedCardId = parseUuid(cardId, "Catalog card id");
        queueCatalog(
                "get",
                requestId,
                () -> cloud.getCatalogCard(parsedCardId, expectedUserId));
    }

    public void pushSyncOperations(String operationBatchJson, String requestId) {
        UUID expectedUserId = authenticatedUserId();
        queueSync(
                "push",
                requestId,
                () -> cloud.pushSyncOperations(operationBatchJson, expectedUserId));
    }

    public void pullSyncChanges(String cursor, int limit, String requestId) {
        UUID expectedUserId = authenticatedUserId();
        queueSync(
                "pull",
                requestId,
                () -> cloud.pullSyncChanges(emptyToNull(cursor), limit, expectedUserId));
    }

    private void queueCatalog(String operation, String requestId, CloudAction action) {
        queue(CATALOG_CALLBACK, operation, requireRequestId(requestId), action);
    }

    private void queueSync(String operation, String requestId, CloudAction action) {
        queue(SYNC_CALLBACK, operation, requireRequestId(requestId), action);
    }

    private void queue(
            String callbackFunction,
            String operation,
            String requestId,
            CloudAction action
    ) {
        if (closed) throw new IllegalStateException("PokeFolio cloud bridge is closed.");
        try {
            executor.execute(() -> run(callbackFunction, operation, requestId, action));
        } catch (RejectedExecutionException error) {
            sendFailure(
                    callbackFunction,
                    operation,
                    requestId,
                    "busy",
                    "Zu viele Cloud-Anfragen laufen gleichzeitig.");
        }
    }

    private void run(
            String callbackFunction,
            String operation,
            String requestId,
            CloudAction action
    ) {
        try {
            PokeFolioApiResponse response = action.run();
            JSONObject payload = baseResult(
                    requestId, operation, response.isSucceeded(), response.getStatus());
            payload.put("data", response.isSucceeded()
                    ? parseSuccessfulResponse(response.getBody(), callbackFunction, operation,
                    response.getStatus())
                    : JSONObject.NULL);
            payload.put("problem", problemPayload(response.getProblem()));
            send(callbackFunction, payload);
        } catch (Exception error) {
            sendFailure(
                    callbackFunction,
                    operation,
                    requestId,
                    errorType(error),
                    errorMessage(error, callbackFunction));
        }
    }

    private static JSONObject parseSuccessfulResponse(
            String body,
            String callbackFunction,
            String operation,
            int status
    ) throws IOException {
        try {
            StrictJsonValidator.validateObject(body);
            JSONObject root = new JSONObject(body);
            if (CATALOG_CALLBACK.equals(callbackFunction)) {
                validateCatalogResponse(root, operation, status);
            } else {
                validateSyncResponse(root, operation);
            }
            return root;
        } catch (Exception error) {
            throw new InvalidCloudResponseException("Cloud response violates its contract.", error);
        }
    }

    private static void validateCatalogResponse(
            JSONObject root,
            String operation,
            int status
    ) throws IOException, JSONException {
        if ("resolve".equals(operation)) {
            requireExactProperties(root, RESOLUTION_PROPERTIES, "catalog resolution");
            Object created = root.opt("created");
            Object metadataMatched = root.opt("metadataMatched");
            if (!(created instanceof Boolean) || !(metadataMatched instanceof Boolean)
                    || (status != 200 && status != 201)
                    || ((Boolean) created) != (status == 201)
                    || !(root.opt("card") instanceof JSONObject)) {
                throw new IOException("Catalog resolution violates the API contract.");
            }
            validateCard(root.getJSONObject("card"));
            return;
        }
        if (!"get".equals(operation) || status != 200) {
            throw new IOException("Catalog lookup returned an invalid status.");
        }
        validateCard(root);
    }

    private static void validateCard(JSONObject card) throws IOException {
        requireExactProperties(card, CARD_PROPERTIES, "catalog card");
        UUID cardId = parseUuid(requiredString(card, "id", 36), "Catalog card id");
        if (EMPTY_UUID.equals(cardId)) throw new IOException("Catalog card id is empty.");
        String provider = requiredString(card, "provider", 48);
        String providerCardId = requiredString(card, "providerCardId", 160);
        String tcg = requiredString(card, "tcg", 32);
        if (!tcg.equals(PROVIDER_TCGS.get(provider))
                || !providerCardId.equals(providerCardId.toLowerCase(java.util.Locale.ROOT))
                || !isProviderCardId(providerCardId)) {
            throw new IOException("Catalog card provider identity is invalid.");
        }
        requiredString(card, "name", 240);
        requiredString(card, "setCode", 64);
        requiredString(card, "number", 64);
        java.time.Instant created = requiredInstant(card, "createdAt");
        java.time.Instant updated = requiredInstant(card, "updatedAt");
        if (updated.isBefore(created)) {
            throw new IOException("Catalog card timestamps are invalid.");
        }
    }

    private static void validateSyncResponse(JSONObject root, String operation)
            throws IOException {
        if ("push".equals(operation)) {
            requireExactProperties(root, PUSH_PROPERTIES, "sync push response");
            Object results = root.opt("results");
            if (!(results instanceof JSONArray) || ((JSONArray) results).length() > 100) {
                throw new IOException("Sync push response violates the API contract.");
            }
            return;
        }
        if (!"pull".equals(operation)) {
            throw new IOException("Sync operation is unsupported.");
        }
        requireExactProperties(root, PULL_PROPERTIES, "sync pull response");
        Object changes = root.opt("changes");
        Object cursor = root.opt("nextCursor");
        Object hasMore = root.opt("hasMore");
        if (!(changes instanceof JSONArray) || ((JSONArray) changes).length() > 500
                || !(cursor instanceof String) || ((String) cursor).isEmpty()
                || ((String) cursor).length() > 2048
                || !(hasMore instanceof Boolean)) {
            throw new IOException("Sync pull response violates the API contract.");
        }
    }

    private void sendFailure(
            String callbackFunction,
            String operation,
            String requestId,
            String errorType,
            String errorMessage
    ) {
        try {
            JSONObject payload = baseResult(requestId, operation, false, 0);
            payload.put("data", JSONObject.NULL);
            payload.put("problem", JSONObject.NULL);
            payload.put("errorType", errorType);
            payload.put("error", errorMessage);
            send(callbackFunction, payload);
        } catch (JSONException ignored) {
            // Fixed keys and bounded inputs make serialization failure non-actionable.
        }
    }

    private void send(String callbackFunction, JSONObject payload) {
        if (!closed) callback.send(callbackFunction, payload);
    }

    private static JSONObject baseResult(
            String requestId,
            String operation,
            boolean succeeded,
            int status
    ) throws JSONException {
        return new JSONObject()
                .put("requestId", requestId)
                .put("operation", operation)
                .put("ok", succeeded)
                .put("status", status);
    }

    private static Object problemPayload(PokeFolioApiProblem problem) throws JSONException {
        if (problem == null) return JSONObject.NULL;
        JSONObject payload = new JSONObject()
                .put("status", problem.getStatus())
                .put("code", problem.getCode())
                .put("title", problem.getTitle());
        if (problem.getErrors() == null) return payload.put("errors", JSONObject.NULL);
        JSONObject errors = new JSONObject();
        for (Map.Entry<String, List<String>> entry : problem.getErrors().entrySet()) {
            JSONArray messages = new JSONArray();
            for (String message : entry.getValue()) messages.put(message);
            errors.put(entry.getKey(), messages);
        }
        return payload.put("errors", errors);
    }

    private static void requireExactProperties(
            JSONObject value,
            Set<String> expected,
            String label
    ) throws IOException {
        Set<String> actual = new HashSet<>();
        Iterator<String> keys = value.keys();
        while (keys.hasNext()) actual.add(keys.next());
        if (!actual.equals(expected)) {
            throw new IOException(label + " contains unexpected fields.");
        }
    }

    private static String requiredString(JSONObject value, String property, int maximum)
            throws IOException {
        Object raw = value.opt(property);
        if (!(raw instanceof String)) throw new IOException(property + " must be text.");
        String text = (String) raw;
        if (text.isEmpty() || text.length() > maximum || !text.equals(text.trim())
                || containsControlCharacter(text)) {
            throw new IOException(property + " is invalid.");
        }
        return text;
    }

    private static java.time.Instant requiredInstant(JSONObject value, String property)
            throws IOException {
        String text = requiredString(value, property, 80);
        try {
            return OffsetDateTime.parse(text).toInstant();
        } catch (DateTimeParseException error) {
            throw new IOException(property + " must be an ISO timestamp.", error);
        }
    }

    private static UUID parseUuid(String value, String label) {
        try {
            UUID id = UUID.fromString(value);
            if (EMPTY_UUID.equals(id) || !id.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException(label + " must be a non-empty canonical UUID.");
            }
            return id;
        } catch (RuntimeException error) {
            throw new IllegalArgumentException(
                    label + " must be a non-empty canonical UUID.", error);
        }
    }

    private static boolean isProviderCardId(String value) {
        if (value.isEmpty()) return false;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if ((character >= 'a' && character <= 'z')
                    || (character >= '0' && character <= '9')
                    || character == '-' || character == '_' || character == '.'
                    || character == ':' || character == '/') {
                continue;
            }
            return false;
        }
        return true;
    }

    private static boolean containsControlCharacter(String value) {
        for (int index = 0; index < value.length(); index++) {
            if (Character.isISOControl(value.charAt(index))) return true;
        }
        return false;
    }

    private static String emptyToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    private UUID authenticatedUserId() {
        PokeFolioAccountStatus status = cloud.getAccountStatus();
        PokeFolioSession session = status.getSession();
        if (!status.isAuthenticated() || session == null
                || session.getUserId() == null || EMPTY_UUID.equals(session.getUserId())) {
            throw new IllegalStateException(
                    "An authenticated account is required for cloud operations.");
        }
        return session.getUserId();
    }

    private static String requireRequestId(String value) {
        if (value == null || !REQUEST_ID.matcher(value).matches()) {
            throw new IllegalArgumentException("Cloud request id is invalid.");
        }
        return value;
    }

    private static String errorType(Exception error) {
        if (error instanceof IllegalArgumentException) return "validation";
        if (error instanceof InvalidCloudResponseException) return "invalid-response";
        if (error instanceof IOException) return "network-or-response";
        return "internal";
    }

    private static String errorMessage(Exception error, String callbackFunction) {
        if (error instanceof IllegalArgumentException) {
            return "Die Cloud-Anfrage ist ungültig.";
        }
        if (CATALOG_CALLBACK.equals(callbackFunction)) {
            return "Die Kataloganfrage ist fehlgeschlagen.";
        }
        return "Die Synchronisation ist fehlgeschlagen.";
    }

    private static Set<String> immutableSet(String... values) {
        return Collections.unmodifiableSet(new HashSet<>(Arrays.asList(values)));
    }

    private static final class InvalidCloudResponseException extends IOException {
        InvalidCloudResponseException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    @Override
    public synchronized void close() {
        if (closed) return;
        closed = true;
        executor.shutdownNow();
    }
}
