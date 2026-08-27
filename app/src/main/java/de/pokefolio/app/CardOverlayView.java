package de.pokefolio.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PointF;
import android.graphics.RectF;
import android.view.View;

/** Draws the card-shaped viewfinder and tap-to-focus feedback above CameraX. */
public final class CardOverlayView extends View {
    public static final float CARD_ASPECT_RATIO = 63f / 88f;

    private final Paint shade = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint corner = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint guide = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint focus = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint detectedBorder = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF cardRect = new RectF();
    private final Path cutout = new Path();

    private float focusX;
    private float focusY;
    private boolean focusVisible;
    private boolean focusSucceeded;
    private float reservedTop;
    private float reservedBottom;
    private PointF[] detectedQuad;
    private float detectionConfidence;
    private float stabilityScore;

    public CardOverlayView(Context context) {
        super(context);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);

        shade.setColor(Color.argb(174, 0, 0, 0));
        shade.setStyle(Paint.Style.FILL);

        border.setColor(Color.argb(245, 255, 255, 255));
        border.setStyle(Paint.Style.STROKE);
        border.setStrokeWidth(dp(1.5f));

        corner.setColor(Color.rgb(88, 215, 170));
        corner.setStyle(Paint.Style.STROKE);
        corner.setStrokeWidth(dp(5f));
        corner.setStrokeCap(Paint.Cap.ROUND);

        guide.setColor(Color.argb(80, 255, 255, 255));
        guide.setStyle(Paint.Style.STROKE);
        guide.setStrokeWidth(dp(1f));

        focus.setStyle(Paint.Style.STROKE);
        focus.setStrokeWidth(dp(2.5f));

        detectedBorder.setStyle(Paint.Style.STROKE);
        detectedBorder.setStrokeWidth(dp(3f));
        detectedBorder.setStrokeJoin(Paint.Join.ROUND);
        detectedBorder.setStrokeCap(Paint.Cap.ROUND);
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    public RectF getCardRect() {
        return new RectF(cardRect);
    }

    public boolean contains(float x, float y) {
        return cardRect.contains(x, y);
    }

    /** Updates the TCG-independent polygon around the physical outer card edge. */
    public void setDetectedCard(PointF[] quad, float confidence, float stability) {
        detectedQuad = copyPoints(quad);
        detectionConfidence = clamp01(confidence);
        stabilityScore = clamp01(stability);
        invalidate();
    }

    public void clearDetectedCard() {
        detectedQuad = null;
        detectionConfidence = 0f;
        stabilityScore = 0f;
        invalidate();
    }

    public PointF[] getDetectedQuad() {
        return copyPoints(detectedQuad);
    }

    private static PointF[] copyPoints(PointF[] points) {
        if (points == null || points.length != 4) return null;
        PointF[] copy = new PointF[4];
        for (int index = 0; index < 4; index++) {
            copy[index] = new PointF(points[index].x, points[index].y);
        }
        return copy;
    }

    private static float clamp01(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    /** Areas occupied by the inset-aware hint and camera controls. */
    public void setReservedAreas(int top, int bottom) {
        float nextTop = Math.max(0, top);
        float nextBottom = Math.max(0, bottom);
        if (reservedTop == nextTop && reservedBottom == nextBottom) return;
        reservedTop = nextTop;
        reservedBottom = nextBottom;
        invalidate();
    }

    public void showFocusPoint(float x, float y) {
        focusX = x;
        focusY = y;
        focusSucceeded = false;
        focusVisible = true;
        animate().cancel();
        setAlpha(1f);
        invalidate();
    }

    public void showFocusResult(boolean succeeded) {
        focusSucceeded = succeeded;
        focusVisible = true;
        invalidate();
        postDelayed(() -> {
            focusVisible = false;
            invalidate();
        }, 900L);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float width = getWidth();
        float height = getHeight();
        float topInset = Math.max(dp(92f), reservedTop);
        float bottomInset = Math.max(dp(116f), reservedBottom);
        float availableHeight = Math.max(0f, height - topInset - bottomInset);
        float frameWidth = Math.min(width * 0.82f, availableHeight * CARD_ASPECT_RATIO);
        if (frameWidth <= 0f) {
            cardRect.setEmpty();
            canvas.drawColor(shade.getColor());
            return;
        }
        float frameHeight = frameWidth / CARD_ASPECT_RATIO;
        float left = (width - frameWidth) / 2f;
        float top = topInset + (availableHeight - frameHeight) / 2f;
        cardRect.set(left, top, left + frameWidth, top + frameHeight);

        float radius = dp(15f);
        cutout.reset();
        cutout.setFillType(Path.FillType.EVEN_ODD);
        cutout.addRect(0f, 0f, width, height, Path.Direction.CW);
        cutout.addRoundRect(cardRect, radius, radius, Path.Direction.CW);
        canvas.drawPath(cutout, shade);
        canvas.drawRoundRect(cardRect, radius, radius, border);

        float thirdY1 = cardRect.top + cardRect.height() / 3f;
        float thirdY2 = cardRect.top + cardRect.height() * 2f / 3f;
        canvas.drawLine(cardRect.left + radius, thirdY1, cardRect.right - radius, thirdY1, guide);
        canvas.drawLine(cardRect.left + radius, thirdY2, cardRect.right - radius, thirdY2, guide);

        float length = dp(31f);
        float x1 = cardRect.left;
        float y1 = cardRect.top;
        float x2 = cardRect.right;
        float y2 = cardRect.bottom;
        canvas.drawLine(x1, y1, x1 + length, y1, corner);
        canvas.drawLine(x1, y1, x1, y1 + length, corner);
        canvas.drawLine(x2, y1, x2 - length, y1, corner);
        canvas.drawLine(x2, y1, x2, y1 + length, corner);
        canvas.drawLine(x1, y2, x1 + length, y2, corner);
        canvas.drawLine(x1, y2, x1, y2 - length, corner);
        canvas.drawLine(x2, y2, x2 - length, y2, corner);
        canvas.drawLine(x2, y2, x2, y2 - length, corner);

        if (detectedQuad != null && detectedQuad.length == 4) {
            // Orange: partial/weak. Yellow: complete but moving. Green: stable and ready.
            int color = detectionConfidence < 0.55f
                    ? Color.rgb(255, 151, 66)
                    : stabilityScore < 0.82f
                        ? Color.rgb(255, 207, 84)
                        : Color.rgb(88, 215, 170);
            detectedBorder.setColor(color);
            Path polygon = new Path();
            polygon.moveTo(detectedQuad[0].x, detectedQuad[0].y);
            for (int index = 1; index < detectedQuad.length; index++) {
                polygon.lineTo(detectedQuad[index].x, detectedQuad[index].y);
            }
            polygon.close();
            canvas.drawPath(polygon, detectedBorder);
        }

        if (focusVisible) {
            focus.setColor(focusSucceeded ? Color.rgb(88, 215, 170) : Color.WHITE);
            float focusRadius = dp(25f);
            canvas.drawCircle(focusX, focusY, focusRadius, focus);
            canvas.drawLine(focusX - focusRadius - dp(6), focusY, focusX - focusRadius + dp(5), focusY, focus);
            canvas.drawLine(focusX + focusRadius - dp(5), focusY, focusX + focusRadius + dp(6), focusY, focus);
            canvas.drawLine(focusX, focusY - focusRadius - dp(6), focusX, focusY - focusRadius + dp(5), focus);
            canvas.drawLine(focusX, focusY + focusRadius - dp(5), focusX, focusY + focusRadius + dp(6), focus);
        }
    }
}
