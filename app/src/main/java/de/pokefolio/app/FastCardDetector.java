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
        boolean complete = detection != null && detection.borderComplete
                && detection.coverage >= 0.22f && detection.aspectRatio >= 0.55f
                && detection.aspectRatio <= 0.88f;
        boolean qualityReady = complete && snapshot.ready
                && qualityAcceptable(uprightFrame, viewQuad, viewWidth, viewHeight);
        return new Result(snapshot, measuredDetectorMs, measuredTrackingMs,
                detection != null, qualityReady);
    }

    private static boolean qualityAcceptable(Bitmap frame, PointF[] quad, int width, int height) {
        // Sample only the card interior, excluding sharp background edges and the border.
        int[] gray = new int[48 * 64];
        for (int y = 0; y < 64; y++) {
            float v = 0.08f + 0.84f * y / 63f;
            for (int x = 0; x < 48; x++) {
                float u = 0.08f + 0.84f * x / 47f;
                float px = (1-v)*((1-u)*quad[0].x+u*quad[1].x)
                        + v*((1-u)*quad[3].x+u*quad[2].x);
                float py = (1-v)*((1-u)*quad[0].y+u*quad[1].y)
                        + v*((1-u)*quad[3].y+u*quad[2].y);
                int ix = Math.max(0, Math.min(frame.getWidth()-1, Math.round(px / width * frame.getWidth())));
                int iy = Math.max(0, Math.min(frame.getHeight()-1, Math.round(py / height * frame.getHeight())));
                gray[y*48+x] = frame.getPixel(ix, iy) & 255;
            }
        }
        return PreviewQuality.acceptable(gray, 48, 64);
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
        public final boolean present;
        public final boolean qualityReady;

        Result(CardDetectionTracker.Snapshot snapshot, float detectorMs, float trackingMs,
                boolean present, boolean qualityReady) {
            this.snapshot = snapshot;
            this.detectorMs = detectorMs;
            this.trackingMs = trackingMs;
            this.present = present;
            this.qualityReady = qualityReady;
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
