package de.pokefolio.app;

import android.graphics.Bitmap;
import android.graphics.RectF;
import androidx.camera.view.transform.CoordinateTransform;
import androidx.camera.view.transform.OutputTransform;

/** The preview and saved JPEG must share a CameraX ViewPort. No edge search here. */
@androidx.annotation.OptIn(markerClass = androidx.camera.view.TransformExperimental.class)
final class FixedFrameCrop {
    static RectF map(RectF previewFrame, OutputTransform preview, OutputTransform capture,
                     int fullWidth, int fullHeight, int decodedWidth, int decodedHeight) {
        RectF mapped = new RectF(previewFrame);
        new CoordinateTransform(preview, capture).mapRect(mapped);
        mapped.left *= decodedWidth / (float) fullWidth;
        mapped.right *= decodedWidth / (float) fullWidth;
        mapped.top *= decodedHeight / (float) fullHeight;
        mapped.bottom *= decodedHeight / (float) fullHeight;
        if (!Float.isFinite(mapped.left) || !Float.isFinite(mapped.top)
                || !Float.isFinite(mapped.right) || !Float.isFinite(mapped.bottom)
                || mapped.width() <= 0 || mapped.height() <= 0
                || mapped.left < -1 || mapped.top < -1
                || mapped.right > decodedWidth + 1 || mapped.bottom > decodedHeight + 1) {
            throw new IllegalArgumentException("Preview frame is outside captured viewport");
        }
        mapped.inset(-mapped.width() * .03f, -mapped.height() * .03f);
        mapped.intersect(0, 0, decodedWidth, decodedHeight);
        return mapped;
    }

    static CardImageProcessor.PreviewCrop extract(Bitmap source, RectF bounds) {
        int left = Math.max(0, (int) Math.floor(bounds.left));
        int top = Math.max(0, (int) Math.floor(bounds.top));
        int right = Math.min(source.getWidth(), (int) Math.ceil(bounds.right));
        int bottom = Math.min(source.getHeight(), (int) Math.ceil(bounds.bottom));
        return new CardImageProcessor.PreviewCrop(
                Bitmap.createBitmap(source, left, top, right - left, bottom - top),
                new RectF(left, top, right, bottom));
    }
}
