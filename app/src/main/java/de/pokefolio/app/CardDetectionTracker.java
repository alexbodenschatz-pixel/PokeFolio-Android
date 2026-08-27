package de.pokefolio.app;

import android.graphics.PointF;

/**
 * Smooths the four physical card corners and measures temporal stability.
 * This class never inspects card artwork and is therefore shared by every TCG.
 */
public final class CardDetectionTracker {
    private static final float SMOOTHING_ALPHA = 0.34f;
    private static final long LOST_AFTER_MS = 420L;
    private PointF[] smoothed;
    private long lastSeenAt;
    private int consistentFrames;
    private float stability;

    public Snapshot update(PointF[] measured, float confidence, int viewWidth, int viewHeight, long now) {
        if (measured == null || measured.length != 4 || confidence < 0.30f) {
            if (now - lastSeenAt > LOST_AFTER_MS) reset();
            return snapshot(confidence);
        }
        if (smoothed == null) {
            smoothed = copy(measured);
            consistentFrames = 1;
            stability = 0.18f;
        } else {
            float diagonal = (float) Math.hypot(Math.max(1, viewWidth), Math.max(1, viewHeight));
            float movement = meanDistance(smoothed, measured) / Math.max(1f, diagonal);
            if (movement < 0.0065f) {
                consistentFrames++;
            } else if (movement < 0.020f) {
                consistentFrames = Math.max(1, consistentFrames - 1);
            } else {
                consistentFrames = 1;
            }
            float movementScore = clamp01(1f - movement / 0.025f);
            stability = clamp01(stability * 0.58f + movementScore * 0.32f
                    + Math.min(1f, consistentFrames / 8f) * 0.10f);
            for (int index = 0; index < 4; index++) {
                smoothed[index].x += (measured[index].x - smoothed[index].x) * SMOOTHING_ALPHA;
                smoothed[index].y += (measured[index].y - smoothed[index].y) * SMOOTHING_ALPHA;
            }
        }
        lastSeenAt = now;
        return snapshot(confidence);
    }

    public void reset() {
        smoothed = null;
        consistentFrames = 0;
        stability = 0f;
        lastSeenAt = 0L;
    }

    private Snapshot snapshot(float confidence) {
        return new Snapshot(copy(smoothed), clamp01(confidence), stability,
                smoothed != null && confidence >= 0.66f && stability >= 0.82f);
    }

    private static float meanDistance(PointF[] first, PointF[] second) {
        float sum = 0f;
        for (int index = 0; index < 4; index++) {
            sum += (float) Math.hypot(first[index].x - second[index].x,
                    first[index].y - second[index].y);
        }
        return sum / 4f;
    }

    private static PointF[] copy(PointF[] points) {
        if (points == null || points.length != 4) return null;
        PointF[] copy = new PointF[4];
        for (int index = 0; index < 4; index++) copy[index] = new PointF(points[index].x, points[index].y);
        return copy;
    }

    private static float clamp01(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    public static final class Snapshot {
        public final PointF[] quad;
        public final float confidence;
        public final float stability;
        public final boolean ready;

        Snapshot(PointF[] quad, float confidence, float stability, boolean ready) {
            this.quad = quad;
            this.confidence = confidence;
            this.stability = stability;
            this.ready = ready;
        }
    }
}
