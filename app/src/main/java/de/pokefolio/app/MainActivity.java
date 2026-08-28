package de.pokefolio.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.SocketTimeoutException;
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
import java.util.regex.Pattern;

/** Hosts the local application UI and exposes narrow OCR/network bridges. */
public final class MainActivity extends Activity {
    private static final String TAG = "PokeFolio";
    private static final String HTTP_TAG = "PokeFolioHttp";
    private static final int FILE_CHOOSER = 1001;
    private static final int BULK_SCANNER = 1002;
    private static final int CAMERA_PERMISSION = 2001;
    private static final int MAX_BRIDGE_IMAGE_BYTES = 14_000_000;
    private static final int MAX_REFERENCE_IMAGE_BYTES = 8_000_000;
    private static final Pattern POKEMON_NUMBER_PATTERN = Pattern.compile(
            "(?i)\\b(?:[A-Z]{0,4}[0-9OILSB|]{1,3})\\s*[/／]\\s*(?:[A-Z]{0,4}[0-9OILSB|]{1,3})\\b");
    private static final Pattern YUGIOH_PASSCODE_PATTERN = Pattern.compile("(?:^|\\D)(\\d{8})(?!\\d)");
    private static final Pattern YUGIOH_SET_PATTERN = Pattern.compile(
            "(?i)\\b[A-Z0-9]{2,8}-(?:(?:DE|EN|FR|EU|IT|PT|SP|GE|AE)[A-Z]?)?[A-Z]?\\d{2,4}\\b");
    private static final Pattern ONE_PIECE_CODE_PATTERN = Pattern.compile(
            "(?i)\\b(?:(?:OP|ST|EB|PRB|EX|DON)\\s*-?\\s*\\d{1,2}\\s*-\\s*\\d{3}|P\\s*-\\s*\\d{3})\\b");

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingFileCaptureMetadata = "";
    private String bulkScannerRequestId;
    private ExecutorService bridgeExecutor;
    private ExecutorService networkExecutor;
    private ExecutorService comparisonExecutor;
    private int webSafeTop;
    private int webSafeRight;
    private int webSafeBottom;
    private int webSafeLeft;
    private final Set<String> allowedHosts = new HashSet<>(Arrays.asList(
            "api.pokemontcg.io",
            "api.tcgdex.net",
            "db.ygoprodeck.com",
            "optcgapi.com"
    ));
    private final Set<String> allowedImageHosts = new HashSet<>(Arrays.asList(
            "images.pokemontcg.io",
            "images.scrydex.com",
            "assets.tcgdex.net",
            "images.ygoprodeck.com",
            "optcgapi.com"
    ));

    @SuppressLint("SetJavaScriptEnabled") // Required by the bundled UI; navigation stays inside android_asset.
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        bridgeExecutor = Executors.newSingleThreadExecutor();
        networkExecutor = Executors.newFixedThreadPool(4);
        comparisonExecutor = Executors.newFixedThreadPool(3);
        webView = new WebView(this);
        setContentView(webView);
        installWebViewSafeArea();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " PokeFolio/0.16.1");

        webView.addJavascriptInterface(new NativeBridge(), "PokeNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                applyWebViewSafeArea();
            }

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
            public boolean onConsoleMessage(ConsoleMessage message) {
                if (isDebugBuild() && message != null) {
                    Log.d("PokeFolioWeb", sanitizeLogText(message.message(), 1800));
                }
                return true;
            }

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
                synchronized (MainActivity.this) {
                    pendingFileCaptureMetadata = "";
                }

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

    /** Passes native system-bar/cutout insets to the bundled CSS in density-independent pixels. */
    private void installWebViewSafeArea() {
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets safe = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout()
            );
            Insets navigation = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            float density = Math.max(1f, getResources().getDisplayMetrics().density);
            webSafeTop = Math.round(safe.top / density);
            webSafeRight = Math.round(safe.right / density);
            webSafeBottom = Math.round(navigation.bottom / density);
            webSafeLeft = Math.round(safe.left / density);
            applyWebViewSafeArea();
            if (isDebugBuild()) {
                Log.d(TAG, "Web safe area cssTop=" + webSafeTop
                        + " cssBottom=" + webSafeBottom
                        + " cssLeft=" + webSafeLeft
                        + " cssRight=" + webSafeRight);
            }
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
    }

    private void applyWebViewSafeArea() {
        if (webView == null) return;
        String script = "(function(){var s=document.documentElement&&document.documentElement.style;"
                + "if(!s)return;"
                + "s.setProperty('--android-status-inset-top','" + webSafeTop + "px');"
                + "s.setProperty('--android-safe-inset-right','" + webSafeRight + "px');"
                + "s.setProperty('--android-nav-inset-bottom','" + webSafeBottom + "px');"
                + "s.setProperty('--android-safe-inset-left','" + webSafeLeft + "px');"
                + "})();";
        webView.post(() -> webView.evaluateJavascript(script, null));
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
            bridgeExecutor.execute(() -> startCardRecognition(dataUrl, requestId, language, "auto"));
        }

        /** New UI path: the manual TCG selection is authoritative during staged OCR. */
        @JavascriptInterface
        public void recognizeCardProfiled(
                String dataUrl, String requestId, String language, String profile
        ) {
            bridgeExecutor.execute(() -> startCardRecognition(dataUrl, requestId, language, profile));
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

        @JavascriptInterface
        public void openBulkScanner(String requestId) {
            runOnUiThread(() -> launchBulkScanner(requestId));
        }

        /** Consumed once by the file-input change handler to avoid rectifying a camera crop twice. */
        @JavascriptInterface
        public String consumeCaptureMetadata() {
            synchronized (MainActivity.this) {
                String metadata = pendingFileCaptureMetadata;
                pendingFileCaptureMetadata = "";
                return metadata;
            }
        }

        @JavascriptInterface
        public void vibrateBulkSuccess() {
            runOnUiThread(() -> {
                Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (vibrator != null && vibrator.hasVibrator()) {
                    vibrator.vibrate(VibrationEffect.createOneShot(
                            45L,
                            VibrationEffect.DEFAULT_AMPLITUDE
                    ));
                }
            });
        }
    }

    private void launchBulkScanner(String requestId) {
        JSONObject output = new JSONObject();
        try {
            if (requestId == null || requestId.trim().isEmpty()) {
                throw new IllegalArgumentException("Ungültige Scanner-Anfrage.");
            }
            if (bulkScannerRequestId != null) {
                throw new IllegalStateException("Der Scanner ist bereits geöffnet.");
            }
            bulkScannerRequestId = requestId;
            Intent scanner = new Intent(MainActivity.this, CameraActivity.class);
            scanner.putExtra(CameraActivity.EXTRA_BULK_MODE, true);
            startActivityForResult(scanner, BULK_SCANNER);
            if (isDebugBuild()) Log.d(TAG, "Bulk scanner opened requestId=" + sanitizeLogText(requestId, 80));
        } catch (Exception error) {
            bulkScannerRequestId = null;
            try {
                output.put("requestId", requestId);
                output.put("ok", false);
                output.put("error", safeMessage(error, "Der Bulk-Scanner konnte nicht geöffnet werden."));
            } catch (Exception ignored) {
                // Keep response best-effort.
            }
            sendJs("onNativeBulkScannerResult", output);
        }
    }

    private void performCardPreparation(String dataUrl, String requestId) {
        JSONObject output = new JSONObject();
        Bitmap source = null;
        CardImageProcessor.VisualPreparation preparation = null;
        try {
            output.put("requestId", requestId);
            source = decodeDataUrlBitmap(dataUrl);
            preparation = CardImageProcessor.prepareCapturedCardDetailed(source);
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
            output.put("confidence", preparation.confidence);
            output.put("cardCoverage", preparation.cardCoverage);
            output.put("fallbackUsed", preparation.fallbackUsed);
            output.put("detectedQuad", quadJson(preparation.detectedQuad));
            output.put("detectedAspectRatio", preparation.detectedAspectRatio);
            output.put("safetyMargin", preparation.safetyMargin);
            output.put("correctedRotationDegrees", preparation.correctedRotationDegrees);
            output.put("fourCornersDetected", preparation.fourCornersDetected);
            output.put("perspectiveCorrected", preparation.perspectiveCorrected);
            output.put("borderComplete", preparation.borderComplete);
            if (isDebugBuild()) {
                Log.d(TAG, "CARD_PREPARATION source=" + source.getWidth() + "x" + source.getHeight()
                        + " final=" + preparation.bitmap.getWidth() + "x" + preparation.bitmap.getHeight()
                        + " method=" + preparation.method
                        + " confidence=" + String.format(java.util.Locale.US, "%.3f", preparation.confidence)
                        + " coverage=" + String.format(java.util.Locale.US, "%.3f", preparation.cardCoverage)
                        + " aspect=" + String.format(java.util.Locale.US, "%.3f", preparation.detectedAspectRatio)
                        + " rotation=" + String.format(java.util.Locale.US, "%.2f", preparation.correctedRotationDegrees)
                        + " margin=" + String.format(java.util.Locale.US, "%.3f", preparation.safetyMargin)
                        + " fourCorners=" + preparation.fourCornersDetected
                        + " perspective=" + preparation.perspectiveCorrected
                        + " borderComplete=" + preparation.borderComplete
                        + " fallback=" + preparation.fallbackUsed
                        + " quad=" + quadJson(preparation.detectedQuad));
            }
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

    private org.json.JSONArray quadJson(android.graphics.PointF[] quad) {
        org.json.JSONArray points = new org.json.JSONArray();
        if (quad == null) return points;
        for (android.graphics.PointF point : quad) {
            org.json.JSONArray pair = new org.json.JSONArray();
            pair.put(Math.round(point.x));
            pair.put(Math.round(point.y));
            points.put(pair);
        }
        return points;
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
            output.put("text", result.text);
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
            connection.setRequestProperty("User-Agent", "PokeFolio/0.16.1 Android");
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

    private void startCardRecognition(
            String dataUrl, String requestId, String language, String requestedProfile
    ) {
        JSONObject output = new JSONObject();
        Bitmap bitmap = null;
        try {
            long recognitionStarted = System.nanoTime();
            output.put("requestId", requestId);
            String ocrLanguage = normalizeOcrLanguage(language);
            String profile = normalizeRecognitionProfile(requestedProfile);
            output.put("language", ocrLanguage);
            output.put("profile", profile);
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
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (bitmap == null) {
                throw new IllegalArgumentException("Das Bild konnte nicht dekodiert werden.");
            }

            List<CardImageProcessor.OcrVariant> orientationVariants =
                    CardImageProcessor.createOrientationOcrVariants(bitmap);
            TextRecognizer recognizer = createTextRecognizer(ocrLanguage);
            if (isDebugBuild()) {
                Log.d(TAG, "OCR_STAGE orientation language=" + ocrLanguage
                        + " profile=" + profile + " probes=" + orientationVariants.size());
            }
            recognizeOrientationVariant(
                    requestId, output, recognizer, bitmap, profile, orientationVariants, 0,
                    new JSONArray(), new OrientationSelection(), recognitionStarted,
                    System.nanoTime()
            );
            bitmap = null; // Ownership moved to the asynchronous orientation stage.
        } catch (Exception error) {
            Log.e(TAG, "OCR setup failed", error);
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
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

    private static String normalizeRecognitionProfile(String value) {
        String profile = String.valueOf(value == null ? "auto" : value)
                .trim().toLowerCase(Locale.ROOT);
        return "pokemon".equals(profile) || "yugioh".equals(profile) || "onepiece".equals(profile)
                ? profile : "auto";
    }

    private void recognizeOrientationVariant(
            String requestId,
            JSONObject output,
            TextRecognizer recognizer,
            Bitmap source,
            String profile,
            List<CardImageProcessor.OcrVariant> variants,
            int index,
            JSONArray probeDiagnostics,
            OrientationSelection selection,
            long recognitionStarted,
            long orientationStarted
    ) {
        if (index >= variants.size()) {
            float orientationMs = elapsedMs(orientationStarted);
            String effectiveProfile = "auto".equals(profile)
                    ? selection.detectedProfile
                    : profile;
            if ("auto".equals(effectiveProfile)) effectiveProfile = "pokemon";
            List<CardImageProcessor.OcrVariant> detailed =
                    CardImageProcessor.createProfileOcrVariants(
                            source, selection.rotation, effectiveProfile);
            source.recycle();
            try {
                output.put("orientation", selection.rotation);
                output.put("orientationScore", selection.score);
                output.put("detectedProfile", effectiveProfile);
                output.put("orientationProbes", probeDiagnostics);
                output.put("orientationMs", orientationMs);
            } catch (Exception ignored) {
                // Continue with best-effort diagnostics.
            }
            if (isDebugBuild()) {
                Log.d(TAG, String.format(Locale.US,
                        "OCR_STAGE orientation_complete rotation=%d score=%.2f ms=%.2f profile=%s detailed=%d",
                        selection.rotation, selection.score, orientationMs,
                        effectiveProfile, detailed.size()));
            }
            recognizeVariant(requestId, output, recognizer, detailed, 0, new JSONArray(),
                    new LinkedHashSet<>(), System.nanoTime(), recognitionStarted,
                    selection.rotation, orientationMs);
            return;
        }

        CardImageProcessor.OcrVariant variant = variants.get(index);
        InputImage image = InputImage.fromBitmap(variant.bitmap, 0);
        recognizer.process(image).addOnCompleteListener(bridgeExecutor, task -> {
            String textValue = "";
            float score = 0f;
            try {
                if (task.isSuccessful() && task.getResult() != null) {
                    Text text = task.getResult();
                    textValue = text.getText().trim();
                    score = orientationProbeScore(text, variant.bitmap.getWidth(),
                            variant.bitmap.getHeight(), profile);
                }
                int rotation = rotationFromVariant(variant.name);
                String detectedProfile = detectRecognitionProfile(textValue);
                selection.consider(rotation, score, detectedProfile);
                JSONObject probe = new JSONObject();
                probe.put("rotation", rotation);
                probe.put("score", score);
                probe.put("profile", detectedProfile);
                probe.put("textLength", textValue.length());
                probeDiagnostics.put(probe);
                if (isDebugBuild()) {
                    Log.d(TAG, String.format(Locale.US,
                            "OCR_ORIENTATION rotation=%d score=%.2f textLength=%d",
                            rotation, score, textValue.length()));
                }
            } catch (Exception error) {
                Log.w(TAG, "Unable to evaluate orientation probe", error);
            } finally {
                variant.bitmap.recycle();
            }
            recognizeOrientationVariant(requestId, output, recognizer, source, profile,
                    variants, index + 1, probeDiagnostics, selection, recognitionStarted,
                    orientationStarted);
        });
    }

    private static float orientationProbeScore(Text text, int width, int height, String profile) {
        float score = 0f;
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                String raw = line.getText();
                String upper = raw.toUpperCase(Locale.ROOT);
                Rect bounds = line.getBoundingBox();
                float y = bounds == null ? 0.5f : bounds.centerY() / (float) Math.max(1, height);
                boolean top = y <= 0.38f;
                boolean bottom = y >= 0.55f;
                if (POKEMON_NUMBER_PATTERN.matcher(upper).find()) score += bottom ? 8f : 1.2f;
                if (upper.matches(".*\\b(?:KP|HP)\\s*[0-9OIL|]{2,3}\\b.*")) score += top ? 4.5f : 0.4f;
                if (YUGIOH_PASSCODE_PATTERN.matcher(upper).find()) score += bottom ? 9f : 1f;
                if (YUGIOH_SET_PATTERN.matcher(upper).find()) score += bottom ? 7f : 1.2f;
                if (upper.matches(".*\\b(?:ATK|DEF)\\s*[:/]?\\s*\\d{1,5}\\b.*")) {
                    score += bottom ? 3.5f : 0.5f;
                }
                if (ONE_PIECE_CODE_PATTERN.matcher(upper).find()) score += bottom ? 9f : 1f;
                if (upper.matches(".*\\b(?:CHARACTER|LEADER|COUNTER|POWER|COST|DON!!)\\b.*")) {
                    score += bottom ? 2.4f : 0.5f;
                }
                if (upper.matches(".*(?:NINTENDO|CREATURES|GAME FREAK|KONAMI|BANDAI|©).*")) {
                    score += bottom ? 1.8f : -1.2f;
                }
                int letters = raw.replaceAll("[^\\p{L}]", "").length();
                score += Math.min(0.35f, letters / 120f);
            }
        }
        if ("pokemon".equals(profile) && score > 0f) score *= 1.04f;
        else if ("yugioh".equals(profile) && score > 0f) score *= 1.05f;
        else if ("onepiece".equals(profile) && score > 0f) score *= 1.05f;
        return score;
    }

    private static int rotationFromVariant(String value) {
        String name = String.valueOf(value);
        for (int rotation : new int[]{0, 90, 180, 270}) {
            if (name.endsWith("-" + rotation)) return rotation;
        }
        return 0;
    }

    private static String detectRecognitionProfile(String rawText) {
        String upper = String.valueOf(rawText == null ? "" : rawText)
                .toUpperCase(Locale.ROOT);
        int pokemon = 0;
        int yugioh = 0;
        int onePiece = 0;
        if (POKEMON_NUMBER_PATTERN.matcher(upper).find()) pokemon += 3;
        if (upper.matches("(?s).*\\b(?:KP|HP)\\s*[0-9OIL|]{2,3}\\b.*")) pokemon += 3;
        if (upper.matches("(?s).*(?:ENTWICKELT SICH AUS|BASIC|PHASE 1|STAGE 1).*")) pokemon += 1;
        if (YUGIOH_PASSCODE_PATTERN.matcher(upper).find()) yugioh += 7;
        if (YUGIOH_SET_PATTERN.matcher(upper).find()) yugioh += 5;
        if (upper.matches("(?s).*\\bATK\\s*[:/]?\\s*\\d{1,5}.*")) yugioh += 3;
        if (upper.matches("(?s).*\\bDEF\\s*[:/]?\\s*\\d{1,5}.*")) yugioh += 3;
        if (ONE_PIECE_CODE_PATTERN.matcher(upper).find()) onePiece += 8;
        if (upper.matches("(?s).*\\b(?:DON!!|COUNTER|CHARACTER|LEADER)\\b.*")) onePiece += 3;

        int best = Math.max(pokemon, Math.max(yugioh, onePiece));
        if (best <= 0) return "auto";
        if (onePiece == best) return "onepiece";
        if (yugioh == best) return "yugioh";
        return "pokemon";
    }

    private static float elapsedMs(long startedAt) {
        return (System.nanoTime() - startedAt) / 1_000_000f;
    }

    private static final class OrientationSelection {
        int rotation;
        float score = -Float.MAX_VALUE;
        String detectedProfile = "auto";

        void consider(int candidateRotation, float candidateScore, String candidateProfile) {
            if (candidateScore > score) {
                rotation = candidateRotation;
                score = candidateScore;
                detectedProfile = candidateProfile == null ? "auto" : candidateProfile;
            }
        }
    }

    private static String normalizeOcrLanguage(String language) {
        String value = String.valueOf(language == null ? "" : language)
                .trim()
                .toLowerCase(Locale.ROOT);
        if ("ja".equals(value) || "ko".equals(value)) return value;
        if (value.startsWith("zh")) return value.contains("tw") || value.contains("hant")
                ? "zh-TW"
                : "zh-CN";
        return "de".equals(value) ? "de" : "en";
    }

    private static TextRecognizer createTextRecognizer(String language) {
        if ("ja".equals(language)) {
            return TextRecognition.getClient(new JapaneseTextRecognizerOptions.Builder().build());
        }
        if ("ko".equals(language)) {
            return TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
        }
        if (language.startsWith("zh")) {
            return TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        }
        return TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    }

    private void recognizeVariant(
            String requestId,
            JSONObject output,
            TextRecognizer recognizer,
            List<CardImageProcessor.OcrVariant> variants,
            int index,
            JSONArray passes,
            LinkedHashSet<String> uniqueTexts,
            long detailedStarted,
            long recognitionStarted,
            int orientation,
            float orientationMs
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
                output.put("orientation", orientation);
                output.put("orientationMs", orientationMs);
                output.put("detailedOcrMs", elapsedMs(detailedStarted));
                output.put("totalOcrMs", elapsedMs(recognitionStarted));
            } catch (Exception ignored) {
                // Keep the response best-effort.
            }
            recognizer.close();
            if (isDebugBuild()) {
                Log.d(TAG, String.format(Locale.US,
                        "OCR_PERF OrientationMs=%.2f DetailedOcrMs=%.2f TotalOcrMs=%.2f rotation=%d passes=%d",
                        orientationMs, elapsedMs(detailedStarted), elapsedMs(recognitionStarted),
                        orientation, variants.size()));
            }
            sendJs("onNativeOcrResult", output);
            return;
        }

        CardImageProcessor.OcrVariant variant = variants.get(index);
        InputImage image = InputImage.fromBitmap(variant.bitmap, 0);
        recognizer.process(image).addOnCompleteListener(bridgeExecutor, task -> {
            JSONObject pass = new JSONObject();
            try {
                pass.put("variant", variant.name);
                pass.put("region", variant.region);
                pass.put("width", variant.bitmap.getWidth());
                pass.put("height", variant.bitmap.getHeight());
                if (task.isSuccessful() && task.getResult() != null) {
                    Text text = task.getResult();
                    String value = text.getText().trim();
                    pass.put("text", value);
                    if (!value.isEmpty()) {
                        uniqueTexts.add(value);
                        if (isDebugBuild()) {
                            String safeText = value.replace('\n', ' ').replace('\r', ' ').trim();
                            if (safeText.length() > 420) safeText = safeText.substring(0, 420) + "…";
                            Log.d(TAG, "OCR_PASS region=" + variant.region
                                    + " variant=" + variant.name + " text=" + safeText);
                        }
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
            recognizeVariant(requestId, output, recognizer, variants, index + 1, passes, uniqueTexts,
                    detailedStarted, recognitionStarted, orientation, orientationMs);
        });
    }

    private void performHttpGet(String urlString, String requestId) {
        JSONObject output = new JSONObject();
        HttpURLConnection connection = null;
        int status = 0;
        String responseBody = "";
        String errorType = "none";
        try {
            output.put("requestId", requestId);
            output.put("url", urlString);
            URL url = new URL(urlString);
            String host = url.getHost().toLowerCase(Locale.US);
            if (!"https".equalsIgnoreCase(url.getProtocol()) || !allowedHosts.contains(host)) {
                throw new SecurityException("Nicht erlaubte Datenquelle.");
            }
            connection = (HttpURLConnection) url.openConnection();
            // Keep the native deadline below the JavaScript bridge watchdog so
            // timeouts arrive with their real error type instead of as orphaned callbacks.
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(8000);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("User-Agent", "PokeFolio/0.16.1 Android");
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
                errorType = "http";
                output.put("errorType", errorType);
                output.put("error", "HTTP " + status);
                logHttpFailure(urlString, status, responseBody, errorType, null);
            } else if (isDebugBuild()) {
                Log.d(HTTP_TAG, "Art=success URL=" + sanitizeUrlForLog(urlString)
                        + " Status=" + status + " Bytes=" + responseBody.length());
            }
        } catch (Exception error) {
            errorType = classifyHttpError(error, status);
            logHttpFailure(urlString, status, responseBody, errorType, error);
            try {
                output.put("ok", false);
                output.put("url", urlString);
                output.put("status", status);
                output.put("body", responseBody);
                output.put("errorType", errorType);
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

    private void logHttpFailure(
            String url,
            int status,
            String body,
            String errorType,
            Exception error
    ) {
        if (!isDebugBuild()) {
            return;
        }
        String compactBody = body == null || body.trim().isEmpty()
                ? "<leer>"
                : sanitizeLogText(body.replaceAll("\\s+", " ").trim(), 2000);
        String message = "Art=" + errorType
                + " URL=" + sanitizeUrlForLog(url)
                + " Status=" + status
                + " Body=" + compactBody;
        if (error == null) {
            Log.w(HTTP_TAG, message);
        } else {
            Log.w(HTTP_TAG, message, error);
        }
    }

    private static String classifyHttpError(Exception error, int status) {
        if (status > 0) return "http";
        if (error instanceof SecurityException) return "allowlist";
        if (error instanceof SocketTimeoutException) return "timeout";
        if (error instanceof MalformedURLException || error instanceof IllegalArgumentException) return "request";
        if (error instanceof IOException) return "network";
        return "bridge";
    }

    private boolean isDebugBuild() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private static String sanitizeUrlForLog(String url) {
        return sanitizeLogText(url, 1800);
    }

    private static String sanitizeLogText(String value, int maximum) {
        String sanitized = String.valueOf(value == null ? "" : value)
                .replaceAll("(?i)(api[_-]?key|token|authorization)(=|:|%3[dD])([^&\\s]+)", "$1$2<redacted>");
        return sanitized.length() > maximum ? sanitized.substring(0, maximum) + "…" : sanitized;
    }

    private static String safeMessage(Exception error, String fallback) {
        return error != null && error.getMessage() != null && !error.getMessage().isEmpty()
                ? error.getMessage()
                : fallback;
    }

    private void deliverBulkScannerResult(int resultCode, Intent data) {
        final String requestId = bulkScannerRequestId;
        bulkScannerRequestId = null;
        if (requestId == null) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            JSONObject cancelled = new JSONObject();
            try {
                cancelled.put("requestId", requestId);
                cancelled.put("ok", false);
                cancelled.put("cancelled", true);
            } catch (Exception ignored) {
                // Keep response best-effort.
            }
            sendJs("onNativeBulkScannerResult", cancelled);
            return;
        }
        final Uri uri = data.getData();
        bridgeExecutor.execute(() -> {
            JSONObject output = new JSONObject();
            Bitmap bitmap = null;
            try {
                output.put("requestId", requestId);
                byte[] source = readContentBytes(uri, MAX_BRIDGE_IMAGE_BYTES);
                bitmap = decodeSampledBitmap(source, 1500);
                if (bitmap == null) throw new IOException("Das Scanbild konnte nicht dekodiert werden.");
                ByteArrayOutputStream encoded = new ByteArrayOutputStream(220_000);
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 89, encoded)) {
                    throw new IOException("Das Scanbild konnte nicht für die Erkennung vorbereitet werden.");
                }
                output.put("ok", true);
                output.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(
                        encoded.toByteArray(),
                        Base64.NO_WRAP
                ));
                putCaptureMetadata(output, data);
                if (isDebugBuild()) {
                    Log.d(TAG, "Bulk scanner image delivered requestId="
                            + sanitizeLogText(requestId, 80)
                            + " bytes=" + encoded.size()
                            + " width=" + bitmap.getWidth()
                            + " height=" + bitmap.getHeight());
                }
            } catch (Exception error) {
                Log.e(TAG, "Unable to deliver bulk scanner image", error);
                try {
                    output.put("requestId", requestId);
                    output.put("ok", false);
                    output.put("error", safeMessage(error, "Die Kameraaufnahme konnte nicht übernommen werden."));
                } catch (Exception ignored) {
                    // Keep response best-effort.
                }
            } finally {
                if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
            }
            sendJs("onNativeBulkScannerResult", output);
        });
    }

    private byte[] readContentBytes(Uri uri, int maximum) throws IOException {
        try (InputStream input = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream(256_000)) {
            if (input == null) throw new IOException("Das Scanbild ist nicht mehr lesbar.");
            byte[] buffer = new byte[16_384];
            int count;
            int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > maximum) throw new IOException("Das Scanbild ist für die Übergabe zu groß.");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == BULK_SCANNER) {
            deliverBulkScannerResult(resultCode, data);
            return;
        }
        if (requestCode != FILE_CHOOSER || fileCallback == null) {
            return;
        }
        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            synchronized (this) {
                pendingFileCaptureMetadata = captureMetadataJson(data);
            }
            results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if ((results == null || results.length == 0) && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(results);
        fileCallback = null;
    }

    private String captureMetadataJson(Intent data) {
        if (data == null || !data.getBooleanExtra(CameraActivity.EXTRA_NORMALIZED_CARD, false)) {
            return "";
        }
        JSONObject metadata = new JSONObject();
        try {
            putCaptureMetadata(metadata, data);
            return metadata.toString();
        } catch (Exception error) {
            Log.w(TAG, "Unable to pass normalized capture metadata", error);
            return "";
        }
    }

    private void putCaptureMetadata(JSONObject output, Intent data) throws Exception {
        boolean normalized = data != null
                && data.getBooleanExtra(CameraActivity.EXTRA_NORMALIZED_CARD, false);
        if (!normalized) return;
        float confidence = data.getFloatExtra(CameraActivity.EXTRA_CROP_CONFIDENCE, 0f);
        boolean fallback = data.getBooleanExtra(CameraActivity.EXTRA_CROP_FALLBACK, false);
        output.put("normalized", true);
        output.put("prepared", true);
        output.put("method", data.getStringExtra(CameraActivity.EXTRA_CROP_METHOD));
        output.put("confidence", confidence);
        output.put("cardCoverage", data.getFloatExtra(CameraActivity.EXTRA_CROP_COVERAGE, 0f));
        output.put("fallbackUsed", fallback);
        output.put("detectedAspectRatio", data.getFloatExtra(
                CameraActivity.EXTRA_CROP_ASPECT_RATIO, 0f));
        output.put("safetyMargin", data.getFloatExtra(CameraActivity.EXTRA_CROP_MARGIN, 0f));
        output.put("correctedRotationDegrees", data.getFloatExtra(
                CameraActivity.EXTRA_CROP_ROTATION, 0f));
        output.put("fourCornersDetected", data.getBooleanExtra(
                CameraActivity.EXTRA_CROP_FOUR_CORNERS, false));
        output.put("perspectiveCorrected", data.getBooleanExtra(
                CameraActivity.EXTRA_CROP_PERSPECTIVE, false));
        output.put("borderComplete", data.getBooleanExtra(
                CameraActivity.EXTRA_CROP_BORDER_COMPLETE, false));
        output.put("reliable", !fallback && confidence >= 0.72f);
        output.put("width", CardImageProcessor.NORMALIZED_WIDTH);
        output.put("height", CardImageProcessor.NORMALIZED_HEIGHT);
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
