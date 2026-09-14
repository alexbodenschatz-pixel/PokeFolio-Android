package de.pokefolio.app.backend;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public final class PokeFolioHttpTransportTest {
    private HttpServer server;
    private PokeFolioHttpTransport transport;

    @Before
    public void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        transport = new PokeFolioHttpTransport(java.net.URI.create(
                "http://127.0.0.1:" + server.getAddress().getPort() + "/"));
    }

    @After
    public void stopServer() {
        if (transport != null) transport.close();
        if (server != null) server.stop(0);
    }

    @Test
    public void sendsBoundedJsonRequestWithBearerAndDoesNotFollowRedirects() throws Exception {
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        AtomicReference<byte[]> requestBody = new AtomicReference<>();
        AtomicInteger escapedRequestCount = new AtomicInteger();
        server.createContext("/api/v1/redirect", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            requestBody.set(readAll(exchange));
            exchange.getResponseHeaders().set("Location", "/outside");
            send(exchange, 302, "{\"redirect\":true}".getBytes(StandardCharsets.UTF_8));
        });
        server.createContext("/outside", exchange -> {
            escapedRequestCount.incrementAndGet();
            send(exchange, 200, new byte[0]);
        });
        byte[] body = "{\"value\":1}".getBytes(StandardCharsets.UTF_8);
        String token = "access-" + repeat('a', 64);

        PokeFolioRawResponse response = transport.send(
                "POST", "/api/v1/redirect", body, token, 1024);

        assertEquals(302, response.status);
        assertEquals("Bearer " + token, authorization.get());
        assertEquals("application/json; charset=utf-8", contentType.get());
        assertArrayEquals(body, requestBody.get());
        assertEquals(0, escapedRequestCount.get());
    }

    @Test
    public void rejectsDeclaredAndStreamedResponsesAboveTheCallerLimit() {
        server.createContext("/api/v1/declared", exchange ->
                send(exchange, 200, repeat('x', 32).getBytes(StandardCharsets.UTF_8)));
        server.createContext("/api/v1/chunked", exchange -> {
            byte[] body = repeat('y', 32).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write(body);
            exchange.close();
        });

        assertThrows(IOException.class, () -> transport.send(
                "GET", "/api/v1/declared", null, null, 8));
        assertThrows(IOException.class, () -> transport.send(
                "GET", "/api/v1/chunked", null, null, 8));
    }

    @Test
    public void rejectsTraversalAndHeaderInjectionBeforeNetworkAccess() {
        String validToken = "access-" + repeat('a', 64);
        assertThrows(IllegalArgumentException.class, () -> transport.send(
                "GET", "/api/v1/../../outside", null, validToken, 1024));
        assertThrows(IllegalArgumentException.class, () -> transport.send(
                "GET", "/api/v1/%2e%2e/outside", null, validToken, 1024));
        assertThrows(IllegalArgumentException.class, () -> transport.send(
                "GET", "/api/v1/test", null, validToken + "\r\nX-Test: true", 1024));
    }

    @Test
    public void rejectsUnsupportedMethodsAndOversizedRequestsWithoutConnecting() {
        assertThrows(IllegalArgumentException.class, () -> transport.send(
                "PUT", "/api/v1/test", null, null, 1024));
        assertThrows(IllegalArgumentException.class, () -> transport.send(
                "POST", "/api/v1/test", new byte[1024 * 1024 + 1], null, 1024));
        assertThrows(IllegalArgumentException.class, () -> transport.send(
                "GET", "/api/v1/test", null, null, 0));
    }

    private static byte[] readAll(HttpExchange exchange) throws IOException {
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int read;
            while ((read = exchange.getRequestBody().read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static void send(HttpExchange exchange, int status, byte[] body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }

    private static String repeat(char value, int count) {
        char[] result = new char[count];
        java.util.Arrays.fill(result, value);
        return new String(result);
    }
}
