package de.pokefolio.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PointF;
import android.graphics.RectF;

import androidx.exifinterface.media.ExifInterface;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Image normalization shared by camera captures and gallery OCR. */
public final class CardImageProcessor {
    private static final float CARD_RATIO = CardOverlayView.CARD_ASPECT_RATIO;

    private CardImageProcessor() {
    }

    public static final class OcrVariant {
        public final String name;
        public final Bitmap bitmap;

        OcrVariant(String name, Bitmap bitmap) {
            this.name = name;
            this.bitmap = bitmap;
        }
    }

    public static final class VisualPreparation {
        public final Bitmap bitmap;
        public final boolean reliable;
        public final String method;

        VisualPreparation(Bitmap bitmap, boolean reliable, String method) {
            this.bitmap = bitmap;
            this.reliable = reliable;
            this.method = method;
        }
    }

    public static Bitmap decodeAndOrient(File file, int maxDimension) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw new IOException("Das Kamerabild konnte nicht gelesen werden.");
        }

        int sampleSize = 1;
        while (Math.max(bounds.outWidth / sampleSize, bounds.outHeight / sampleSize) > maxDimension * 1.35f) {
            sampleSize *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded = BitmapFactory.decodeFile(file.getAbsolutePath(), options);
        if (decoded == null) {
            throw new IOException("Das Kamerabild konnte nicht dekodiert werden.");
        }

        ExifInterface exif = new ExifInterface(file.getAbsolutePath());
        int orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
        );
        Matrix matrix = exifMatrix(orientation);
        Bitmap oriented = matrix.isIdentity()
                ? decoded
                : Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), matrix, true);
        if (oriented != decoded) {
            decoded.recycle();
        }
        Bitmap scaled = scaleDown(oriented, maxDimension);
        if (scaled != oriented) {
            oriented.recycle();
        }
        return scaled;
    }

    private static Matrix exifMatrix(int orientation) {
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                matrix.setScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                matrix.setRotate(180f);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                matrix.setRotate(180f);
                matrix.postScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                matrix.setRotate(90f);
                matrix.postScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_90:
                matrix.setRotate(90f);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                matrix.setRotate(-90f);
                matrix.postScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                matrix.setRotate(-90f);
                break;
            default:
                break;
        }
        return matrix;
    }

    /** Maps the visible overlay into a FILL_CENTER preview image and keeps a small border. */
    public static Bitmap cropPreviewRegion(
            Bitmap source,
            RectF frameInView,
            int previewWidth,
            int previewHeight
    ) {
        if (previewWidth <= 0 || previewHeight <= 0 || frameInView.isEmpty()) {
            return centerCropToCard(source);
        }
        float scale = Math.max(
                previewWidth / (float) source.getWidth(),
                previewHeight / (float) source.getHeight()
        );
        float displayedWidth = source.getWidth() * scale;
        float displayedHeight = source.getHeight() * scale;
        float hiddenX = (displayedWidth - previewWidth) / 2f;
        float hiddenY = (displayedHeight - previewHeight) / 2f;

        float padding = Math.min(frameInView.width(), frameInView.height()) * 0.025f;
        RectF padded = new RectF(frameInView);
        padded.inset(-padding, -padding);
        int left = clamp(Math.round((padded.left + hiddenX) / scale), 0, source.getWidth() - 2);
        int top = clamp(Math.round((padded.top + hiddenY) / scale), 0, source.getHeight() - 2);
        int right = clamp(Math.round((padded.right + hiddenX) / scale), left + 2, source.getWidth());
        int bottom = clamp(Math.round((padded.bottom + hiddenY) / scale), top + 2, source.getHeight());
        Bitmap cropped = Bitmap.createBitmap(source, left, top, right - left, bottom - top);
        Bitmap scaled = scaleDown(cropped, 2200);
        if (scaled != cropped && cropped != source) {
            cropped.recycle();
        }
        return scaled;
    }

    /** Returns OCR passes covering rotation, scale, contrast, lighting and a rectified card area. */
    public static List<OcrVariant> createOcrVariants(Bitmap source) {
        Bitmap scaled = scaleDown(source, 1800);
        Bitmap rectified = rectifyCard(scaled);
        Bitmap base = rectified != null ? rectified : scaled;
        List<OcrVariant> variants = new ArrayList<>();

        int[] rotations = {0, 90, 180, 270};
        for (int rotation : rotations) {
            Bitmap rotated = rotate(base, rotation);
            Bitmap normal = scaleDown(rotated, 1500);
            variants.add(new OcrVariant("vollbild-" + rotation, normal));

            float ratio = normal.getWidth() / (float) normal.getHeight();
            if (ratio >= 0.42f && ratio <= 1.08f) {
                Bitmap card = centerCropToCard(normal);
                variants.add(new OcrVariant("karte-kontrast-" + rotation, enhanceForOcr(card)));
                addHeaderOcrVariants(variants, card, rotation);
                addCollectorOcrVariants(variants, card, rotation);
                if (card != normal) {
                    card.recycle();
                }
            }
            if (rotated != normal) {
                rotated.recycle();
            }
        }

        if (rectified != null && scaled != source && !scaled.isRecycled()) {
            scaled.recycle();
        }
        if (!base.isRecycled()) {
            base.recycle();
        }
        return variants;
    }

    /**
     * Normalizes a photographed or downloaded card for the local visual matcher.
     * Perspective correction is attempted first; the fallback deliberately keeps
     * the same card ratio used by the camera overlay.
     */
    public static Bitmap prepareForVisualComparison(Bitmap source) {
        return prepareForVisualComparison(source, true);
    }

    /** Reference database images are already rectified and skip edge detection. */
    public static Bitmap prepareForVisualComparison(Bitmap source, boolean attemptPerspectiveCorrection) {
        return prepareForVisualComparisonDetailed(source, attemptPerspectiveCorrection).bitmap;
    }

    /** Locates, rectifies and normalizes the printed card while reporting fallback reliability. */
    public static VisualPreparation prepareForVisualComparisonDetailed(
            Bitmap source,
            boolean attemptPerspectiveCorrection
    ) {
        Bitmap scaled = scaleDown(source, 1600);
        Bitmap rectified = attemptPerspectiveCorrection ? rectifyCard(scaled) : null;
        Bitmap boundedFallback = attemptPerspectiveCorrection && rectified == null
                ? cropLikelyCardBounds(scaled)
                : null;
        Bitmap base = rectified != null ? rectified : boundedFallback != null ? boundedFallback : scaled;
        Bitmap oriented = base.getWidth() > base.getHeight() ? rotate(base, 90) : base;

        float currentRatio = oriented.getWidth() / (float) oriented.getHeight();
        int left = 0;
        int top = 0;
        int width = oriented.getWidth();
        int height = oriented.getHeight();
        if (currentRatio > CARD_RATIO) {
            width = Math.max(2, Math.round(height * CARD_RATIO));
            left = (oriented.getWidth() - width) / 2;
        } else {
            height = Math.max(2, Math.round(width / CARD_RATIO));
            top = (oriented.getHeight() - height) / 2;
        }
        Bitmap crop = Bitmap.createBitmap(oriented, left, top, width, height);
        Bitmap normalized = Bitmap.createScaledBitmap(crop, 378, 528, true);

        if (crop != oriented && crop != normalized) {
            crop.recycle();
        }
        if (oriented != base && !oriented.isRecycled() && oriented != normalized) {
            oriented.recycle();
        }
        if (rectified != null && !rectified.isRecycled() && rectified != normalized) {
            rectified.recycle();
        }
        if (boundedFallback != null && !boundedFallback.isRecycled() && boundedFallback != normalized) {
            boundedFallback.recycle();
        }
        if (scaled != source && !scaled.isRecycled() && scaled != normalized) {
            scaled.recycle();
        }
        return new VisualPreparation(
                normalized,
                !attemptPerspectiveCorrection || rectified != null,
                attemptPerspectiveCorrection
                        ? rectified != null
                            ? "perspective"
                            : boundedFallback != null ? "edge-fallback" : "center-fallback"
                        : "reference"
        );
    }

    /** Axis-aligned fallback that removes table/background even when four-point fitting is weak. */
    private static Bitmap cropLikelyCardBounds(Bitmap source) {
        Bitmap analysis = scaleDown(source, 520);
        int width = analysis.getWidth();
        int height = analysis.getHeight();
        int[] pixels = new int[width * height];
        analysis.getPixels(pixels, 0, width, 0, 0, width, height);
        int[] luminance = new int[pixels.length];
        for (int index = 0; index < pixels.length; index++) {
            int color = pixels[index];
            luminance[index] = (77 * ((color >> 16) & 0xff)
                    + 150 * ((color >> 8) & 0xff)
                    + 29 * (color & 0xff)) >> 8;
        }
        float[] verticalEnergy = new float[width];
        float[] horizontalEnergy = new float[height];
        for (int y = 2; y < height - 2; y += 2) {
            int row = y * width;
            for (int x = 2; x < width - 2; x += 2) {
                verticalEnergy[x] += Math.abs(luminance[row + x + 1] - luminance[row + x - 1]);
                horizontalEnergy[y] += Math.abs(luminance[row + width + x] - luminance[row - width + x]);
            }
        }
        smooth(verticalEnergy, 4);
        smooth(horizontalEnergy, 4);
        int left = peak(verticalEnergy, Math.round(width * 0.015f), Math.round(width * 0.48f));
        int right = peak(verticalEnergy, Math.round(width * 0.52f), Math.round(width * 0.985f));
        int top = peak(horizontalEnergy, Math.round(height * 0.015f), Math.round(height * 0.48f));
        int bottom = peak(horizontalEnergy, Math.round(height * 0.52f), Math.round(height * 0.985f));
        float rectangleWidth = right - left;
        float rectangleHeight = bottom - top;
        float portraitRatio = Math.min(rectangleWidth, rectangleHeight)
                / Math.max(1f, Math.max(rectangleWidth, rectangleHeight));
        boolean plausible = rectangleWidth >= width * 0.30f
                && rectangleHeight >= height * 0.30f
                && rectangleWidth * rectangleHeight >= width * height * 0.18f
                && portraitRatio >= 0.50f
                && portraitRatio <= 0.88f
                && peakRatio(verticalEnergy, left, right) >= 1.06f
                && peakRatio(horizontalEnergy, top, bottom) >= 1.06f;
        if (!plausible) {
            if (analysis != source) analysis.recycle();
            return null;
        }

        float scaleX = source.getWidth() / (float) width;
        float scaleY = source.getHeight() / (float) height;
        int paddingX = Math.max(1, Math.round(rectangleWidth * scaleX * 0.012f));
        int paddingY = Math.max(1, Math.round(rectangleHeight * scaleY * 0.012f));
        int cropLeft = clamp(Math.round(left * scaleX) - paddingX, 0, source.getWidth() - 2);
        int cropTop = clamp(Math.round(top * scaleY) - paddingY, 0, source.getHeight() - 2);
        int cropRight = clamp(Math.round(right * scaleX) + paddingX, cropLeft + 2, source.getWidth());
        int cropBottom = clamp(Math.round(bottom * scaleY) + paddingY, cropTop + 2, source.getHeight());
        if (analysis != source) analysis.recycle();
        return Bitmap.createBitmap(
                source,
                cropLeft,
                cropTop,
                cropRight - cropLeft,
                cropBottom - cropTop
        );
    }

    /** Attempts a four-point document transform. Returns null when the edge evidence is weak. */
    public static Bitmap rectifyCard(Bitmap source) {
        Bitmap analysis = scaleDown(source, 520);
        PointF[] smallQuad = findCardQuad(analysis);
        if (smallQuad == null) {
            if (analysis != source) {
                analysis.recycle();
            }
            return null;
        }

        float scaleX = source.getWidth() / (float) analysis.getWidth();
        float scaleY = source.getHeight() / (float) analysis.getHeight();
        PointF[] quad = new PointF[4];
        for (int i = 0; i < 4; i++) {
            quad[i] = new PointF(smallQuad[i].x * scaleX, smallQuad[i].y * scaleY);
        }
        if (analysis != source) {
            analysis.recycle();
        }

        float width = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2f;
        float height = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2f;
        boolean portrait = width <= height;
        int outputWidth = portrait ? 900 : 1260;
        int outputHeight = portrait ? 1260 : 900;

        float[] from = {
                quad[0].x, quad[0].y,
                quad[1].x, quad[1].y,
                quad[2].x, quad[2].y,
                quad[3].x, quad[3].y
        };
        float[] to = {
                0f, 0f,
                outputWidth, 0f,
                outputWidth, outputHeight,
                0f, outputHeight
        };
        Matrix transform = new Matrix();
        if (!transform.setPolyToPoly(from, 0, to, 0, 4)) {
            return null;
        }
        Bitmap output = Bitmap.createBitmap(outputWidth, outputHeight, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        canvas.drawBitmap(source, transform, paint);
        return output;
    }

    private static PointF[] findCardQuad(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        if (width < 80 || height < 80) {
            return null;
        }
        int[] pixels = new int[width * height];
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        int[] luminance = new int[pixels.length];
        for (int i = 0; i < pixels.length; i++) {
            int color = pixels[i];
            luminance[i] = (77 * ((color >> 16) & 0xff)
                    + 150 * ((color >> 8) & 0xff)
                    + 29 * (color & 0xff)) >> 8;
        }

        float[] verticalEnergy = new float[width];
        float[] horizontalEnergy = new float[height];
        for (int y = 2; y < height - 2; y += 2) {
            int row = y * width;
            for (int x = 2; x < width - 2; x += 2) {
                int gx = Math.abs(luminance[row + x + 1] - luminance[row + x - 1]);
                int gy = Math.abs(luminance[row + width + x] - luminance[row - width + x]);
                verticalEnergy[x] += gx;
                horizontalEnergy[y] += gy;
            }
        }
        smooth(verticalEnergy, 4);
        smooth(horizontalEnergy, 4);

        int left = peak(verticalEnergy, Math.round(width * 0.025f), Math.round(width * 0.46f));
        int right = peak(verticalEnergy, Math.round(width * 0.54f), Math.round(width * 0.975f));
        int top = peak(horizontalEnergy, Math.round(height * 0.025f), Math.round(height * 0.46f));
        int bottom = peak(horizontalEnergy, Math.round(height * 0.54f), Math.round(height * 0.975f));
        if (right - left < width * 0.32f || bottom - top < height * 0.32f) {
            return null;
        }
        if (peakRatio(verticalEnergy, left, right) < 1.12f
                || peakRatio(horizontalEnergy, top, bottom) < 1.12f) {
            return null;
        }

        LinearLine topLine = fitHorizontal(luminance, width, height, left, right, top);
        LinearLine bottomLine = fitHorizontal(luminance, width, height, left, right, bottom);
        LinearLine leftLine = fitVertical(luminance, width, height, top, bottom, left);
        LinearLine rightLine = fitVertical(luminance, width, height, top, bottom, right);
        if (topLine == null || bottomLine == null || leftLine == null || rightLine == null) {
            return null;
        }

        PointF topLeft = intersect(topLine, leftLine);
        PointF topRight = intersect(topLine, rightLine);
        PointF bottomRight = intersect(bottomLine, rightLine);
        PointF bottomLeft = intersect(bottomLine, leftLine);
        PointF[] quad = {topLeft, topRight, bottomRight, bottomLeft};
        for (PointF point : quad) {
            if (point == null || point.x < -width * 0.08f || point.y < -height * 0.08f
                    || point.x > width * 1.08f || point.y > height * 1.08f) {
                return null;
            }
        }

        float area = polygonArea(quad);
        float averageWidth = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2f;
        float averageHeight = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2f;
        float aspect = averageWidth / Math.max(1f, averageHeight);
        if (area < width * height * 0.18f || aspect < 0.42f || aspect > 2.35f) {
            return null;
        }
        return quad;
    }

    /** Horizontal edge in y = slope * x + intercept form. */
    private static LinearLine fitHorizontal(
            int[] luminance,
            int width,
            int height,
            int left,
            int right,
            int baseline
    ) {
        List<PointF> points = new ArrayList<>();
        int band = Math.max(7, Math.round(height * 0.055f));
        int step = Math.max(3, (right - left) / 42);
        for (int x = left + step; x < right - step; x += step) {
            int bestY = -1;
            int best = -1;
            for (int y = Math.max(2, baseline - band); y <= Math.min(height - 3, baseline + band); y++) {
                int gradient = Math.abs(luminance[(y + 1) * width + x] - luminance[(y - 1) * width + x]);
                if (gradient > best) {
                    best = gradient;
                    bestY = y;
                }
            }
            if (bestY >= 0) {
                points.add(new PointF(x, bestY));
            }
        }
        return robustFit(points, true, Math.max(5f, band * 0.55f));
    }

    /** Vertical edge in x = slope * y + intercept form. */
    private static LinearLine fitVertical(
            int[] luminance,
            int width,
            int height,
            int top,
            int bottom,
            int baseline
    ) {
        List<PointF> points = new ArrayList<>();
        int band = Math.max(7, Math.round(width * 0.055f));
        int step = Math.max(3, (bottom - top) / 42);
        for (int y = top + step; y < bottom - step; y += step) {
            int bestX = -1;
            int best = -1;
            for (int x = Math.max(2, baseline - band); x <= Math.min(width - 3, baseline + band); x++) {
                int gradient = Math.abs(luminance[y * width + x + 1] - luminance[y * width + x - 1]);
                if (gradient > best) {
                    best = gradient;
                    bestX = x;
                }
            }
            if (bestX >= 0) {
                points.add(new PointF(bestX, y));
            }
        }
        return robustFit(points, false, Math.max(5f, band * 0.55f));
    }

    private static LinearLine robustFit(List<PointF> points, boolean horizontal, float tolerance) {
        LinearLine initial = leastSquares(points, horizontal);
        if (initial == null) {
            return null;
        }
        List<PointF> filtered = new ArrayList<>();
        for (PointF point : points) {
            float predicted = initial.slope * (horizontal ? point.x : point.y) + initial.intercept;
            float actual = horizontal ? point.y : point.x;
            if (Math.abs(predicted - actual) <= tolerance) {
                filtered.add(point);
            }
        }
        return filtered.size() >= 8 ? leastSquares(filtered, horizontal) : initial;
    }

    private static LinearLine leastSquares(List<PointF> points, boolean horizontal) {
        if (points.size() < 5) {
            return null;
        }
        double sumX = 0d;
        double sumY = 0d;
        double sumXX = 0d;
        double sumXY = 0d;
        for (PointF point : points) {
            double independent = horizontal ? point.x : point.y;
            double dependent = horizontal ? point.y : point.x;
            sumX += independent;
            sumY += dependent;
            sumXX += independent * independent;
            sumXY += independent * dependent;
        }
        double denominator = points.size() * sumXX - sumX * sumX;
        if (Math.abs(denominator) < 0.0001d) {
            return null;
        }
        float slope = (float) ((points.size() * sumXY - sumX * sumY) / denominator);
        float intercept = (float) ((sumY - slope * sumX) / points.size());
        return new LinearLine(slope, intercept, horizontal);
    }

    private static PointF intersect(LinearLine horizontal, LinearLine vertical) {
        if (!horizontal.horizontal || vertical.horizontal) {
            return null;
        }
        float denominator = 1f - horizontal.slope * vertical.slope;
        if (Math.abs(denominator) < 0.02f) {
            return null;
        }
        float y = (horizontal.slope * vertical.intercept + horizontal.intercept) / denominator;
        float x = vertical.slope * y + vertical.intercept;
        return new PointF(x, y);
    }

    private static final class LinearLine {
        final float slope;
        final float intercept;
        final boolean horizontal;

        LinearLine(float slope, float intercept, boolean horizontal) {
            this.slope = slope;
            this.intercept = intercept;
            this.horizontal = horizontal;
        }
    }

    private static Bitmap centerCropToCard(Bitmap source) {
        float currentRatio = source.getWidth() / (float) source.getHeight();
        int left = 0;
        int top = 0;
        int width = source.getWidth();
        int height = source.getHeight();
        if (currentRatio > CARD_RATIO) {
            width = Math.max(2, Math.round(height * CARD_RATIO));
            left = (source.getWidth() - width) / 2;
        } else {
            height = Math.max(2, Math.round(width / CARD_RATIO));
            top = (source.getHeight() - height) / 2;
        }
        Bitmap crop = Bitmap.createBitmap(source, left, top, width, height);
        Bitmap scaled = Bitmap.createScaledBitmap(crop, 900, 1257, true);
        if (crop != source && crop != scaled) {
            crop.recycle();
        }
        return scaled;
    }

    private static void addCollectorOcrVariants(List<OcrVariant> variants, Bitmap card, int rotation) {
        int top = Math.max(0, Math.round(card.getHeight() * 0.80f));
        Bitmap bottom = Bitmap.createBitmap(card, 0, top, card.getWidth(), card.getHeight() - top);
        int normalWidth = 1100;
        Bitmap normal = Bitmap.createScaledBitmap(
                bottom,
                normalWidth,
                Math.max(2, Math.round(bottom.getHeight() * normalWidth / (float) bottom.getWidth())),
                true
        );
        variants.add(new OcrVariant("unterkante-normal-" + rotation, normal));
        variants.add(new OcrVariant("unterkante-grau-" + rotation, grayscaleForOcr(normal)));
        variants.add(new OcrVariant("unterkante-kontrast-" + rotation, enhanceForOcr(normal)));

        int sharpWidth = 1500;
        Bitmap sharpLarge = Bitmap.createScaledBitmap(
                bottom,
                sharpWidth,
                Math.max(2, Math.round(bottom.getHeight() * sharpWidth / (float) bottom.getWidth())),
                true
        );
        Bitmap sharpGray = grayscaleForOcr(sharpLarge);
        variants.add(new OcrVariant("unterkante-scharf-" + rotation, sharpenForOcr(sharpGray)));
        sharpGray.recycle();
        if (sharpLarge != bottom) sharpLarge.recycle();
        if (bottom != card) bottom.recycle();
    }

    /** Dedicated 23%-header OCR for species name, V/ex/GX marker and KP/HP. */
    private static void addHeaderOcrVariants(List<OcrVariant> variants, Bitmap card, int rotation) {
        int height = Math.max(2, Math.round(card.getHeight() * 0.23f));
        Bitmap header = Bitmap.createBitmap(card, 0, 0, card.getWidth(), height);
        Bitmap base = scaleDown(header, 700);
        variants.add(new OcrVariant("kopfzeile-original-" + rotation, base));
        variants.add(new OcrVariant("kopfzeile-grau-" + rotation, grayscaleForOcr(base)));

        int twoXWidth = Math.min(2200, Math.max(1100, base.getWidth() * 2));
        Bitmap twoX = Bitmap.createScaledBitmap(
                base,
                twoXWidth,
                Math.max(2, Math.round(base.getHeight() * twoXWidth / (float) base.getWidth())),
                true
        );
        variants.add(new OcrVariant("kopfzeile-2x-" + rotation, twoX));
        variants.add(new OcrVariant("kopfzeile-kontrast-" + rotation, enhanceForOcr(twoX)));

        int threeXWidth = Math.min(3000, Math.max(1600, base.getWidth() * 3));
        Bitmap threeX = Bitmap.createScaledBitmap(
                base,
                threeXWidth,
                Math.max(2, Math.round(base.getHeight() * threeXWidth / (float) base.getWidth())),
                true
        );
        variants.add(new OcrVariant("kopfzeile-3x-" + rotation, threeX));
        Bitmap sharpGray = grayscaleForOcr(threeX);
        variants.add(new OcrVariant("kopfzeile-scharf-" + rotation, sharpenForOcr(sharpGray)));
        sharpGray.recycle();
        if (base != header) header.recycle();
    }

    private static Bitmap grayscaleForOcr(Bitmap source) {
        Bitmap output = Bitmap.createBitmap(source.getWidth(), source.getHeight(), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        ColorMatrix grayscale = new ColorMatrix();
        grayscale.setSaturation(0f);
        paint.setColorFilter(new ColorMatrixColorFilter(grayscale));
        canvas.drawBitmap(source, 0f, 0f, paint);
        return output;
    }

    /** Small unsharp kernel for low-contrast collector-number print. */
    private static Bitmap sharpenForOcr(Bitmap source) {
        int width = source.getWidth();
        int height = source.getHeight();
        int[] input = new int[width * height];
        int[] output = new int[input.length];
        source.getPixels(input, 0, width, 0, 0, width, height);
        System.arraycopy(input, 0, output, 0, input.length);
        for (int y = 1; y < height - 1; y++) {
            int row = y * width;
            for (int x = 1; x < width - 1; x++) {
                int index = row + x;
                int center = input[index] & 0xff;
                int sharpened = clamp(
                        center * 5
                                - (input[index - 1] & 0xff)
                                - (input[index + 1] & 0xff)
                                - (input[index - width] & 0xff)
                                - (input[index + width] & 0xff),
                        0,
                        255
                );
                output[index] = 0xff000000 | sharpened << 16 | sharpened << 8 | sharpened;
            }
        }
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.setPixels(output, 0, width, 0, 0, width, height);
        return bitmap;
    }

    private static Bitmap enhanceForOcr(Bitmap source) {
        Bitmap output = Bitmap.createBitmap(source.getWidth(), source.getHeight(), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        ColorMatrix saturation = new ColorMatrix();
        saturation.setSaturation(0f);
        float contrast = 1.48f;
        float translate = 128f * (1f - contrast) + 8f;
        ColorMatrix contrastMatrix = new ColorMatrix(new float[]{
                contrast, 0, 0, 0, translate,
                0, contrast, 0, 0, translate,
                0, 0, contrast, 0, translate,
                0, 0, 0, 1, 0
        });
        saturation.postConcat(contrastMatrix);
        paint.setColorFilter(new ColorMatrixColorFilter(saturation));
        canvas.drawBitmap(source, 0f, 0f, paint);
        return output;
    }

    private static Bitmap rotate(Bitmap source, int degrees) {
        if (degrees % 360 == 0) {
            return source.copy(Bitmap.Config.ARGB_8888, false);
        }
        Matrix matrix = new Matrix();
        matrix.setRotate(degrees);
        return Bitmap.createBitmap(source, 0, 0, source.getWidth(), source.getHeight(), matrix, true);
    }

    private static Bitmap scaleDown(Bitmap source, int maxDimension) {
        int currentMax = Math.max(source.getWidth(), source.getHeight());
        if (currentMax <= maxDimension) {
            return source.copy(Bitmap.Config.ARGB_8888, false);
        }
        float factor = maxDimension / (float) currentMax;
        return Bitmap.createScaledBitmap(
                source,
                Math.max(2, Math.round(source.getWidth() * factor)),
                Math.max(2, Math.round(source.getHeight() * factor)),
                true
        );
    }

    private static void smooth(float[] values, int radius) {
        float[] copy = values.clone();
        for (int i = 0; i < values.length; i++) {
            float sum = 0f;
            int count = 0;
            for (int j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
                sum += copy[j];
                count++;
            }
            values[i] = sum / Math.max(1, count);
        }
    }

    private static int peak(float[] values, int start, int end) {
        int bestIndex = clamp(start, 0, values.length - 1);
        float best = -1f;
        for (int i = Math.max(0, start); i <= Math.min(values.length - 1, end); i++) {
            if (values[i] > best) {
                best = values[i];
                bestIndex = i;
            }
        }
        return bestIndex;
    }

    private static float peakRatio(float[] values, int firstPeak, int secondPeak) {
        float sum = 0f;
        for (float value : values) {
            sum += value;
        }
        float average = sum / Math.max(1, values.length);
        float peakAverage = (values[firstPeak] + values[secondPeak]) / 2f;
        return peakAverage / Math.max(1f, average);
    }

    private static float polygonArea(PointF[] points) {
        float area = 0f;
        for (int i = 0; i < points.length; i++) {
            PointF current = points[i];
            PointF next = points[(i + 1) % points.length];
            area += current.x * next.y - next.x * current.y;
        }
        return Math.abs(area) / 2f;
    }

    private static float distance(PointF a, PointF b) {
        return (float) Math.hypot(a.x - b.x, a.y - b.y);
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
