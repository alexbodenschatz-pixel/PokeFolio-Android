package de.pokefolio.app.backend;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public final class PokeFolioHttpTransportTest {
    private LoopbackHttpServer server;
    private PokeFolioHttpTransport transport;

    @Before
    public void startServer() throws Exception {
        server = new LoopbackHttpServer();
        transport = new PokeFolioHttpTransport(java.net.URI.create(server.origin()));
    }

    @After
    public void stopServer() throws Exception {
        if (transport != null) transport.close();
        if (server != null) server.close();
    }

    @Test
    public void sendsBoundedJsonRequestWithBearerAndDoesNotFollowRedirects() throws Exception {
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        AtomicReference<byte[]> requestBody = new AtomicReference<>();
        AtomicInteger escapedRequestCount = new AtomicInteger();
        server.createContext("/api/v1/redirect", request -> {
            assertEquals("POST", request.method);
            authorization.set(request.headers.get("authorization"));
            contentType.set(request.headers.get("content-type"));
            requestBody.set(request.body);
            return Response.redirect("/outside", "{\"redirect\":true}");
        });
        server.createContext("/outside", request -> {
            escapedRequestCount.incrementAndGet();
            return Response.fixed(200, new byte[0]);
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
        server.createContext("/api/v1/declared", request ->
                Response.fixed(200, repeat('x', 32).getBytes(StandardCharsets.UTF_8)));
        server.createContext("/api/v1/chunked", request ->
                Response.chunked(200, repeat('y', 32).getBytes(StandardCharsets.UTF_8)));

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

    private static String repeat(char value, int count) {
        char[] result = new char[count];
        Arrays.fill(result, value);
        return new String(result);
    }

    private interface Handler {
        Response handle(Request request) throws IOException;
    }

    private static final class Request {
        final String method;
        final String path;
        final Map<String, String> headers;
        final byte[] body;

        Request(String method, String path, Map<String, String> headers, byte[] body) {
            this.method = method;
            this.path = path;
            this.headers = headers;
            this.body = body;
        }
    }

    private static final class Response {
        final int status;
        final Map<String, String> headers;
        final byte[] body;
        final boolean chunked;

        Response(int status, Map<String, String> headers, byte[] body, boolean chunked) {
            this.status = status;
            this.headers = headers;
            this.body = body;
            this.chunked = chunked;
        }

        static Response fixed(int status, byte[] body) {
            return new Response(status, new LinkedHashMap<>(), body, false);
        }

        static Response chunked(int status, byte[] body) {
            return new Response(status, new LinkedHashMap<>(), body, true);
        }

        static Response redirect(String location, String body) {
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Location", location);
            return new Response(
                    302,
                    headers,
                    body.getBytes(StandardCharsets.UTF_8),
                    false);
        }
    }

    /** Minimal HTTP/1.1 loopback fixture using only APIs present in Android's JVM test classpath. */
    private static final class LoopbackHttpServer implements Closeable {
        private static final int MAXIMUM_HEADER_LINE = 8 * 1024;
        private static final int MAXIMUM_REQUEST_BODY = 2 * 1024 * 1024;

        private final ServerSocket socket;
        private final Thread acceptThread;
        private final Map<String, Handler> handlers = new LinkedHashMap<>();
        private volatile boolean running = true;
        private volatile IOException failure;

        LoopbackHttpServer() throws IOException {
            socket = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            acceptThread = new Thread(this::acceptRequests, "pokefolio-http-test");
            acceptThread.setDaemon(true);
            acceptThread.start();
        }

        String origin() {
            return "http://127.0.0.1:" + socket.getLocalPort() + "/";
        }

        synchronized void createContext(String path, Handler handler) {
            handlers.put(path, handler);
        }

        private void acceptRequests() {
            while (running) {
                try (Socket connection = socket.accept()) {
                    connection.setSoTimeout(3_000);
                    handleConnection(connection);
                } catch (SocketException error) {
                    if (running) failure = error;
                } catch (IOException error) {
                    if (running) failure = error;
                }
            }
        }

        private void handleConnection(Socket connection) throws IOException {
            BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
            String requestLine = readLine(input);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ", 3);
            if (parts.length != 3) throw new IOException("Malformed test HTTP request line.");

            Map<String, String> headers = new LinkedHashMap<>();
            for (int count = 0; count < 100; count++) {
                String line = readLine(input);
                if (line == null) throw new EOFException("HTTP request headers ended early.");
                if (line.isEmpty()) break;
                int separator = line.indexOf(':');
                if (separator < 1) throw new IOException("Malformed test HTTP header.");
                headers.put(
                        line.substring(0, separator).trim().toLowerCase(Locale.ROOT),
                        line.substring(separator + 1).trim());
            }

            int contentLength = parseContentLength(headers.get("content-length"));
            byte[] body = readExactly(input, contentLength);
            Handler handler;
            synchronized (this) {
                handler = handlers.get(parts[1]);
            }
            Response response = handler == null
                    ? Response.fixed(404, new byte[0])
                    : handler.handle(new Request(parts[0], parts[1], headers, body));
            writeResponse(connection.getOutputStream(), response);
        }

        private static int parseContentLength(String value) throws IOException {
            if (value == null) return 0;
            try {
                int parsed = Integer.parseInt(value);
                if (parsed < 0 || parsed > MAXIMUM_REQUEST_BODY) {
                    throw new IOException("Test HTTP request body is too large.");
                }
                return parsed;
            } catch (NumberFormatException error) {
                throw new IOException("Invalid test HTTP content length.", error);
            }
        }

        private static byte[] readExactly(InputStream input, int length) throws IOException {
            byte[] body = new byte[length];
            int offset = 0;
            while (offset < length) {
                int read = input.read(body, offset, length - offset);
                if (read < 0) throw new EOFException("HTTP request body ended early.");
                offset += read;
            }
            return body;
        }

        private static String readLine(InputStream input) throws IOException {
            ByteArrayOutputStream line = new ByteArrayOutputStream();
            boolean carriageReturn = false;
            while (line.size() <= MAXIMUM_HEADER_LINE) {
                int next = input.read();
                if (next < 0) return line.size() == 0 ? null : invalidLine();
                if (carriageReturn) {
                    if (next != '\n') return invalidLine();
                    return new String(line.toByteArray(), StandardCharsets.ISO_8859_1);
                }
                if (next == '\r') carriageReturn = true;
                else line.write(next);
            }
            throw new IOException("Test HTTP header line is too long.");
        }

        private static String invalidLine() throws IOException {
            throw new IOException("Test HTTP line is not CRLF terminated.");
        }

        private static void writeResponse(OutputStream output, Response response) throws IOException {
            StringBuilder head = new StringBuilder()
                    .append("HTTP/1.1 ").append(response.status).append(' ')
                    .append(reason(response.status)).append("\r\n")
                    .append("Content-Type: application/json\r\n")
                    .append("Connection: close\r\n");
            for (Map.Entry<String, String> header : response.headers.entrySet()) {
                head.append(header.getKey()).append(": ").append(header.getValue()).append("\r\n");
            }
            if (response.chunked) head.append("Transfer-Encoding: chunked\r\n");
            else head.append("Content-Length: ").append(response.body.length).append("\r\n");
            head.append("\r\n");
            output.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (response.chunked) {
                output.write(Integer.toHexString(response.body.length)
                        .getBytes(StandardCharsets.ISO_8859_1));
                output.write("\r\n".getBytes(StandardCharsets.ISO_8859_1));
                output.write(response.body);
                output.write("\r\n0\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
            } else {
                output.write(response.body);
            }
            output.flush();
        }

        private static String reason(int status) {
            if (status == 200) return "OK";
            if (status == 302) return "Found";
            if (status == 404) return "Not Found";
            return "Error";
        }

        @Override
        public void close() throws IOException {
            running = false;
            socket.close();
            try {
                acceptThread.join(1_000);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted while stopping test HTTP server.", error);
            }
            if (acceptThread.isAlive()) {
                throw new IOException("Test HTTP server did not stop.");
            }
            if (failure != null) throw failure;
        }
    }
}
