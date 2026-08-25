package de.pokefolio.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
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
    private final RectF cardRect = new RectF();
    private final Path cutout = new Path();

    private float focusX;
    private float focusY;
    private boolean focusVisible;
    private boolean focusSucceeded;
    private float reservedTop;
    private float reservedBottom;

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
