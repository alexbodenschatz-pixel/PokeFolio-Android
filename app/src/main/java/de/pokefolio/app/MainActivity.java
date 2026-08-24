package de.pokefolio.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Hosts the local application UI and exposes narrow OCR/network bridges. */
public final class MainActivity extends Activity {
    private static final String TAG = "PokeFolio";
    private static final int FILE_CHOOSER = 1001;
    private static final int CAMERA_PERMISSION = 2001;
    private static final int MAX_BRIDGE_IMAGE_BYTES = 14_000_000;
    private static final int MAX_REFERENCE_IMAGE_BYTES = 8_000_000;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private ExecutorService bridgeExecutor;
    private ExecutorService networkExecutor;
    private ExecutorService comparisonExecutor;
    private final Set<String> allowedHosts = new HashSet<>(Arrays.asList(
            "api.pokemontcg.io",
            "api.tcgdex.net",
            "db.ygoprodeck.com",
            "optcgapi.com"
    ));
    private final Set<String> allowedImageHosts = new HashSet<>(Arrays.asList(
            "images.pokemontcg.io",
            "assets.tcgdex.net",
            "images.ygoprodeck.com",
            "optcgapi.com"
    ));

    @SuppressLint("SetJavaScriptEnabled") // Required by the bundled UI; navigation stays inside android_asset.
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        bridgeExecutor = Executors.newSingleThreadExecutor();
        networkExecutor = Executors.newFixedThreadPool(4);
        comparisonExecutor = Executors.newFixedThreadPool(3);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " PokeFolio/0.9.1");

        webView.addJavascriptInterface(new NativeBridge(), "PokeNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !("file".equalsIgnoreCase(uri.getScheme())
                        && uri.getPath() != null
                        && uri.getPath().startsWith("/android_asset/"));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
                        request.deny();
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
            ) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;

                Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
                gallery.addCategory(Intent.CATEGORY_OPENABLE);
                gallery.setType("image/*");

                Intent scanner = new Intent(MainActivity.this, CameraActivity.class);
                Intent chooser = Intent.createChooser(gallery, "Karte scannen oder Bild auswählen");
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{scanner});
                try {
                    startActivityForResult(chooser, FILE_CHOOSER);
                    return true;
                } catch (Exception error) {
                    Log.e(TAG, "Unable to open image chooser", error);
                    fileCallback = null;
                    return false;
                }
            }
        });

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
        }
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void sendJs(String function, JSONObject payload) {
        final String quoted = JSONObject.quote(payload.toString());
        webView.post(() -> webView.evaluateJavascript(
                "window." + function + " && window." + function + "(" + quoted + ");",
                null
        ));
    }

    public final class NativeBridge {
        @JavascriptInterface
        public void recognizeCard(String dataUrl, String requestId, String language) {
            bridgeExecutor.execute(() -> startCardRecognition(dataUrl, requestId, language));
        }

        /** Kept for compatibility with an older cached UI. */
        @JavascriptInterface
        public void recognizeText(String dataUrl, String requestId, String language) {
            recognizeCard(dataUrl, requestId, language);
        }

        @JavascriptInterface
        public void httpGet(String urlString, String requestId) {
            networkExecutor.execute(() -> performHttpGet(urlString, requestId));
        }

        @JavascriptInterface
        public void compareCardImage(String dataUrl, String imageUrl, String requestId) {
            comparisonExecutor.execute(() -> performVisualComparison(
                    dataUrl, imageUrl, requestId, false, false, "unprepared"
            ));
        }

        @JavascriptInterface
        public void prepareCardImage(String dataUrl, String requestId) {
            comparisonExecutor.execute(() -> performCardPreparation(dataUrl, requestId));
        }

        @JavascriptInterface
        public void comparePreparedCardImage(
                String dataUrl,
                String imageUrl,
                String requestId,
                boolean reliable,
                String method
        ) {
            comparisonExecutor.execute(() -> performVisualComparison(
                    dataUrl, imageUrl, requestId, true, reliable, method
            ));
        }
    }

    private void performCardPreparation(String dataUrl, String requestId) {
        JSONObject output = new JSONObject();
        Bitmap source = null;
        CardImageProcessor.VisualPreparation preparation = null;
        try {
            output.put("requestId", requestId);
            source = decodeDataUrlBitmap(dataUrl);
            preparation = CardImageProcessor.prepareForVisualComparisonDetailed(source, true);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(120_000);
            if (!preparation.bitmap.compress(Bitmap.CompressFormat.JPEG, 91, bytes)) {
                throw new IOException("Der Kartenausschnitt konnte nicht kodiert werden.");
            }
            output.put("ok", true);
            output.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(
                    bytes.toByteArray(), Base64.NO_WRAP
            ));
            output.put("reliable", preparation.reliable);
            output.put("method", preparation.method);
            output.put("width", preparation.bitmap.getWidth());
            output.put("height", preparation.bitmap.getHeight());
        } catch (Exception error) {
            Log.w(TAG, "Card preparation failed", error);
            try {
                output.put("requestId", requestId);
                output.put("ok", false);
                output.put("error", safeMessage(error, "Karte konnte nicht ausgeschnitten werden."));
            } catch (Exception ignored) {
                // Keep the response best-effort.
            }
        } finally {
            if (preparation != null && !preparation.bitmap.isRecycled()) preparation.bitmap.recycle();
            if (source != null && !source.isRecycled()) source.recycle();
        }
        sendJs("onNativePreparedCard", output);
    }

    private void performVisualComparison(
            String dataUrl,
            String imageUrl,
            String requestId,
            boolean prepared,
            boolean preparationReliable,
            String preparationMethod
    ) {
        JSONObject output = new JSONObject();
        Bitmap photographed = null;
        Bitmap reference = null;
        try {
            output.put("requestId", requestId);
            output.put("imageUrl", imageUrl);
            photographed = decodeDataUrlBitmap(dataUrl);
            reference = downloadReferenceBitmap(imageUrl);
            CardVisualMatcher.Result result = prepared
                    ? CardVisualMatcher.comparePrepared(
                            photographed,
                            reference,
                            preparationReliable,
                            preparationMethod
                    )
                    : CardVisualMatcher.compare(photographed, reference);
            output.put("ok", true);
            output.put("similarity", result.similarity);
            output.put("whole", result.whole);
            output.put("header", result.header);
            output.put("artwork", result.artwork);
            output.put("footer", result.footer);
            output.put("reliable", result.reliable);
            output.put("method", result.method);
        } catch (Exception error) {
            Log.w(TAG, "Visual card comparison failed for " + imageUrl, error);
            try {
                output.put("requestId", requestId);
                output.put("imageUrl", imageUrl);
                output.put("ok", false);
                output.put("error", safeMessage(error, "Bildvergleich fehlgeschlagen."));
            } catch (Exception ignored) {
                // Keep the response best-effort.
            }
        } finally {
            if (photographed != null && !photographed.isRecycled()) photographed.recycle();
            if (reference != null && !reference.isRecycled()) reference.recycle();
        }
        sendJs("onNativeVisualResult", output);
    }

    private Bitmap decodeDataUrlBitmap(String dataUrl) throws IOException {
        int comma = dataUrl.indexOf(',');
        String encoded = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
        byte[] bytes;
        try {
            bytes = Base64.decode(encoded, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new IOException("Das Scanbild ist ungültig.", error);
        }
        if (bytes.length == 0 || bytes.length > MAX_BRIDGE_IMAGE_BYTES) {
            throw new IOException("Das Scanbild ist für den Vergleich zu groß.");
        }
        Bitmap bitmap = decodeSampledBitmap(bytes, 2200);
        if (bitmap == null) throw new IOException("Das Scanbild konnte nicht dekodiert werden.");
        return bitmap;
    }

    private Bitmap downloadReferenceBitmap(String urlString) throws IOException {
        URL url = new URL(urlString);
        String host = url.getHost().toLowerCase(Locale.US);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !allowedImageHosts.contains(host)) {
            throw new SecurityException("Nicht erlaubte Kartenbildquelle.");
        }
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "image/avif,image/webp,image/*");
            connection.setRequestProperty("User-Agent", "PokeFolio/0.9.1 Android");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("Kartenbild HTTP " + status);
            }
            String contentType = connection.getContentType();
            if (contentType != null && !contentType.toLowerCase(Locale.US).startsWith("image/")) {
                throw new IOException("Die Kartenbildquelle lieferte kein Bild.");
            }
            int contentLength = connection.getContentLength();
            if (contentLength > MAX_REFERENCE_IMAGE_BYTES) {
                throw new IOException("Das Referenzbild ist zu groß.");
            }
            byte[] bytes;
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream(
                         contentLength > 0 ? Math.min(contentLength, MAX_REFERENCE_IMAGE_BYTES) : 64_000
                 )) {
                byte[] buffer = new byte[16_384];
                int count;
                int total = 0;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_REFERENCE_IMAGE_BYTES) {
                        throw new IOException("Das Referenzbild ist zu groß.");
                    }
                    output.write(buffer, 0, count);
                }
                bytes = output.toByteArray();
            }
            Bitmap bitmap = decodeSampledBitmap(bytes, 1600);
            if (bitmap == null) throw new IOException("Das Referenzbild konnte nicht dekodiert werden.");
            return bitmap;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Bitmap decodeSampledBitmap(byte[] bytes, int maxDimension) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > maxDimension) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    private void startCardRecognition(String dataUrl, String requestId, String language) {
        JSONObject output = new JSONObject();
        try {
            output.put("requestId", requestId);
            int comma = dataUrl.indexOf(',');
            String encoded = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > MAX_BRIDGE_IMAGE_BYTES) {
                throw new IllegalArgumentException("Das Bild ist für die Erkennung zu groß.");
            }

            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                throw new IllegalArgumentException("Das Bild konnte nicht gelesen werden.");
            }
            int sample = 1;
            while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > 2800) {
                sample *= 2;
            }
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            options.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (bitmap == null) {
                throw new IllegalArgumentException("Das Bild konnte nicht dekodiert werden.");
            }

            List<CardImageProcessor.OcrVariant> variants = CardImageProcessor.createOcrVariants(bitmap);
            bitmap.recycle();
            TextRecognizer recognizer = "ja".equals(language)
                    ? TextRecognition.getClient(new JapaneseTextRecognizerOptions.Builder().build())
                    : TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            recognizeVariant(
                    requestId,
                    output,
                    recognizer,
                    variants,
                    0,
                    new JSONArray(),
                    new LinkedHashSet<>()
            );
        } catch (Exception error) {
            Log.e(TAG, "OCR setup failed", error);
            try {
                output.put("requestId", requestId);
                output.put("ok", false);
                output.put("error", safeMessage(error, "Erkennung fehlgeschlagen."));
            } catch (Exception ignored) {
                // JSONObject only fails for unsupported values.
            }
            sendJs("onNativeOcrResult", output);
        }
    }

    private void recognizeVariant(
            String requestId,
            JSONObject output,
            TextRecognizer recognizer,
            List<CardImageProcessor.OcrVariant> variants,
            int index,
            JSONArray passes,
            LinkedHashSet<String> uniqueTexts
    ) {
        if (index >= variants.size()) {
            try {
                output.put("requestId", requestId);
                output.put("ok", !uniqueTexts.isEmpty());
                output.put("passes", passes);
                output.put("text", String.join("\n", uniqueTexts));
                if (uniqueTexts.isEmpty()) {
                    output.put("error", "Auf dem Bild wurde kein lesbarer Kartentext gefunden.");
                }
            } catch (Exception ignored) {
                // Keep the response best-effort.
            }
            recognizer.close();
            sendJs("onNativeOcrResult", output);
            return;
        }

        CardImageProcessor.OcrVariant variant = variants.get(index);
        InputImage image = InputImage.fromBitmap(variant.bitmap, 0);
        recognizer.process(image).addOnCompleteListener(bridgeExecutor, task -> {
            JSONObject pass = new JSONObject();
            try {
                pass.put("variant", variant.name);
                pass.put("width", variant.bitmap.getWidth());
                pass.put("height", variant.bitmap.getHeight());
                if (task.isSuccessful() && task.getResult() != null) {
                    Text text = task.getResult();
                    String value = text.getText().trim();
                    pass.put("text", value);
                    if (!value.isEmpty()) {
                        uniqueTexts.add(value);
                    }
                    JSONArray lines = new JSONArray();
                    for (Text.TextBlock block : text.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            JSONObject lineJson = new JSONObject();
                            lineJson.put("text", line.getText());
                            Rect bounds = line.getBoundingBox();
                            if (bounds != null) {
                                lineJson.put("x", bounds.left / (double) variant.bitmap.getWidth());
                                lineJson.put("y", bounds.top / (double) variant.bitmap.getHeight());
                                lineJson.put("w", bounds.width() / (double) variant.bitmap.getWidth());
                                lineJson.put("h", bounds.height() / (double) variant.bitmap.getHeight());
                            }
                            lines.put(lineJson);
                        }
                    }
                    pass.put("lines", lines);
                } else {
                    Exception error = task.getException();
                    pass.put("error", safeMessage(error, "OCR-Durchlauf fehlgeschlagen."));
                }
            } catch (Exception error) {
                Log.w(TAG, "Unable to serialize OCR pass", error);
            }
            passes.put(pass);
            variant.bitmap.recycle();
            recognizeVariant(requestId, output, recognizer, variants, index + 1, passes, uniqueTexts);
        });
    }

    private void performHttpGet(String urlString, String requestId) {
        JSONObject output = new JSONObject();
        HttpURLConnection connection = null;
        int status = 0;
        String responseBody = "";
        try {
            output.put("requestId", requestId);
            output.put("url", urlString);
            URL url = new URL(urlString);
            String host = url.getHost().toLowerCase(Locale.US);
            if (!"https".equalsIgnoreCase(url.getProtocol()) || !allowedHosts.contains(host)) {
                throw new SecurityException("Nicht erlaubte Datenquelle.");
            }
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(6500);
            connection.setReadTimeout(9500);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("User-Agent", "PokeFolio/0.9.1 Android");
            status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 400
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            StringBuilder body = new StringBuilder();
            if (stream != null) {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null && body.length() < 2_500_000) {
                        body.append(line);
                    }
                }
            }
            responseBody = body.toString();
            output.put("ok", status >= 200 && status < 300);
            output.put("status", status);
            output.put("body", responseBody);
            String retryAfter = connection.getHeaderField("Retry-After");
            if (retryAfter != null) {
                try {
                    output.put("retryAfterMs", Math.min(3000L, Long.parseLong(retryAfter.trim()) * 1000L));
                } catch (NumberFormatException ignored) {
                    // HTTP-date Retry-After values fall back to the short JavaScript backoff.
                }
            }
            if (status < 200 || status >= 300) {
                output.put("error", "HTTP " + status);
                logHttpFailure(urlString, status, responseBody, null);
            }
        } catch (Exception error) {
            logHttpFailure(urlString, status, responseBody, error);
            try {
                output.put("ok", false);
                output.put("url", urlString);
                output.put("status", status);
                output.put("body", responseBody);
                output.put("error", safeMessage(error, "Netzwerkanfrage fehlgeschlagen."));
            } catch (Exception ignored) {
                // Keep best-effort response.
            }
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
        sendJs("onNativeHttpResult", output);
    }

    private static void logHttpFailure(String url, int status, String body, Exception error) {
        String compactBody = body == null || body.trim().isEmpty()
                ? "<leer>"
                : body.replaceAll("\\s+", " ").trim();
        if (compactBody.length() > 6000) {
            compactBody = compactBody.substring(0, 6000) + "…";
        }
        String message = "HTTP request failed URL=" + url
                + " Status=" + status
                + " Body=" + compactBody;
        if (error == null) {
            Log.w(TAG, message);
        } else {
            Log.w(TAG, message, error);
        }
    }

    private static String safeMessage(Exception error, String fallback) {
        return error != null && error.getMessage() != null && !error.getMessage().isEmpty()
                ? error.getMessage()
                : fallback;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER || fileCallback == null) {
            return;
        }
        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if ((results == null || results.length == 0) && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(results);
        fileCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("PokeNative");
            webView.destroy();
        }
        if (bridgeExecutor != null) {
            bridgeExecutor.shutdown();
        }
        if (networkExecutor != null) {
            networkExecutor.shutdown();
        }
        if (comparisonExecutor != null) {
            comparisonExecutor.shutdown();
        }
        super.onDestroy();
    }
}
