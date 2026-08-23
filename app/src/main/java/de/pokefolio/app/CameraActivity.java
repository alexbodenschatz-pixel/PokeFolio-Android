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
import android.util.Rational;
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
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.FocusMeteringResult;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.UseCaseGroup;
import androidx.camera.core.ViewPort;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;

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
    private boolean previewStreaming;
    private int startAttempts;

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
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
        FrameLayout.LayoutParams hintLayout = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(66)
        );
        hintLayout.gravity = Gravity.TOP;
        hintLayout.setMargins(dp(16), dp(16), dp(16), 0);
        root.addView(hint, hintLayout);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(dp(14), dp(10), dp(14), dp(20));
        controls.setBackgroundColor(Color.argb(166, 0, 0, 0));

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
        controls.addView(cancelButton, compact);
        controls.addView(torchButton, light);
        controls.addView(shootButton, primary);

        FrameLayout.LayoutParams controlsLayout = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        controlsLayout.gravity = Gravity.BOTTOM;
        root.addView(controls, controlsLayout);
        setContentView(root);

        cancelButton.setOnClickListener(view -> {
            setResult(RESULT_CANCELED);
            finish();
        });
        torchButton.setOnClickListener(view -> toggleTorch());
        shootButton.setOnClickListener(view -> takePhoto());
        previewView.setOnTouchListener(this::handlePreviewTouch);
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
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .setFlashMode(ImageCapture.FLASH_MODE_AUTO)
                    .setTargetRotation(rotation)
                    .setJpegQuality(95)
                    .build();
            imageCapture.setCropAspectRatio(new Rational(63, 88));

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

            previewView.getPreviewStreamState().observe(this, state -> {
                if (state == PreviewView.StreamState.STREAMING) {
                    previewStreaming = true;
                    hint.setText(R.string.camera_frame_instructions);
                    shootButton.setEnabled(true);
                    overlay.postDelayed(this::focusFrameCenter, 350L);
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
                Log.d(TAG, "Focus metering was cancelled", error);
            }
            overlay.showFocusResult(successful);
        }, ContextCompat.getMainExecutor(this));
    }

    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) {
            return;
        }
        torchEnabled = !torchEnabled;
        camera.getCameraControl().enableTorch(torchEnabled);
        torchButton.setText(torchEnabled ? R.string.camera_light_off : R.string.camera_light);
        torchButton.setContentDescription(getString(torchEnabled
                ? R.string.camera_light_off_description
                : R.string.camera_light_on_description));
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
                try {
                    Bitmap oriented = CardImageProcessor.decodeAndOrient(temporary, 3200);
                    Bitmap region = CardImageProcessor.cropPreviewRegion(
                            oriented,
                            frame,
                            previewWidth,
                            previewHeight
                    );
                    Bitmap rectified = CardImageProcessor.rectifyCard(region);
                    Bitmap result = rectified != null ? rectified : region;
                    Uri uri = writeCardToGallery(result);
                    if (rectified != null && rectified != region) {
                        region.recycle();
                    }
                    if (result != oriented) {
                        oriented.recycle();
                    }
                    result.recycle();

                    Intent resultIntent = new Intent();
                    resultIntent.setData(uri);
                    resultIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    runOnUiThread(() -> {
                        setResult(RESULT_OK, resultIntent);
                        finish();
                    });
                } catch (Exception error) {
                    showCaptureError("Die Kartenaufnahme konnte nicht verarbeitet werden.", error);
                } finally {
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
    protected void onDestroy() {
        super.onDestroy();
        if (cameraProvider != null) {
            cameraProvider.unbindAll();
        }
        if (cameraExecutor != null) {
            cameraExecutor.shutdown();
        }
    }
}
