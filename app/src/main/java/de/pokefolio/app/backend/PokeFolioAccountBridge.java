package de.pokefolio.app.backend;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.Closeable;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/** Asynchronous, bounded and token-free account boundary for the packaged Android WebView. */
public final class PokeFolioAccountBridge implements Closeable {
    public interface Callback {
        void send(String function, JSONObject payload);
    }

    private interface AuthenticationAction {
        PokeFolioAuthenticationResult run() throws IOException;
    }

    private interface ApiAction {
        PokeFolioApiResponse run() throws IOException;
    }

    private static final String CALLBACK_FUNCTION = "onAndroidAccountResult";
    private static final Pattern REQUEST_ID = Pattern.compile("[A-Za-z0-9._:-]{1,128}");
    private static final int MAXIMUM_PENDING_ACTIONS = 8;

    private final PokeFolioCloudService cloud;
    private final Callback callback;
    private final ThreadPoolExecutor executor;
    private volatile boolean closed;

    public PokeFolioAccountBridge(PokeFolioCloudService cloud, Callback callback) {
        if (cloud == null || callback == null) {
            throw new IllegalArgumentException("Account bridge dependencies are required.");
        }
        this.cloud = cloud;
        this.callback = callback;
        AtomicInteger threadNumber = new AtomicInteger();
        ThreadFactory threads = runnable -> {
            Thread thread = new Thread(
                    runnable,
                    "pokefolio-account-" + threadNumber.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
        executor = new ThreadPoolExecutor(
                1,
                1,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(MAXIMUM_PENDING_ACTIONS),
                threads,
                new ThreadPoolExecutor.AbortPolicy());
    }

    public String getStatusJson() {
        if (closed) return closedStatus().toString();
        try {
            return statusPayload(cloud.getAccountStatus()).toString();
        } catch (Exception error) {
            return internalStatus().toString();
        }
    }

    public void register(
            String email,
            String password,
            String deviceName,
            String requestId
    ) {
        queueAuthentication(
                "register",
                requestId,
                () -> cloud.register(email, password, deviceName));
    }

    public void login(
            String email,
            String password,
            String deviceName,
            String requestId
    ) {
        queueAuthentication(
                "login",
                requestId,
                () -> cloud.login(email, password, deviceName));
    }

    public void restore(String requestId) {
        queueAuthentication("restore", requestId, cloud::restoreSession);
    }

    public void requestPasswordReset(String email, String requestId) {
        queueApi(
                "password-reset-request",
                requestId,
                () -> cloud.requestPasswordReset(email));
    }

    public void confirmPasswordReset(
            String email,
            String token,
            String newPassword,
            String requestId
    ) {
        queueApi(
                "password-reset-confirm",
                requestId,
                () -> cloud.confirmPasswordReset(email, token, newPassword));
    }

    public void logout(String requestId) {
        String safeRequestId = requireRequestId(requestId);
        queue(safeRequestId, "logout", () -> runLogout(safeRequestId));
    }

    private void queueAuthentication(
            String operation,
            String requestId,
            AuthenticationAction action
    ) {
        String safeRequestId = requireRequestId(requestId);
        queue(safeRequestId, operation, () ->
                runAuthentication(operation, safeRequestId, action));
    }

    private void queueApi(String operation, String requestId, ApiAction action) {
        String safeRequestId = requireRequestId(requestId);
        queue(safeRequestId, operation, () -> runApi(operation, safeRequestId, action));
    }

    private void queue(String requestId, String operation, Runnable action) {
        if (closed) throw new IllegalStateException("PokeFolio account bridge is closed.");
        try {
            executor.execute(action);
        } catch (RejectedExecutionException error) {
            sendFailure(
                    requestId,
                    operation,
                    "busy",
                    "Zu viele Kontoaktionen laufen gleichzeitig.");
        }
    }

    private void runAuthentication(
            String operation,
            String requestId,
            AuthenticationAction action
    ) {
        try {
            PokeFolioAuthenticationResult result = action.run();
            JSONObject payload = baseResult(requestId, operation, result.isSucceeded());
            payload.put("status", statusPayload(cloud.getAccountStatus()));
            payload.put("problem", problemPayload(result.getProblem()));
            send(payload);
        } catch (Exception error) {
            sendException(requestId, operation, error);
        }
    }

    private void runApi(String operation, String requestId, ApiAction action) {
        try {
            PokeFolioApiResponse result = action.run();
            JSONObject payload = baseResult(requestId, operation, result.isSucceeded());
            payload.put("status", statusPayload(cloud.getAccountStatus()));
            payload.put("problem", problemPayload(result.getProblem()));
            send(payload);
        } catch (Exception error) {
            sendException(requestId, operation, error);
        }
    }

    private void runLogout(String requestId) {
        try {
            PokeFolioLogoutResult result = cloud.logout();
            JSONObject payload = baseResult(requestId, "logout", result.getProblem() == null);
            payload.put("serverSessionRevoked", result.isServerSessionRevoked());
            payload.put("status", statusPayload(cloud.getAccountStatus()));
            payload.put("problem", problemPayload(result.getProblem()));
            send(payload);
        } catch (Exception error) {
            sendException(requestId, "logout", error);
        }
    }

    private void sendException(String requestId, String operation, Exception error) {
        String type;
        String message;
        if (error instanceof IllegalArgumentException) {
            type = "validation";
            message = "Kontodaten sind ungültig.";
        } else if (error instanceof IOException) {
            type = "network-or-response";
            message = "Das PokeFolio-Backend ist nicht erreichbar oder antwortet ungültig.";
        } else {
            type = "internal";
            message = "Die Kontoaktion ist fehlgeschlagen.";
        }
        try {
            JSONObject payload = baseResult(requestId, operation, false);
            payload.put("status", safeStatusPayload());
            payload.put("problem", JSONObject.NULL);
            payload.put("errorType", type);
            payload.put("error", message);
            send(payload);
        } catch (JSONException ignored) {
            sendFailure(requestId, operation, "internal", "Die Kontoaktion ist fehlgeschlagen.");
        }
    }

    private void sendFailure(
            String requestId,
            String operation,
            String errorType,
            String errorMessage
    ) {
        try {
            JSONObject payload = baseResult(requestId, operation, false);
            payload.put("status", safeStatusPayload());
            payload.put("problem", JSONObject.NULL);
            payload.put("errorType", errorType);
            payload.put("error", errorMessage);
            send(payload);
        } catch (JSONException ignored) {
            // Serialization uses fixed keys and bounded strings; there is no safe richer fallback.
        }
    }

    private JSONObject safeStatusPayload() {
        try {
            return statusPayload(cloud.getAccountStatus());
        } catch (Exception ignored) {
            return internalStatus();
        }
    }

    private void send(JSONObject payload) {
        if (!closed) callback.send(CALLBACK_FUNCTION, payload);
    }

    private static JSONObject baseResult(
            String requestId,
            String operation,
            boolean succeeded
    ) throws JSONException {
        return new JSONObject()
                .put("requestId", requestId)
                .put("operation", operation)
                .put("ok", succeeded);
    }

    private static JSONObject statusPayload(PokeFolioAccountStatus status) throws JSONException {
        JSONObject payload = new JSONObject()
                .put("configured", status.isConfigured())
                .put("authenticated", status.isAuthenticated())
                .put("backendOrigin", nullable(status.getBackendOrigin()))
                .put("configurationError", nullable(status.getConfigurationError()));
        PokeFolioSession session = status.getSession();
        if (session == null) return payload.put("session", JSONObject.NULL);
        PokeFolioDevice device = session.getDevice();
        JSONObject devicePayload = new JSONObject()
                .put("id", device.getId().toString())
                .put("name", device.getName())
                .put("platform", device.getPlatform())
                .put("createdAt", device.getCreatedAt().toString())
                .put("lastSeenAt", device.getLastSeenAt().toString());
        JSONObject sessionPayload = new JSONObject()
                .put("userId", session.getUserId().toString())
                .put("accessTokenExpiresAt", session.getAccessTokenExpiresAt().toString())
                .put("device", devicePayload);
        return payload.put("session", sessionPayload);
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

    private static Object nullable(String value) {
        return value == null ? JSONObject.NULL : value;
    }

    private static String requireRequestId(String value) {
        if (value == null || !REQUEST_ID.matcher(value).matches()) {
            throw new IllegalArgumentException("Account request id is invalid.");
        }
        return value;
    }

    private static JSONObject closedStatus() {
        try {
            return new JSONObject()
                    .put("configured", false)
                    .put("authenticated", false)
                    .put("backendOrigin", JSONObject.NULL)
                    .put("configurationError", "PokeFolio account bridge is closed.")
                    .put("session", JSONObject.NULL);
        } catch (JSONException impossible) {
            return new JSONObject();
        }
    }

    private static JSONObject internalStatus() {
        try {
            return new JSONObject()
                    .put("configured", false)
                    .put("authenticated", false)
                    .put("backendOrigin", JSONObject.NULL)
                    .put("configurationError", "PokeFolio account status is unavailable.")
                    .put("session", JSONObject.NULL);
        } catch (JSONException impossible) {
            return new JSONObject();
        }
    }

    @Override
    public synchronized void close() {
        if (closed) return;
        closed = true;
        executor.shutdownNow();
        // The process-scoped Application owns the cloud service. Activity recreation must not
        // create a second client that races the same rotating refresh credential.
    }
}
