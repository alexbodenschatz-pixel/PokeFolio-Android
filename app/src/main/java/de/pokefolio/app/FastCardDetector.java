package de.pokefolio.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PointF;
import android.graphics.Rect;

/**
 * Low-cost, TCG-independent live detector.
 *
 * <p>The class deliberately knows nothing about OCR, artwork, card databases or prices. It
 * throttles expensive contour re-detection to 10-15 Hz, keeps the last temporally smoothed quad
 * between detector frames and exposes measured timings for debug builds.</p>
 */
public final class FastCardDetector {
    static final long MOVING_INTERVAL_MS = 66L;
    static final long STABLE_INTERVAL_MS = 92L;
    private static final long METRICS_WINDOW_MS = 2_000L;
    private static final float METRIC_ALPHA = 0.20f;
    private static final int WORKING_MAX_DIMENSION = 150;
    private static final Paint SCALE_PAINT = new Paint(Paint.FILTER_BITMAP_FLAG);

    private final CardDetectionTracker tracker = new CardDetectionTracker();
    private long lastDetectionAt;
    private long metricsWindowStartedAt;
    private int previewFrames;
    private int detectionFrames;
    private float detectorMs;
    private float trackingMs;
    private CardDetectionTracker.Snapshot lastSnapshot;

    /** Records every ImageAnalysis callback and selects only the next useful detector frame. */
    public synchronized boolean shouldAnalyze(long now) {
        previewFrames++;
        if (metricsWindowStartedAt == 0L) metricsWindowStartedAt = now;
        long interval = lastSnapshot != null && lastSnapshot.stability >= 0.78f
                ? STABLE_INTERVAL_MS : MOVING_INTERVAL_MS;
        if (lastDetectionAt != 0L && now - lastDetectionAt < interval) return false;
        lastDetectionAt = now;
        detectionFrames++;
        return true;
    }

    /** Runs one physical-card contour pass inside the already mapped search ROI. */
    public Result detect(
            Bitmap uprightFrame,
            Rect searchRect,
            int viewWidth,
            int viewHeight,
            long now
    ) {
        Bitmap search = null;
        int searchWidth = 1;
        int searchHeight = 1;
        long detectorStarted = System.nanoTime();
        CardImageProcessor.PhysicalCardDetection detection = null;
        try {
            float scale = Math.min(1f, WORKING_MAX_DIMENSION
                    / (float) Math.max(searchRect.width(), searchRect.height()));
            searchWidth = Math.max(80, Math.round(searchRect.width() * scale));
            searchHeight = Math.max(80, Math.round(searchRect.height() * scale));
            search = Bitmap.createBitmap(searchWidth, searchHeight, Bitmap.Config.ARGB_8888);
            new Canvas(search).drawBitmap(uprightFrame, searchRect,
                    new Rect(0, 0, searchWidth, searchHeight), SCALE_PAINT);
            detection = CardImageProcessor.analyzePhysicalCardFast(search);
        } finally {
            if (search != null && search != uprightFrame && !search.isRecycled()) search.recycle();
        }
        float measuredDetectorMs = elapsedMs(detectorStarted);

        PointF[] viewQuad = null;
        float confidence = 0f;
        if (detection != null) {
            confidence = detection.confidence;
            viewQuad = new PointF[4];
            for (int index = 0; index < 4; index++) {
                float frameX = searchRect.left
                        + detection.quad[index].x / searchWidth * searchRect.width();
                float frameY = searchRect.top
                        + detection.quad[index].y / searchHeight * searchRect.height();
                viewQuad[index] = new PointF(
                        frameX / uprightFrame.getWidth() * viewWidth,
                        frameY / uprightFrame.getHeight() * viewHeight
                );
            }
        }

        long trackingStarted = System.nanoTime();
        CardDetectionTracker.Snapshot snapshot = tracker.update(
                viewQuad, confidence, viewWidth, viewHeight, now);
        float measuredTrackingMs = elapsedMs(trackingStarted);
        synchronized (this) {
            detectorMs = ema(detectorMs, measuredDetectorMs);
            trackingMs = ema(trackingMs, measuredTrackingMs);
            lastSnapshot = snapshot;
        }
        return new Result(snapshot, measuredDetectorMs, measuredTrackingMs);
    }

    public synchronized Metrics metrics(long now) {
        long duration = Math.max(1L, now - metricsWindowStartedAt);
        return new Metrics(
                previewFrames * 1000f / duration,
                detectionFrames * 1000f / duration,
                detectorMs,
                trackingMs,
                duration >= METRICS_WINDOW_MS
        );
    }

    public synchronized void beginNextMetricsWindow(long now) {
        metricsWindowStartedAt = now;
        previewFrames = 0;
        detectionFrames = 0;
    }

    public synchronized CardDetectionTracker.Snapshot lastSnapshot() {
        return lastSnapshot;
    }

    public synchronized void reset() {
        tracker.reset();
        lastSnapshot = null;
        lastDetectionAt = 0L;
        metricsWindowStartedAt = 0L;
        previewFrames = 0;
        detectionFrames = 0;
        detectorMs = 0f;
        trackingMs = 0f;
    }

    private static float elapsedMs(long startedAt) {
        return (System.nanoTime() - startedAt) / 1_000_000f;
    }

    private static float ema(float previous, float value) {
        return previous <= 0f ? value : previous * (1f - METRIC_ALPHA) + value * METRIC_ALPHA;
    }

    public static final class Result {
        public final CardDetectionTracker.Snapshot snapshot;
        public final float detectorMs;
        public final float trackingMs;

        Result(CardDetectionTracker.Snapshot snapshot, float detectorMs, float trackingMs) {
            this.snapshot = snapshot;
            this.detectorMs = detectorMs;
            this.trackingMs = trackingMs;
        }
    }

    public static final class Metrics {
        public final float previewFps;
        public final float detectionFps;
        public final float detectorMs;
        public final float trackingMs;
        public final boolean windowComplete;

        Metrics(float previewFps, float detectionFps, float detectorMs, float trackingMs,
                boolean windowComplete) {
            this.previewFps = previewFps;
            this.detectionFps = detectionFps;
            this.detectorMs = detectorMs;
            this.trackingMs = trackingMs;
            this.windowComplete = windowComplete;
        }
    }
}
