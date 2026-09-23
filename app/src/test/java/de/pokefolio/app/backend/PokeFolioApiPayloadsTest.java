package de.pokefolio.app.backend;

import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public final class PokeFolioApiPayloadsTest {
    @Test
    public void loginPayloadUsesAndroidPlatformAndNormalizedIdentityInput() throws Exception {
        byte[] body = PokeFolioApiPayloads.serializeLogin(
                " owner@example.com ",
                "correct horse battery staple",
                " Pixel 9 ");
        JSONObject json = new JSONObject(new String(body, StandardCharsets.UTF_8));

        assertEquals(4, json.length());
        assertEquals("owner@example.com", json.getString("email"));
        assertEquals("correct horse battery staple", json.getString("password"));
        assertEquals("Pixel 9", json.getString("deviceName"));
        assertEquals("android", json.getString("platform"));
    }

    @Test
    public void passwordResetPayloadsContainOnlyTheValidatedContractFields() throws Exception {
        byte[] requestBody = PokeFolioApiPayloads.serializePasswordResetRequest(
                " owner@example.com ");
        JSONObject request = new JSONObject(new String(requestBody, StandardCharsets.UTF_8));
        assertEquals(1, request.length());
        assertEquals("owner@example.com", request.getString("email"));

        String token = "reset-" + "a".repeat(40);
        byte[] confirmBody = PokeFolioApiPayloads.serializePasswordResetConfirm(
                " owner@example.com ", token, "new secure password");
        JSONObject confirm = new JSONObject(new String(confirmBody, StandardCharsets.UTF_8));
        assertEquals(3, confirm.length());
        assertEquals("owner@example.com", confirm.getString("email"));
        assertEquals(token, confirm.getString("token"));
        assertEquals("new secure password", confirm.getString("newPassword"));

        assertThrows(IllegalArgumentException.class, () ->
                PokeFolioApiPayloads.serializePasswordResetRequest("   "));
        assertThrows(IllegalArgumentException.class, () ->
                PokeFolioApiPayloads.serializePasswordResetConfirm(
                        "owner@example.com", "short", "new secure password"));
        assertThrows(IllegalArgumentException.class, () ->
                PokeFolioApiPayloads.serializePasswordResetConfirm(
                        "owner@example.com", token, "too-short"));
    }

    @Test
    public void parsesOnlyExactCurrentAndroidSessionEnvelope() throws Exception {
        PokeFolioApiPayloads.AuthEnvelope envelope = PokeFolioApiPayloads.parseSession(
                sessionJson("android", DEVICE_ID, "access-token-0123456789abcdefghijklmnop",
                        "refresh-token-0123456789abcdefghijklmnop"));

        assertEquals(USER_ID, envelope.userId);
        assertEquals(DEVICE_ID, envelope.device.id);
        assertEquals("Pixel 9", envelope.device.name);

        assertThrows(IOException.class, () -> PokeFolioApiPayloads.parseSession(
                sessionJson("windows", DEVICE_ID, "access-token-0123456789abcdefghijklmnop",
                        "refresh-token-0123456789abcdefghijklmnop")));
        assertThrows(IOException.class, () -> PokeFolioApiPayloads.parseSession(
                (new String(sessionJson("android", DEVICE_ID,
                        "access-token-0123456789abcdefghijklmnop",
                        "refresh-token-0123456789abcdefghijklmnop"), StandardCharsets.UTF_8)
                        .replace("\"current\":true", "\"current\":false"))
                        .getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    public void rejectsDuplicateUnknownOrMalformedSensitiveFields() {
        String valid = new String(sessionJson(
                "android",
                DEVICE_ID,
                "access-token-0123456789abcdefghijklmnop",
                "refresh-token-0123456789abcdefghijklmnop"), StandardCharsets.UTF_8);
        assertThrows(IOException.class, () -> PokeFolioApiPayloads.parseSession(
                valid.replaceFirst("\\{", "{\"userId\":\"" + USER_ID + "\",")
                        .getBytes(StandardCharsets.UTF_8)));
        assertThrows(IOException.class, () -> PokeFolioApiPayloads.parseSession(
                (valid.substring(0, valid.length() - 1) + ",\"unexpected\":true}")
                        .getBytes(StandardCharsets.UTF_8)));
        assertThrows(IOException.class, () -> PokeFolioApiPayloads.parseSession(
                valid.replace(USER_ID.toString(), "not-a-uuid")
                        .getBytes(StandardCharsets.UTF_8)));
        assertThrows(IOException.class, () -> PokeFolioApiPayloads.parseSession(
                new byte[]{(byte) 0xc3, (byte) 0x28}));
    }

    @Test
    public void problemParsingIsBoundedToStructuredSafeFieldsAndFallsBack() {
        byte[] body = ("{\"status\":422,\"code\":\"validation_failed\","
                + "\"title\":\"Invalid request\",\"errors\":{\"email\":[\"Required\"]}}")
                .getBytes(StandardCharsets.UTF_8);
        PokeFolioApiProblem problem = PokeFolioApiPayloads.parseProblem(422, body);
        assertEquals("validation_failed", problem.getCode());
        assertEquals("Required", problem.getErrors().get("email").get(0));

        PokeFolioApiProblem duplicate = PokeFolioApiPayloads.parseProblem(
                401,
                "{\"code\":\"one\",\"code\":\"two\"}".getBytes(StandardCharsets.UTF_8));
        assertEquals("authentication_required", duplicate.getCode());
    }

    @Test
    public void catalogReferenceIsNormalizedAndStrictlyBounded() throws Exception {
        byte[] body = PokeFolioApiPayloads.normalizeCatalogCardReference(
                "{\"provider\":\" TCGDEX \",\"providerCardId\":\" SV8-141 \","
                        + "\"tcg\":\" POKEMON \",\"name\":\" Pikachu ex \","
                        + "\"setCode\":\" SV8 \",\"number\":\" 219/191 \"}");
        JSONObject normalized = new JSONObject(new String(body, StandardCharsets.UTF_8));

        assertEquals(6, normalized.length());
        assertEquals("tcgdex", normalized.getString("provider"));
        assertEquals("sv8-141", normalized.getString("providerCardId"));
        assertEquals("pokemon", normalized.getString("tcg"));
        assertEquals("Pikachu ex", normalized.getString("name"));
        assertThrows(IllegalArgumentException.class, () ->
                PokeFolioApiPayloads.normalizeCatalogCardReference(
                        "{\"provider\":\"ygoprodeck\",\"providerCardId\":\"lob-001\","
                                + "\"tcg\":\"pokemon\",\"name\":\"Card\","
                                + "\"setCode\":\"LOB\",\"number\":\"001\"}"));
        assertThrows(IllegalArgumentException.class, () ->
                PokeFolioApiPayloads.normalizeCatalogCardReference(
                        "{\"provider\":\"tcgdex\",\"provider\":\"tcgdex\","
                                + "\"providerCardId\":\"sv8-141\",\"tcg\":\"pokemon\","
                                + "\"name\":\"Pikachu\",\"setCode\":\"SV8\","
                                + "\"number\":\"141/191\"}"));
    }

    @Test
    public void syncBatchRequiresOneUtf8ObjectWithoutDuplicateProperties() {
        byte[] body = PokeFolioApiPayloads.validateSyncOperationBatch("{\"operations\":[]}");
        assertEquals("{\"operations\":[]}", new String(body, StandardCharsets.UTF_8));
        assertThrows(IllegalArgumentException.class, () ->
                PokeFolioApiPayloads.validateSyncOperationBatch("[]"));
        assertThrows(IllegalArgumentException.class, () ->
                PokeFolioApiPayloads.validateSyncOperationBatch(
                        "{\"operations\":[],\"operations\":[]}"));
        assertThrows(IllegalArgumentException.class, () ->
                PokeFolioApiPayloads.validateSyncOperationBatch("{\"value\":\"\ud800\"}"));
    }

    static final UUID USER_ID = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    static final UUID DEVICE_ID = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    static byte[] sessionJson(
            String platform,
            UUID deviceId,
            String accessToken,
            String refreshToken
    ) {
        String json = "{"
                + "\"userId\":\"" + USER_ID + "\","
                + "\"accessToken\":\"" + accessToken + "\","
                + "\"refreshToken\":\"" + refreshToken + "\","
                + "\"accessTokenExpiresAt\":\"2030-01-01T00:00:00Z\","
                + "\"device\":{"
                + "\"id\":\"" + deviceId + "\","
                + "\"name\":\"Pixel 9\","
                + "\"platform\":\"" + platform + "\","
                + "\"createdAt\":\"2026-09-13T00:00:00Z\","
                + "\"lastSeenAt\":\"2026-09-13T00:00:00Z\","
                + "\"current\":true}}";
        return json.getBytes(StandardCharsets.UTF_8);
    }
}
