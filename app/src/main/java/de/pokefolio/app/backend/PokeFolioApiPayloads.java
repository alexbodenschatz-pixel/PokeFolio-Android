package de.pokefolio.app.backend;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
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
    private static final int MAXIMUM_CATALOG_REQUEST_BYTES = 16 * 1024;
    private static final int MAXIMUM_SYNC_REQUEST_BYTES = 1024 * 1024;
    private static final UUID EMPTY_UUID = new UUID(0L, 0L);
    private static final Map<String, String> CATALOG_PROVIDER_TCGS;
    private static final Set<String> CATALOG_REFERENCE_PROPERTIES = Collections.unmodifiableSet(
            new HashSet<>(Arrays.asList(
                    "provider", "providerCardId", "tcg", "name", "setCode", "number")));
    private static final Set<String> SESSION_PROPERTIES = Collections.unmodifiableSet(
            new HashSet<>(Arrays.asList(
                    "userId", "accessToken", "refreshToken", "accessTokenExpiresAt", "device")));
    private static final Set<String> DEVICE_PROPERTIES = Collections.unmodifiableSet(
            new HashSet<>(Arrays.asList(
                    "id", "name", "platform", "createdAt", "lastSeenAt", "current")));

    static {
        Map<String, String> providers = new LinkedHashMap<>();
        providers.put("pokemon-tcg-api", "pokemon");
        providers.put("tcgdex", "pokemon");
        providers.put("ygoprodeck", "yugioh");
        providers.put("optcgapi", "onepiece");
        CATALOG_PROVIDER_TCGS = Collections.unmodifiableMap(providers);
    }

    private PokeFolioApiPayloads() {
    }

    static byte[] serializeLogin(String email, String password, String deviceName) {
        validateLoginInput(email, password, deviceName);
        try {
            JSONObject json = new JSONObject();
            json.put("email", email.trim());
            json.put("password", password);
            json.put("deviceName", deviceName.trim());
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

    static byte[] serializePasswordResetRequest(String email) {
        validateEmail(email);
        try {
            return new JSONObject()
                    .put("email", email.trim())
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
        } catch (JSONException error) {
            throw new IllegalArgumentException(
                    "Password reset request cannot be serialized.", error);
        }
    }

    static byte[] serializePasswordChange(String currentPassword, String newPassword) {
        validatePassword(currentPassword, 1, "Current password");
        validatePassword(newPassword, 12, "New password");
        if (currentPassword.equals(newPassword)) {
            throw new IllegalArgumentException(
                    "New password must differ from the current password.");
        }
        try {
            return new JSONObject()
                    .put("currentPassword", currentPassword)
                    .put("newPassword", newPassword)
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
        } catch (JSONException error) {
            throw new IllegalArgumentException(
                    "Password change request cannot be serialized.", error);
        }
    }

    static byte[] serializePasswordResetConfirm(
            String email,
            String token,
            String newPassword
    ) {
        validateEmail(email);
        if (token == null || token.length() < 32 || token.length() > 512) {
            throw new IllegalArgumentException(
                    "Password reset token must contain 32 to 512 characters.");
        }
        if (newPassword == null || newPassword.length() < 12 || newPassword.length() > 128) {
            throw new IllegalArgumentException(
                    "New password must contain 12 to 128 characters.");
        }
        try {
            return new JSONObject()
                    .put("email", email.trim())
                    .put("token", token)
                    .put("newPassword", newPassword)
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
        } catch (JSONException error) {
            throw new IllegalArgumentException(
                    "Password reset confirmation cannot be serialized.", error);
        }
    }

    static byte[] normalizeCatalogCardReference(String json) {
        byte[] input = encodeRequest(json, MAXIMUM_CATALOG_REQUEST_BYTES, "Catalog card reference");
        try {
            StrictJsonValidator.validateObject(json);
            JSONObject root = new JSONObject(json);
            requireExactProperties(root, CATALOG_REFERENCE_PROPERTIES, "catalog card reference");
            String provider = requiredRequestString(root, "provider").trim().toLowerCase(java.util.Locale.ROOT);
            String providerCardId = requiredRequestString(root, "providerCardId")
                    .trim()
                    .toLowerCase(java.util.Locale.ROOT);
            String tcg = requiredRequestString(root, "tcg").trim().toLowerCase(java.util.Locale.ROOT);
            String name = normalizeCatalogText(root, "name", 240);
            String setCode = normalizeCatalogText(root, "setCode", 64);
            String number = normalizeCatalogText(root, "number", 64);
            String expectedTcg = CATALOG_PROVIDER_TCGS.get(provider);
            if (expectedTcg == null) {
                throw new IllegalArgumentException("Catalog provider is not supported.");
            }
            if (!expectedTcg.equals(tcg)) {
                throw new IllegalArgumentException("Catalog provider does not match the selected TCG.");
            }
            if (providerCardId.length() < 1 || providerCardId.length() > 160
                    || !isProviderCardId(providerCardId)) {
                throw new IllegalArgumentException("Provider card id contains invalid characters.");
            }
            JSONObject normalized = new JSONObject();
            normalized.put("provider", provider);
            normalized.put("providerCardId", providerCardId);
            normalized.put("tcg", tcg);
            normalized.put("name", name);
            normalized.put("setCode", setCode);
            normalized.put("number", number);
            return normalized.toString().getBytes(StandardCharsets.UTF_8);
        } catch (IOException | JSONException error) {
            throw new IllegalArgumentException("Catalog card reference must be valid contract JSON.", error);
        } finally {
            Arrays.fill(input, (byte) 0);
        }
    }

    static byte[] validateSyncOperationBatch(String json) {
        byte[] body = encodeRequest(json, MAXIMUM_SYNC_REQUEST_BYTES, "Sync operation batch");
        try {
            StrictJsonValidator.validateObject(json);
            return body;
        } catch (IOException error) {
            Arrays.fill(body, (byte) 0);
            throw new IllegalArgumentException(
                    "Sync operation batch must be one JSON object without duplicate properties.",
                    error);
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

    static JSONArray parseDeviceList(String json, UUID expectedCurrentDeviceId)
            throws IOException {
        if (expectedCurrentDeviceId == null || EMPTY_UUID.equals(expectedCurrentDeviceId)) {
            throw new IOException("Current device id is missing.");
        }
        StrictJsonValidator.validateArray(json);
        try {
            JSONArray input = new JSONArray(json);
            if (input.length() > 1000) {
                throw new IOException("Device response contains too many entries.");
            }
            JSONArray normalized = new JSONArray();
            int currentCount = 0;
            for (int index = 0; index < input.length(); index++) {
                Object raw = input.opt(index);
                if (!(raw instanceof JSONObject)) {
                    throw new IOException("Device response entries must be objects.");
                }
                JSONObject device = (JSONObject) raw;
                requireExactProperties(device, DEVICE_PROPERTIES, "device response");
                UUID id = requiredUuid(device, "id");
                String name = requiredString(device, "name", 1, 120);
                String platform = requiredString(device, "platform", 1, 32);
                Instant createdAt = requiredInstant(device, "createdAt");
                Instant lastSeenAt = requiredInstant(device, "lastSeenAt");
                Object rawCurrent = device.opt("current");
                if (!(rawCurrent instanceof Boolean)) {
                    throw new IOException("current must be a boolean.");
                }
                boolean current = (Boolean) rawCurrent;
                if (current) {
                    currentCount++;
                    if (!expectedCurrentDeviceId.equals(id)) {
                        throw new IOException("Device response marks another session as current.");
                    }
                } else if (expectedCurrentDeviceId.equals(id)) {
                    throw new IOException("Current device is not marked as current.");
                }
                normalized.put(new JSONObject()
                        .put("id", id.toString())
                        .put("name", name)
                        .put("platform", platform)
                        .put("createdAt", createdAt.toString())
                        .put("lastSeenAt", lastSeenAt.toString())
                        .put("current", current));
            }
            if (currentCount != 1) {
                throw new IOException("Device response must contain the current session once.");
            }
            return normalized;
        } catch (JSONException error) {
            throw new IOException("Device response is invalid JSON.", error);
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

    private static byte[] encodeRequest(String value, int maximumBytes, String label) {
        if (value == null) throw new IllegalArgumentException(label + " is required.");
        try {
            ByteBuffer encoded = StandardCharsets.UTF_8.newEncoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .encode(CharBuffer.wrap(value));
            int size = encoded.remaining();
            if (size < 2 || size > maximumBytes) {
                throw new IllegalArgumentException(label + " has an invalid size.");
            }
            byte[] result = new byte[size];
            encoded.get(result);
            return result;
        } catch (CharacterCodingException error) {
            throw new IllegalArgumentException(label + " is not valid Unicode.", error);
        }
    }

    private static String requiredRequestString(JSONObject value, String property)
            throws JSONException {
        Object raw = value.opt(property);
        if (!(raw instanceof String)) {
            throw new IllegalArgumentException("Catalog field " + property + " must be text.");
        }
        return (String) raw;
    }

    private static String normalizeCatalogText(
            JSONObject value,
            String property,
            int maximumLength
    ) throws JSONException {
        String normalized = requiredRequestString(value, property).trim();
        if (normalized.isEmpty() || normalized.length() > maximumLength
                || containsControlCharacter(normalized)) {
            throw new IllegalArgumentException("Catalog field " + property + " is invalid.");
        }
        return normalized;
    }

    private static boolean containsControlCharacter(String value) {
        for (int index = 0; index < value.length(); index++) {
            if (Character.isISOControl(value.charAt(index))) return true;
        }
        return false;
    }

    private static boolean isProviderCardId(String value) {
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
        validateEmail(email);
        if (password == null || password.isEmpty() || password.length() > 128) {
            throw new IllegalArgumentException("Password must contain 1 to 128 characters.");
        }
        if (deviceName == null || deviceName.trim().isEmpty() || deviceName.trim().length() > 120) {
            throw new IllegalArgumentException("Device name must contain 1 to 120 characters.");
        }
    }

    private static void validateEmail(String email) {
        if (email == null || email.trim().isEmpty() || email.trim().length() > 254) {
            throw new IllegalArgumentException("Email must contain 1 to 254 characters.");
        }
    }

    private static void validatePassword(
            String password,
            int minimumLength,
            String fieldName
    ) {
        if (password == null
                || password.length() < minimumLength
                || password.length() > 128) {
            throw new IllegalArgumentException(
                    fieldName + " must contain " + minimumLength + " to 128 characters.");
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
