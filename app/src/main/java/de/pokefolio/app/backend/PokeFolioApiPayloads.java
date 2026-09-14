package de.pokefolio.app.backend;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

final class PokeFolioApiPayloads {
    private static final UUID EMPTY_UUID = new UUID(0L, 0L);
    private static final Set<String> SESSION_PROPERTIES = Collections.unmodifiableSet(
            new HashSet<>(Arrays.asList(
                    "userId", "accessToken", "refreshToken", "accessTokenExpiresAt", "device")));
    private static final Set<String> DEVICE_PROPERTIES = Collections.unmodifiableSet(
            new HashSet<>(Arrays.asList(
                    "id", "name", "platform", "createdAt", "lastSeenAt", "current")));

    private PokeFolioApiPayloads() {
    }

    static byte[] serializeLogin(String email, String password, String deviceName) {
        validateLoginInput(email, password, deviceName);
        try {
            JSONObject json = new JSONObject();
            json.put("email", email);
            json.put("password", password);
            json.put("deviceName", deviceName);
            json.put("platform", "android");
            return json.toString().getBytes(StandardCharsets.UTF_8);
        } catch (JSONException error) {
            throw new IllegalArgumentException("Account request cannot be serialized.", error);
        }
    }

    static byte[] serializeRefresh(String refreshToken) {
        if (refreshToken == null || refreshToken.length() < 32 || refreshToken.length() > 1024) {
            throw new IllegalArgumentException("Refresh token has an invalid length.");
        }
        try {
            return new JSONObject()
                    .put("refreshToken", refreshToken)
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
        } catch (JSONException error) {
            throw new IllegalArgumentException("Refresh request cannot be serialized.", error);
        }
    }

    static AuthEnvelope parseSession(byte[] body) throws IOException {
        String json = decodeUtf8(body);
        StrictJsonValidator.validateObject(json);
        try {
            JSONObject root = new JSONObject(json);
            requireExactProperties(root, SESSION_PROPERTIES, "authentication response");
            UUID userId = requiredUuid(root, "userId");
            String accessToken = requiredString(root, "accessToken", 32, 16_384);
            String refreshToken = requiredString(root, "refreshToken", 32, 1024);
            Instant accessTokenExpiresAt = requiredInstant(root, "accessTokenExpiresAt");
            Object rawDevice = root.opt("device");
            if (!(rawDevice instanceof JSONObject)) {
                throw new IOException("Authentication response device must be an object.");
            }
            JSONObject device = (JSONObject) rawDevice;
            requireExactProperties(device, DEVICE_PROPERTIES, "authentication device");
            UUID deviceId = requiredUuid(device, "id");
            String deviceName = requiredString(device, "name", 1, 120);
            String platform = requiredString(device, "platform", 1, 32);
            if (!"android".equals(platform)) {
                throw new IOException("Authentication response belongs to another platform.");
            }
            Instant createdAt = requiredInstant(device, "createdAt");
            Instant lastSeenAt = requiredInstant(device, "lastSeenAt");
            if (!(device.opt("current") instanceof Boolean)
                    || !device.optBoolean("current", false)) {
                throw new IOException("Authentication response device is not current.");
            }
            return new AuthEnvelope(
                    userId,
                    accessToken,
                    refreshToken,
                    accessTokenExpiresAt,
                    new DeviceEnvelope(deviceId, deviceName, platform, createdAt, lastSeenAt));
        } catch (JSONException error) {
            throw new IOException("Authentication response is invalid JSON.", error);
        }
    }

    static PokeFolioApiProblem parseProblem(int status, byte[] body) {
        String fallbackCode = status == 401 ? "authentication_required" : "api_request_failed";
        String fallbackTitle = "Backend request failed with HTTP " + status + ".";
        if (body == null || body.length == 0) {
            return new PokeFolioApiProblem(status, fallbackCode, fallbackTitle, null);
        }
        try {
            String json = decodeUtf8(body);
            StrictJsonValidator.validateObject(json);
            JSONObject root = new JSONObject(json);
            String code = optionalString(root, "code", 1, 120, fallbackCode);
            String title = optionalString(root, "title", 1, 500, fallbackTitle);
            Map<String, List<String>> errors = parseErrors(root.opt("errors"));
            return new PokeFolioApiProblem(status, code, title, errors);
        } catch (Exception ignored) {
            return new PokeFolioApiProblem(status, fallbackCode, fallbackTitle, null);
        }
    }

    static String decodeUtf8(byte[] body) throws IOException {
        if (body == null) return "";
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(body))
                    .toString();
        } catch (CharacterCodingException error) {
            throw new IOException("Backend response is not valid UTF-8.", error);
        }
    }

    private static Map<String, List<String>> parseErrors(Object raw) throws JSONException {
        if (!(raw instanceof JSONObject)) return null;
        JSONObject value = (JSONObject) raw;
        Map<String, List<String>> errors = new LinkedHashMap<>();
        Iterator<String> properties = value.keys();
        while (properties.hasNext()) {
            String property = properties.next();
            Object rawMessages = value.opt(property);
            if (!(rawMessages instanceof JSONArray) || property.length() > 120) continue;
            JSONArray messages = (JSONArray) rawMessages;
            if (messages.length() > 50) continue;
            List<String> accepted = new ArrayList<>();
            for (int index = 0; index < messages.length(); index++) {
                Object message = messages.opt(index);
                if (message instanceof String && !((String) message).trim().isEmpty()
                        && ((String) message).length() <= 500) {
                    accepted.add((String) message);
                }
            }
            if (!accepted.isEmpty()) errors.put(property, Collections.unmodifiableList(accepted));
        }
        return errors.isEmpty() ? null : errors;
    }

    private static void requireExactProperties(
            JSONObject value,
            Set<String> expected,
            String label
    ) throws IOException {
        Set<String> actual = new HashSet<>();
        Iterator<String> properties = value.keys();
        while (properties.hasNext()) actual.add(properties.next());
        if (!actual.equals(expected)) {
            throw new IOException(label + " does not match the API contract.");
        }
    }

    private static UUID requiredUuid(JSONObject value, String property) throws IOException {
        String text = requiredString(value, property, 36, 36);
        try {
            UUID id = UUID.fromString(text);
            if (EMPTY_UUID.equals(id) || !id.toString().equalsIgnoreCase(text)) {
                throw new IllegalArgumentException("UUID is not canonical.");
            }
            return id;
        } catch (IllegalArgumentException error) {
            throw new IOException(property + " must be a non-empty canonical UUID.", error);
        }
    }

    private static Instant requiredInstant(JSONObject value, String property) throws IOException {
        String text = requiredString(value, property, 1, 80);
        try {
            return OffsetDateTime.parse(text).toInstant();
        } catch (DateTimeParseException error) {
            throw new IOException(property + " must be an ISO timestamp.", error);
        }
    }

    private static String requiredString(
            JSONObject value,
            String property,
            int minimum,
            int maximum
    ) throws IOException {
        Object raw = value.opt(property);
        if (!(raw instanceof String)) throw new IOException(property + " must be text.");
        String text = (String) raw;
        if (text.length() < minimum || text.length() > maximum || text.trim().isEmpty()) {
            throw new IOException(property + " has an invalid length.");
        }
        return text;
    }

    private static String optionalString(
            JSONObject value,
            String property,
            int minimum,
            int maximum,
            String fallback
    ) {
        Object raw = value.opt(property);
        if (!(raw instanceof String)) return fallback;
        String text = (String) raw;
        return text.length() >= minimum && text.length() <= maximum && !text.trim().isEmpty()
                ? text : fallback;
    }

    private static void validateLoginInput(String email, String password, String deviceName) {
        if (email == null || email.trim().isEmpty() || email.length() > 254) {
            throw new IllegalArgumentException("Email must contain 1 to 254 characters.");
        }
        if (password == null || password.isEmpty() || password.length() > 128) {
            throw new IllegalArgumentException("Password must contain 1 to 128 characters.");
        }
        if (deviceName == null || deviceName.trim().isEmpty() || deviceName.trim().length() > 120) {
            throw new IllegalArgumentException("Device name must contain 1 to 120 characters.");
        }
    }

    static final class AuthEnvelope {
        final UUID userId;
        final String accessToken;
        final String refreshToken;
        final Instant accessTokenExpiresAt;
        final DeviceEnvelope device;

        AuthEnvelope(
                UUID userId,
                String accessToken,
                String refreshToken,
                Instant accessTokenExpiresAt,
                DeviceEnvelope device
        ) {
            this.userId = userId;
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.accessTokenExpiresAt = accessTokenExpiresAt;
            this.device = device;
        }
    }

    static final class DeviceEnvelope {
        final UUID id;
        final String name;
        final String platform;
        final Instant createdAt;
        final Instant lastSeenAt;

        DeviceEnvelope(
                UUID id,
                String name,
                String platform,
                Instant createdAt,
                Instant lastSeenAt
        ) {
            this.id = id;
            this.name = name;
            this.platform = platform;
            this.createdAt = createdAt;
            this.lastSeenAt = lastSeenAt;
        }
    }
}
