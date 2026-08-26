package de.pokefolio.app;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraControl;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.FocusMeteringResult;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.TorchState;
import androidx.camera.core.UseCaseGroup;
import androidx.camera.core.ViewPort;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Native CameraX scanner with a card-sized region of interest. */
public final class CameraActivity extends ComponentActivity {
    public static final String EXTRA_BULK_MODE = "de.pokefolio.app.extra.BULK_MODE";
    public static final String EXTRA_NORMALIZED_CARD = "de.pokefolio.app.extra.NORMALIZED_CARD";
    public static final String EXTRA_CROP_METHOD = "de.pokefolio.app.extra.CROP_METHOD";
    public static final String EXTRA_CROP_CONFIDENCE = "de.pokefolio.app.extra.CROP_CONFIDENCE";
    public static final String EXTRA_CROP_COVERAGE = "de.pokefolio.app.extra.CROP_COVERAGE";
    public static final String EXTRA_CROP_FALLBACK = "de.pokefolio.app.extra.CROP_FALLBACK";
    private static final String TAG = "PokeFolioCamera";
    private static final int CAMERA_PERMISSION_REQUEST = 44;

    private PreviewView previewView;
    private CardOverlayView overlay;
    private TextView hint;
    private Button shootButton;
    private Button torchButton;
    private ImageCapture imageCapture;
    private Camera camera;
    private ProcessCameraProvider cameraProvider;
    private ExecutorService cameraExecutor;
    private boolean torchEnabled;
    private boolean bulkMode;
    private boolean previewStreaming;
    private int startAttempts;
    private LinearLayout cameraControls;
    private FrameLayout.LayoutParams hintLayoutParams;
    private final Runnable focusCenterRunnable = this::focusFrameCenter;

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        bulkMode = getIntent().getBooleanExtra(EXTRA_BULK_MODE, false);
        cameraExecutor = Executors.newSingleThreadExecutor();
        buildUi();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED) {
            previewView.post(this::startCamera);
        } else {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        }
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(this);
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        previewView.setContentDescription(getString(R.string.camera_preview_description));
        root.addView(previewView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        overlay = new CardOverlayView(this);
        root.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        hint = new TextView(this);
        hint.setText(R.string.camera_starting);
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(15f);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(12), dp(7), dp(12), dp(7));
        hint.setBackgroundColor(Color.argb(178, 0, 0, 0));
        hintLayoutParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(66)
        );
        hintLayoutParams.gravity = Gravity.TOP;
        hintLayoutParams.setMargins(dp(16), dp(12), dp(16), 0);
        root.addView(hint, hintLayoutParams);

        cameraControls = new LinearLayout(this);
        cameraControls.setOrientation(LinearLayout.HORIZONTAL);
        cameraControls.setGravity(Gravity.CENTER);
        cameraControls.setPadding(dp(14), dp(10), dp(14), dp(16));
        cameraControls.setBackgroundColor(Color.argb(166, 0, 0, 0));

        Button cancelButton = new Button(this);
        cancelButton.setText(R.string.scanner_cancel);
        cancelButton.setContentDescription(getString(R.string.scanner_cancel_description));
        torchButton = new Button(this);
        torchButton.setText(R.string.camera_light);
        torchButton.setContentDescription(getString(R.string.camera_light_on_description));
        torchButton.setVisibility(View.GONE);
        shootButton = new Button(this);
        shootButton.setText(R.string.capture_card);
        shootButton.setTextSize(15f);
        shootButton.setEnabled(false);
        shootButton.setContentDescription(getString(R.string.capture_card_description));

        LinearLayout.LayoutParams compact = new LinearLayout.LayoutParams(0, dp(58), 0.9f);
        compact.setMargins(0, 0, dp(8), 0);
        LinearLayout.LayoutParams light = new LinearLayout.LayoutParams(0, dp(58), 0.72f);
        light.setMargins(0, 0, dp(8), 0);
        LinearLayout.LayoutParams primary = new LinearLayout.LayoutParams(0, dp(58), 1.45f);
        cameraControls.addView(cancelButton, compact);
        cameraControls.addView(torchButton, light);
        cameraControls.addView(shootButton, primary);

        FrameLayout.LayoutParams controlsLayout = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        controlsLayout.gravity = Gravity.BOTTOM;
        root.addView(cameraControls, controlsLayout);
        setContentView(root);
        installSafeAreaHandling(root);

        cancelButton.setOnClickListener(view -> {
            setResult(RESULT_CANCELED);
            finish();
        });
        torchButton.setOnClickListener(view -> toggleTorch());
        shootButton.setOnClickListener(view -> takePhoto());
        previewView.setOnTouchListener(this::handlePreviewTouch);
    }

    /** Keeps every interactive camera element above real system bars on all navigation modes. */
    private void installSafeAreaHandling(View root) {
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets safe = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout()
            );
            Insets navigation = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());

            hintLayoutParams.setMargins(
                    dp(16) + safe.left,
                    safe.top + dp(12),
                    dp(16) + safe.right,
                    0
            );
            hint.setLayoutParams(hintLayoutParams);
            cameraControls.setPadding(
                    dp(14) + safe.left,
                    dp(10),
                    dp(14) + safe.right,
                    navigation.bottom + dp(16)
            );
            cameraControls.post(this::updateOverlayReservedAreas);
            Log.d(TAG, "Safe area statusTop=" + safe.top
                    + " navigationBottom=" + navigation.bottom
                    + " controlsHeight=" + cameraControls.getHeight());
            return windowInsets;
        });
        root.addOnLayoutChangeListener((view, left, top, right, bottom,
                                        oldLeft, oldTop, oldRight, oldBottom) ->
                updateOverlayReservedAreas());
        ViewCompat.requestApplyInsets(root);
    }

    private void updateOverlayReservedAreas() {
        if (overlay == null || cameraControls == null || hint == null) return;
        int reservedTop = Math.max(hint.getBottom() + dp(12), dp(92));
        int reservedBottom = Math.max(cameraControls.getHeight() + dp(12), dp(96));
        overlay.setReservedAreas(reservedTop, reservedBottom);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST
                && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            previewView.post(this::startCamera);
            return;
        }
        Toast.makeText(this, R.string.camera_permission_required, Toast.LENGTH_LONG).show();
        finish();
    }

    private void startCamera() {
        if (isFinishing() || isDestroyed()) {
            return;
        }
        startAttempts++;
        previewStreaming = false;
        overlay.removeCallbacks(focusCenterRunnable);
        hint.setText(R.string.camera_starting);
        shootButton.setEnabled(false);
        ListenableFuture<ProcessCameraProvider> providerFuture = ProcessCameraProvider.getInstance(this);
        providerFuture.addListener(() -> bindCamera(providerFuture), ContextCompat.getMainExecutor(this));

        previewView.postDelayed(() -> {
            if (!previewStreaming && !isFinishing() && startAttempts < 2) {
                Log.w(TAG, "Camera preview did not stream; rebinding once in compatibility mode");
                startCamera();
            } else if (!previewStreaming && !isFinishing()) {
                hint.setText(R.string.camera_preview_missing);
            }
        }, 6500L);
    }

    private void bindCamera(ListenableFuture<ProcessCameraProvider> providerFuture) {
        try {
            cameraProvider = providerFuture.get();
            int rotation = previewView.getDisplay() == null
                    ? android.view.Surface.ROTATION_0
                    : previewView.getDisplay().getRotation();

            Preview preview = new Preview.Builder()
                    .setTargetRotation(rotation)
                    .build();
            preview.setSurfaceProvider(previewView.getSurfaceProvider());

            imageCapture = new ImageCapture.Builder()
                    .setCaptureMode(bulkMode
                            ? ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY
                            : ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .setFlashMode(ImageCapture.FLASH_MODE_OFF)
                    .setTargetRotation(rotation)
                    .setJpegQuality(95)
                    .build();

            CameraSelector selector;
            if (cameraProvider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) {
                selector = CameraSelector.DEFAULT_BACK_CAMERA;
            } else if (cameraProvider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
                selector = CameraSelector.DEFAULT_FRONT_CAMERA;
            } else {
                throw new IllegalStateException("Auf diesem Gerät wurde keine Kamera gefunden.");
            }

            UseCaseGroup.Builder useCases = new UseCaseGroup.Builder()
                    .addUseCase(preview)
                    .addUseCase(imageCapture);
            ViewPort viewPort = previewView.getViewPort();
            if (viewPort != null) {
                useCases.setViewPort(viewPort);
            }

            cameraProvider.unbindAll();
            camera = cameraProvider.bindToLifecycle(this, selector, useCases.build());
            boolean hasFlash = camera.getCameraInfo().hasFlashUnit();
            torchButton.setVisibility(hasFlash ? View.VISIBLE : View.GONE);
            camera.getCameraInfo().getTorchState().removeObservers(this);
            camera.getCameraInfo().getTorchState().observe(this, state -> {
                torchEnabled = state != null && state == TorchState.ON;
                updateTorchButton();
            });
            forceTorchOff("camera-bound");

            previewView.getPreviewStreamState().removeObservers(this);
            previewView.getPreviewStreamState().observe(this, state -> {
                if (state == PreviewView.StreamState.STREAMING) {
                    previewStreaming = true;
                    hint.setText(bulkMode
                            ? R.string.bulk_camera_frame_instructions
                            : R.string.camera_frame_instructions);
                    shootButton.setEnabled(true);
                    overlay.removeCallbacks(focusCenterRunnable);
                    overlay.postDelayed(focusCenterRunnable, 350L);
                }
            });
        } catch (Exception error) {
            Log.e(TAG, "Unable to bind CameraX use cases", error);
            hint.setText(R.string.camera_start_failed);
            shootButton.setEnabled(false);
            Toast.makeText(this, R.string.camera_start_failed, Toast.LENGTH_LONG).show();
        }
    }

    private boolean handlePreviewTouch(View view, MotionEvent event) {
        if (event.getAction() == MotionEvent.ACTION_DOWN) {
            return true;
        }
        if (event.getAction() == MotionEvent.ACTION_UP) {
            view.performClick();
            if (camera != null && overlay.contains(event.getX(), event.getY())) {
                focusAt(event.getX(), event.getY());
            }
            return true;
        }
        return false;
    }

    private void focusFrameCenter() {
        RectF frame = overlay.getCardRect();
        if (camera != null && !frame.isEmpty()) {
            focusAt(frame.centerX(), frame.centerY());
        }
    }

    private void focusAt(float x, float y) {
        MeteringPoint point = previewView.getMeteringPointFactory().createPoint(x, y, 0.16f);
        FocusMeteringAction action = new FocusMeteringAction.Builder(
                point,
                FocusMeteringAction.FLAG_AF
                        | FocusMeteringAction.FLAG_AE
                        | FocusMeteringAction.FLAG_AWB
        ).setAutoCancelDuration(4, TimeUnit.SECONDS).build();
        if (!camera.getCameraInfo().isFocusMeteringSupported(action)) {
            return;
        }
        overlay.showFocusPoint(x, y);
        ListenableFuture<FocusMeteringResult> focusFuture = camera.getCameraControl().startFocusAndMetering(action);
        focusFuture.addListener(() -> {
            boolean successful = false;
            try {
                successful = focusFuture.get().isFocusSuccessful();
            } catch (Exception error) {
                Throwable cause = error.getCause();
                if (cause instanceof CameraControl.OperationCanceledException) {
                    Log.d(TAG, "Focus metering was superseded by a newer request");
                } else {
                    Log.w(TAG, "Focus metering failed", error);
                }
            }
            overlay.showFocusResult(successful);
        }, ContextCompat.getMainExecutor(this));
    }

    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) {
            return;
        }
        boolean requested = !torchEnabled;
        camera.getCameraControl().enableTorch(requested).addListener(() -> {
            Log.d(TAG, "Torch request completed requested=" + requested);
        }, ContextCompat.getMainExecutor(this));
    }

    private void updateTorchButton() {
        torchButton.setText(torchEnabled ? R.string.camera_light_off : R.string.camera_light);
        torchButton.setContentDescription(getString(torchEnabled
                ? R.string.camera_light_off_description
                : R.string.camera_light_on_description));
    }

    /** Scanner sessions always start dark; only an explicit button press may enable the torch. */
    private void forceTorchOff(String reason) {
        torchEnabled = false;
        if (imageCapture != null) {
            imageCapture.setFlashMode(ImageCapture.FLASH_MODE_OFF);
        }
        if (camera != null && camera.getCameraInfo().hasFlashUnit()) {
            camera.getCameraControl().enableTorch(false);
        }
        updateTorchButton();
        Log.i(TAG, "Torch forced OFF reason=" + reason);
    }

    private void takePhoto() {
        if (imageCapture == null || !shootButton.isEnabled()) {
            return;
        }
        shootButton.setEnabled(false);
        shootButton.setText(R.string.processing_card);
        RectF frame = overlay.getCardRect();
        int previewWidth = previewView.getWidth();
        int previewHeight = previewView.getHeight();

        final File temporary;
        try {
            temporary = File.createTempFile("pokefolio-capture-", ".jpg", getCacheDir());
        } catch (Exception error) {
            showCaptureError("Temporäre Aufnahme konnte nicht angelegt werden.", error);
            return;
        }

        ImageCapture.OutputFileOptions options = new ImageCapture.OutputFileOptions.Builder(temporary).build();
        imageCapture.takePicture(options, cameraExecutor, new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(ImageCapture.OutputFileResults output) {
                Bitmap oriented = null;
                Bitmap region = null;
                CardImageProcessor.VisualPreparation preparation = null;
                try {
                    oriented = CardImageProcessor.decodeAndOrient(temporary, 3200);
                    CardImageProcessor.PreviewCrop previewCrop = CardImageProcessor.cropPreviewRegionDetailed(
                            oriented,
                            frame,
                            previewWidth,
                            previewHeight
                    );
                    region = previewCrop.bitmap;
                    preparation = CardImageProcessor.prepareCapturedCardDetailed(region);
                    Log.i(TAG, "CARD_CROP overlay=" + frame
                            + " preview=" + previewWidth + "x" + previewHeight
                            + " capture=" + oriented.getWidth() + "x" + oriented.getHeight()
                            + " captureRoi=" + previewCrop.sourceRect
                            + " detectedQuad=" + formatQuad(preparation.detectedQuad)
                            + " final=" + preparation.bitmap.getWidth() + "x" + preparation.bitmap.getHeight()
                            + " confidence=" + String.format(Locale.US, "%.3f", preparation.confidence)
                            + " coverage=" + String.format(Locale.US, "%.3f", preparation.cardCoverage)
                            + " fallback=" + preparation.fallbackUsed
                            + " method=" + preparation.method);
                    if (isDebugBuild()) {
                        writeDebugStages(oriented, region, preparation);
                    }
                    Uri uri = writeCardToGallery(preparation.bitmap);

                    Intent resultIntent = new Intent();
                    resultIntent.setData(uri);
                    resultIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    resultIntent.putExtra(EXTRA_NORMALIZED_CARD, true);
                    resultIntent.putExtra(EXTRA_CROP_METHOD, preparation.method);
                    resultIntent.putExtra(EXTRA_CROP_CONFIDENCE, preparation.confidence);
                    resultIntent.putExtra(EXTRA_CROP_COVERAGE, preparation.cardCoverage);
                    resultIntent.putExtra(EXTRA_CROP_FALLBACK, preparation.fallbackUsed);
                    runOnUiThread(() -> {
                        setResult(RESULT_OK, resultIntent);
                        finish();
                    });
                } catch (Exception error) {
                    showCaptureError("Die Kartenaufnahme konnte nicht verarbeitet werden.", error);
                } finally {
                    if (preparation != null && !preparation.bitmap.isRecycled()) {
                        preparation.bitmap.recycle();
                    }
                    if (region != null && !region.isRecycled()) region.recycle();
                    if (oriented != null && !oriented.isRecycled()) oriented.recycle();
                    //noinspection ResultOfMethodCallIgnored
                    temporary.delete();
                }
            }

            @Override
            public void onError(ImageCaptureException error) {
                //noinspection ResultOfMethodCallIgnored
                temporary.delete();
                showCaptureError("Aufnahme fehlgeschlagen.", error);
            }
        });
    }

    private String formatQuad(android.graphics.PointF[] quad) {
        if (quad == null) return "none";
        StringBuilder text = new StringBuilder("[");
        for (int index = 0; index < quad.length; index++) {
            if (index > 0) text.append(';');
            text.append(Math.round(quad[index].x)).append(',').append(Math.round(quad[index].y));
        }
        return text.append(']').toString();
    }

    /** Diagnostic stages stay in app cache and are only emitted by debuggable builds. */
    private void writeDebugStages(
            Bitmap original,
            Bitmap frameRoi,
            CardImageProcessor.VisualPreparation preparation
    ) {
        File directory = new File(getCacheDir(), "card-crop-debug");
        if (!directory.exists() && !directory.mkdirs()) {
            Log.w(TAG, "CARD_CROP_DEBUG could not create " + directory);
            return;
        }
        Bitmap outlined = null;
        try {
            outlined = CardImageProcessor.drawDetectedQuad(
                    frameRoi, preparation.detectedQuad, preparation.reliable);
            writeDebugBitmap(new File(directory, "01-original.jpg"), original);
            writeDebugBitmap(new File(directory, "02-frame-roi.jpg"), frameRoi);
            writeDebugBitmap(new File(directory, "03-detected-card.jpg"), outlined);
            writeDebugBitmap(new File(directory, "04-perspective-corrected.jpg"), preparation.bitmap);
            writeDebugBitmap(new File(directory, "05-final-normalized.jpg"), preparation.bitmap);
            Log.d(TAG, "CARD_CROP_DEBUG path=" + directory.getAbsolutePath());
        } catch (Exception error) {
            Log.w(TAG, "CARD_CROP_DEBUG write failed", error);
        } finally {
            if (outlined != null && !outlined.isRecycled()) outlined.recycle();
        }
    }

    private void writeDebugBitmap(File file, Bitmap bitmap) throws Exception {
        try (OutputStream stream = new java.io.FileOutputStream(file)) {
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 92, stream)) {
                throw new IllegalStateException("Debugbild konnte nicht geschrieben werden.");
            }
        }
    }

    private boolean isDebugBuild() {
        return (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private Uri writeCardToGallery(Bitmap bitmap) throws Exception {
        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
                .format(System.currentTimeMillis());
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, "PokeFolio_" + stamp + ".jpg");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/PokeFolio");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            throw new IllegalStateException("Kein Speicherplatz für das Kartenfoto verfügbar.");
        }
        try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
            if (stream == null || !bitmap.compress(Bitmap.CompressFormat.JPEG, 95, stream)) {
                throw new IllegalStateException("Kartenfoto konnte nicht gespeichert werden.");
            }
        } catch (Exception error) {
            getContentResolver().delete(uri, null, null);
            throw error;
        }
        ContentValues completed = new ContentValues();
        completed.put(MediaStore.Images.Media.IS_PENDING, 0);
        getContentResolver().update(uri, completed, null, null);
        return uri;
    }

    private void showCaptureError(String message, Exception error) {
        Log.e(TAG, message, error);
        runOnUiThread(() -> {
            shootButton.setEnabled(true);
            shootButton.setText(R.string.capture_card);
            Toast.makeText(CameraActivity.this, message, Toast.LENGTH_LONG).show();
        });
    }

    @Override
    protected void onStop() {
        forceTorchOff("activity-stopped");
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        forceTorchOff("activity-destroyed");
        super.onDestroy();
        if (cameraProvider != null) {
            cameraProvider.unbindAll();
        }
        if (cameraExecutor != null) {
            cameraExecutor.shutdown();
        }
    }
}
