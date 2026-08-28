package de.pokefolio.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PointF;
import android.graphics.RectF;

import androidx.exifinterface.media.ExifInterface;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Image normalization shared by camera captures and gallery OCR. */
public final class CardImageProcessor {
    private CardImageProcessor() {
    }

    public static final class OcrVariant {
        public final String name;
        /** Logical card region represented by this bitmap. */
        public final String region;
        public final Bitmap bitmap;

        OcrVariant(String name, Bitmap bitmap) {
            this.name = name;
            this.region = regionForVariant(name);
            this.bitmap = bitmap;
        }

        private static String regionForVariant(String name) {
            if (name.startsWith("kopfzeile-")) return "TOP_HEADER";
            if (name.startsWith("sekundaer-")) return "TOP_SECONDARY";
            if (name.startsWith("mitteltext-")) return "MIDDLE_TEXT";
            if (name.startsWith("untertext-")) return "LOWER_TEXT";
            if (name.startsWith("unterkante-")) return "BOTTOM_METADATA";
            return "WHOLE_CARD";
        }
    }

    public static final class VisualPreparation {
        public final Bitmap bitmap;
        public final boolean reliable;
        public final String method;
        public final float confidence;
        public final float cardCoverage;
        public final boolean fallbackUsed;
        /** Detected corners in source-image coordinates, clockwise from top-left. */
        public final PointF[] detectedQuad;
        /** Short/long side ratio measured on the detected physical card. */
        public final float detectedAspectRatio;
        /** Guard band retained around the detected physical edge, as a fraction per side. */
        public final float safetyMargin;
        /** In-plane rotation removed by the perspective transform. */
        public final float correctedRotationDegrees;
        public final boolean fourCornersDetected;
        public final boolean perspectiveCorrected;
        public final boolean borderComplete;

        VisualPreparation(
                Bitmap bitmap,
                boolean reliable,
                String method,
                float confidence,
                float cardCoverage,
                boolean fallbackUsed,
                PointF[] detectedQuad,
                float detectedAspectRatio,
                float safetyMargin,
                float correctedRotationDegrees,
                boolean fourCornersDetected,
                boolean perspectiveCorrected,
                boolean borderComplete
        ) {
            this.bitmap = bitmap;
            this.reliable = reliable;
            this.method = method;
            this.confidence = confidence;
            this.cardCoverage = cardCoverage;
            this.fallbackUsed = fallbackUsed;
            this.detectedQuad = copyPoints(detectedQuad);
            this.detectedAspectRatio = detectedAspectRatio;
            this.safetyMargin = safetyMargin;
            this.correctedRotationDegrees = correctedRotationDegrees;
            this.fourCornersDetected = fourCornersDetected;
            this.perspectiveCorrected = perspectiveCorrected;
            this.borderComplete = borderComplete;
        }
    }

    public static final class PreviewCrop {
        public final Bitmap bitmap;
        /** Pixel coordinates in the EXIF-oriented ImageCapture bitmap. */
        public final RectF sourceRect;

        PreviewCrop(Bitmap bitmap, RectF sourceRect) {
            this.bitmap = bitmap;
            this.sourceRect = new RectF(sourceRect);
        }
    }

    /** Lightweight, artwork-independent outer-card geometry used by live ImageAnalysis. */
    public static final class PhysicalCardDetection {
        public final PointF[] quad;
        public final float confidence;
        public final float coverage;
        public final float aspectRatio;
        public final float rotationDegrees;
        public final boolean borderComplete;

        PhysicalCardDetection(CardDetection detection) {
            quad = copyPoints(detection.quad);
            confidence = detection.confidence;
            coverage = detection.coverage;
            aspectRatio = detection.aspectRatio;
            rotationDegrees = detection.rotationDegrees;
            borderComplete = detection.borderCompleteness >= 0.50f;
        }
    }

    private static final class CardDetection {
        final PointF[] quad;
        final float confidence;
        final float coverage;
        final float aspectRatio;
        final float rotationDegrees;
        final float borderCompleteness;

        CardDetection(
                PointF[] quad,
                float confidence,
                float coverage,
                float aspectRatio,
                float rotationDegrees,
                float borderCompleteness
        ) {
            this.quad = quad;
            this.confidence = confidence;
            this.coverage = coverage;
            this.aspectRatio = aspectRatio;
            this.rotationDegrees = rotationDegrees;
            this.borderCompleteness = borderCompleteness;
        }
    }

    private static final class FallbackCrop {
        final Bitmap bitmap;
        final float confidence;
        final float coverage;
        final float aspectRatio;
        final boolean borderComplete;

        FallbackCrop(
                Bitmap bitmap,
                float confidence,
                float coverage,
                float aspectRatio,
                boolean borderComplete
        ) {
            this.bitmap = bitmap;
            this.confidence = confidence;
            this.coverage = coverage;
            this.aspectRatio = aspectRatio;
            this.borderComplete = borderComplete;
        }
    }

    /** Exact normalized trading-card geometry; 900 * 88 / 63 = 1257.14. */
    static final int NORMALIZED_WIDTH = 900;
    static final int NORMALIZED_HEIGHT = 1257;
    private static final float CARD_RATIO = 63f / 88f;
    private static final float YUGIOH_CARD_RATIO = 59f / 86f;
    private static final float HIGH_CONFIDENCE_MARGIN = 0.018f;
    private static final float NORMAL_DETECTION_MARGIN = 0.024f;
    private static final float LOW_CONFIDENCE_MARGIN = 0.030f;
    // A plausible aspect ratio alone is insufficient for a destructive homography. The live
    // tracker uses the same 0.66 evidence floor; weaker single-frame detections keep the complete
    // search ROI or conservative bounds instead of warping background texture into a card.
    private static final float MIN_PERSPECTIVE_CONFIDENCE = 0.66f;
    private static final float RELIABLE_DETECTION = 0.72f;

    /** Detects only the outer physical trading-card edge; no TCG layout assumptions are used. */
    public static PhysicalCardDetection analyzePhysicalCard(Bitmap source) {
        Bitmap analysis = scaleDown(source, 640);
        CardDetection detection = detectCard(analysis);
        if (detection == null) {
            if (analysis != source) analysis.recycle();
            return null;
        }
        if (analysis != source) {
            detection = scaleDetection(detection,
                    source.getWidth() / (float) analysis.getWidth(),
                    source.getHeight() / (float) analysis.getHeight());
            analysis.recycle();
        }
        return new PhysicalCardDetection(detection);
    }

    /**
     * Preview-only contour pass. It uses a smaller working image and a deliberately bounded
     * hypothesis set; the full detector still refines the high-resolution capture afterwards.
     */
    public static PhysicalCardDetection analyzePhysicalCardFast(Bitmap source) {
        Bitmap analysis = scaleDown(source, 180);
        CardDetection detection = detectCard(analysis, true);
        if (detection == null) {
            if (analysis != source) analysis.recycle();
            return null;
        }
        if (analysis != source) {
            detection = scaleDetection(detection,
                    source.getWidth() / (float) analysis.getWidth(),
                    source.getHeight() / (float) analysis.getHeight());
            analysis.recycle();
        }
        return new PhysicalCardDetection(detection);
    }

    /** Rotation helper for CameraX analysis frames (which do not carry EXIF metadata). */
    public static Bitmap rotateForAnalysis(Bitmap source, int degrees) {
        int normalized = ((degrees % 360) + 360) % 360;
        return normalized == 0 ? source : rotate(source, normalized);
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

    /**
     * Maps the visible overlay search area into the oriented capture bitmap. CameraX Preview and
     * ImageCapture are bound to one ViewPort; this is therefore a ViewPort/FILL_CENTER mapping,
     * never an assumption that the overlay itself is the card contour.
     */
    public static Bitmap cropPreviewRegion(
            Bitmap source,
            RectF frameInView,
            int previewWidth,
            int previewHeight
    ) {
        return cropPreviewRegionDetailed(source, frameInView, previewWidth, previewHeight).bitmap;
    }

    public static PreviewCrop cropPreviewRegionDetailed(
            Bitmap source,
            RectF frameInView,
            int previewWidth,
            int previewHeight
    ) {
        if (previewWidth <= 0 || previewHeight <= 0 || frameInView.isEmpty()) {
            Bitmap fallback = scaleDown(source, 2200);
            return new PreviewCrop(fallback, new RectF(0, 0, source.getWidth(), source.getHeight()));
        }
        float scale = Math.max(
                previewWidth / (float) source.getWidth(),
                previewHeight / (float) source.getHeight()
        );
        float displayedWidth = source.getWidth() * scale;
        float displayedHeight = source.getHeight() * scale;
        float hiddenX = (displayedWidth - previewWidth) / 2f;
        float hiddenY = (displayedHeight - previewHeight) / 2f;

        // The overlay is only the allowed search region. Keep a small guard band so preview
        // rounding, sensor rotation and a card touching the guide cannot remove a real edge.
        float paddingX = frameInView.width() * 0.025f;
        float paddingY = frameInView.height() * 0.025f;
        RectF padded = new RectF(frameInView);
        padded.inset(-paddingX, -paddingY);
        int left = clamp(Math.round((padded.left + hiddenX) / scale), 0, source.getWidth() - 2);
        int top = clamp(Math.round((padded.top + hiddenY) / scale), 0, source.getHeight() - 2);
        int right = clamp(Math.round((padded.right + hiddenX) / scale), left + 2, source.getWidth());
        int bottom = clamp(Math.round((padded.bottom + hiddenY) / scale), top + 2, source.getHeight());
        Bitmap cropped = Bitmap.createBitmap(source, left, top, right - left, bottom - top);
        Bitmap scaled = scaleDown(cropped, 2200);
        if (scaled != cropped && cropped != source) {
            cropped.recycle();
        }
        return new PreviewCrop(scaled, new RectF(left, top, right, bottom));
    }

    /** Maps the stabilized live polygon through the same FILL_CENTER/ViewPort geometry. */
    public static PointF[] mapPreviewQuadToCrop(
            PointF[] previewQuad,
            int previewWidth,
            int previewHeight,
            int captureWidth,
            int captureHeight,
            PreviewCrop crop
    ) {
        if (previewQuad == null || previewQuad.length != 4 || previewWidth <= 0 || previewHeight <= 0) {
            return null;
        }
        float scale = Math.max(previewWidth / (float) captureWidth,
                previewHeight / (float) captureHeight);
        float hiddenX = (captureWidth * scale - previewWidth) / 2f;
        float hiddenY = (captureHeight * scale - previewHeight) / 2f;
        float cropScaleX = crop.bitmap.getWidth() / Math.max(1f, crop.sourceRect.width());
        float cropScaleY = crop.bitmap.getHeight() / Math.max(1f, crop.sourceRect.height());
        PointF[] mapped = new PointF[4];
        for (int index = 0; index < 4; index++) {
            float sourceX = (previewQuad[index].x + hiddenX) / scale;
            float sourceY = (previewQuad[index].y + hiddenY) / scale;
            mapped[index] = new PointF(
                    (sourceX - crop.sourceRect.left) * cropScaleX,
                    (sourceY - crop.sourceRect.top) * cropScaleY);
        }
        return mapped;
    }

    /** Returns OCR passes covering rotation, scale, contrast, lighting and a rectified card area. */
    public static List<OcrVariant> createOcrVariants(Bitmap source) {
        Bitmap scaled = scaleDown(source, 1800);
        // Never trust the source aspect ratio alone: the camera guide is also 63:88 while a
        // smaller physical card and substantial background can still be inside it.
        VisualPreparation preparation = prepareDetailed(
                scaled, true, NORMALIZED_WIDTH, NORMALIZED_HEIGHT);
        Bitmap base = preparation.bitmap;
        List<OcrVariant> variants = new ArrayList<>();

        int[] rotations = {0, 90, 180, 270};
        for (int rotation : rotations) {
            Bitmap rotated = rotate(base, rotation);
            Bitmap normal = scaleDown(rotated, 1500);
            variants.add(new OcrVariant("vollbild-" + rotation, normal));

            float ratio = normal.getWidth() / (float) normal.getHeight();
            if (ratio >= 0.42f && ratio <= 1.08f) {
                Bitmap card = fitCardToCanvas(normal, NORMALIZED_WIDTH, NORMALIZED_HEIGHT);
                variants.add(new OcrVariant("karte-kontrast-" + rotation, enhanceForOcr(card)));
                addHeaderOcrVariants(variants, card, rotation);
                addSecondaryHeaderOcrVariants(variants, card, rotation);
                addMiddleTextOcrVariants(variants, card, rotation);
                addLowerTextOcrVariant(variants, card, rotation);
                addCollectorOcrVariants(variants, card, rotation);
                if (card != normal) {
                    card.recycle();
                }
            }
            if (rotated != normal) {
                rotated.recycle();
            }
        }

        if (scaled != source && !scaled.isRecycled()) {
            scaled.recycle();
        }
        // A small source can itself be the 0-degree full-image OCR variant.
        // Never recycle caller-owned or still-enqueued bitmaps here.
        if (!isVariantBitmap(variants, base) && !base.isRecycled()) {
            base.recycle();
        }
        return variants;
    }

    /**
     * Four inexpensive whole-card probes used only to determine upright orientation. Full
     * regional OCR is intentionally not created here.
     */
    public static List<OcrVariant> createOrientationOcrVariants(Bitmap source) {
        Bitmap base = scaleDown(source, 920);
        List<OcrVariant> variants = new ArrayList<>();
        for (int rotation : new int[]{0, 90, 180, 270}) {
            Bitmap rotated = rotate(base, rotation);
            Bitmap probe = scaleDown(rotated, 760);
            variants.add(new OcrVariant("orientierung-" + rotation, probe));
            if (rotated != probe && !rotated.isRecycled()) rotated.recycle();
        }
        if (base != source && !base.isRecycled()) base.recycle();
        return variants;
    }

    /**
     * Creates detailed OCR only for the already selected upright rotation and TCG profile.
     * This replaces the former 4x multiplication of every high-resolution OCR region.
     */
    public static List<OcrVariant> createProfileOcrVariants(
            Bitmap source,
            int rotation,
            String profile
    ) {
        int normalizedRotation = ((rotation % 360) + 360) % 360;
        Bitmap rotated = rotate(source, normalizedRotation);
        Bitmap normal = scaleDown(rotated, 1500);
        List<OcrVariant> variants = new ArrayList<>();
        variants.add(new OcrVariant("vollbild-" + normalizedRotation, normal));

        float ratio = Math.min(normal.getWidth(), normal.getHeight())
                / (float) Math.max(1, Math.max(normal.getWidth(), normal.getHeight()));
        if (ratio >= 0.42f && ratio <= 0.80f) {
            // The normalized geometry stays authoritative; a rotation only changes text
            // orientation. A 180-degree correction remains portrait and is the common case.
            Bitmap card = normal.getWidth() <= normal.getHeight()
                    ? fitCardToCanvas(normal, NORMALIZED_WIDTH, NORMALIZED_HEIGHT)
                    : normal.copy(Bitmap.Config.ARGB_8888, false);
            String kind = String.valueOf(profile == null ? "auto" : profile).toLowerCase();
            if ("yugioh".equals(kind)) {
                addHeaderOcrVariants(variants, card, normalizedRotation);
                addYuGiOhMetadataOcrVariants(variants, card, normalizedRotation);
            } else if ("onepiece".equals(kind)) {
                addOnePieceNameOcrVariants(variants, card, normalizedRotation);
                addOnePieceMetadataOcrVariants(variants, card, normalizedRotation);
            } else {
                addHeaderOcrVariants(variants, card, normalizedRotation);
                addSecondaryHeaderOcrVariants(variants, card, normalizedRotation);
                addMiddleTextOcrVariants(variants, card, normalizedRotation);
                addLowerTextOcrVariant(variants, card, normalizedRotation);
                addCollectorOcrVariants(variants, card, normalizedRotation);
            }
            if (card != normal && !card.isRecycled()) card.recycle();
        }
        if (rotated != normal && !rotated.isRecycled()) rotated.recycle();
        return variants;
    }

    private static boolean isVariantBitmap(List<OcrVariant> variants, Bitmap bitmap) {
        for (OcrVariant variant : variants) {
            if (variant.bitmap == bitmap) {
                return true;
            }
        }
        return false;
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
        return prepareDetailed(source, attemptPerspectiveCorrection, 378, 528);
    }

    /** High-resolution authoritative card crop used by CameraActivity before saving the scan. */
    public static VisualPreparation prepareCapturedCardDetailed(Bitmap source) {
        return prepareDetailed(source, true, NORMALIZED_WIDTH, NORMALIZED_HEIGHT, null, 0f);
    }

    /** High-resolution crop seeded by the live polygon after coordinate transformation. */
    public static VisualPreparation prepareCapturedCardDetailed(
            Bitmap source,
            PointF[] preferredQuad,
            float preferredConfidence
    ) {
        return prepareDetailed(source, true, NORMALIZED_WIDTH, NORMALIZED_HEIGHT,
                preferredQuad, preferredConfidence);
    }

    private static VisualPreparation prepareDetailed(
            Bitmap source,
            boolean attemptPerspectiveCorrection,
            int targetWidth,
            int targetHeight
    ) {
        return prepareDetailed(source, attemptPerspectiveCorrection, targetWidth, targetHeight, null, 0f);
    }

    private static VisualPreparation prepareDetailed(
            Bitmap source,
            boolean attemptPerspectiveCorrection,
            int targetWidth,
            int targetHeight,
            PointF[] preferredQuad,
            float preferredConfidence
    ) {
        Bitmap scaled = scaleDown(source, 1600);
        Bitmap detectionBitmap = attemptPerspectiveCorrection ? scaleDown(scaled, 640) : null;
        CardDetection smallDetection = detectionBitmap == null ? null : detectCard(detectionBitmap);
        CardDetection detection = smallDetection == null ? null : scaleDetection(
                smallDetection,
                scaled.getWidth() / (float) Math.max(1, detectionBitmap.getWidth()),
                scaled.getHeight() / (float) Math.max(1, detectionBitmap.getHeight())
        );
        if (attemptPerspectiveCorrection && preferredQuad != null && preferredQuad.length == 4
                && preferredConfidence >= 0.60f) {
            PointF[] scaledPreferred = copyPoints(preferredQuad);
            float scaleX = scaled.getWidth() / (float) Math.max(1, source.getWidth());
            float scaleY = scaled.getHeight() / (float) Math.max(1, source.getHeight());
            for (PointF point : scaledPreferred) {
                point.x *= scaleX;
                point.y *= scaleY;
            }
            CardDetection live = detectionFromQuad(scaledPreferred, scaled.getWidth(), scaled.getHeight(),
                    preferredConfidence);
            if (live != null && (detection == null
                    || detection.confidence < MIN_PERSPECTIVE_CONFIDENCE
                    || meanCornerDistance(live.quad, detection.quad, scaled.getWidth(), scaled.getHeight()) < 0.075f)) {
                detection = live.confidence >= (detection == null ? 0f : detection.confidence * 0.88f)
                        ? live : detection;
            }
        }
        if (detectionBitmap != null && !detectionBitmap.isRecycled()) detectionBitmap.recycle();
        float safetyMargin = detection == null
                ? LOW_CONFIDENCE_MARGIN : safetyMarginForConfidence(detection.confidence);
        boolean usePerspective = detection != null
                && detection.confidence >= MIN_PERSPECTIVE_CONFIDENCE
                && detection.borderCompleteness >= 0.50f;
        Bitmap rectified = usePerspective
                ? rectifyCard(scaled, detection.quad, safetyMargin) : null;
        // A weak quadrilateral is never blindly warped. A conservative axis-aligned crop may
        // remove obvious table/background, otherwise the complete guide ROI is retained.
        FallbackCrop boundedFallback = rectified == null ? cropLikelyCardBounds(scaled) : null;
        Bitmap base = rectified != null
                ? rectified : boundedFallback != null ? boundedFallback.bitmap : scaled;
        boolean landscapeOrientation = base.getWidth() > base.getHeight();
        Bitmap oriented = landscapeOrientation ? rotate(base, 90) : base;
        int detectionWidth = scaled.getWidth();
        int detectionHeight = scaled.getHeight();

        Bitmap normalized = fitCardToCanvas(oriented, targetWidth, targetHeight);
        if (oriented != base && !oriented.isRecycled() && oriented != normalized) {
            oriented.recycle();
        }
        if (rectified != null && !rectified.isRecycled() && rectified != normalized) {
            rectified.recycle();
        }
        if (boundedFallback != null && !boundedFallback.bitmap.isRecycled()
                && boundedFallback.bitmap != normalized) {
            boundedFallback.bitmap.recycle();
        }
        if (scaled != source && !scaled.isRecycled() && scaled != normalized) {
            scaled.recycle();
        }
        PointF[] sourceQuad = null;
        if (detection != null) {
            float sourceScaleX = source.getWidth() / (float) Math.max(1, detectionWidth);
            float sourceScaleY = source.getHeight() / (float) Math.max(1, detectionHeight);
            sourceQuad = copyPoints(detection.quad);
            for (PointF point : sourceQuad) {
                point.x *= sourceScaleX;
                point.y *= sourceScaleY;
            }
        }
        float confidence = !attemptPerspectiveCorrection ? 1f
                : rectified != null ? detection.confidence
                : boundedFallback != null ? boundedFallback.confidence : 0.16f;
        float coverage = detection != null ? detection.coverage
                : boundedFallback != null ? boundedFallback.coverage : 1f;
        float aspectRatio = detection != null ? detection.aspectRatio
                : boundedFallback != null ? boundedFallback.aspectRatio
                : Math.min(source.getWidth(), source.getHeight())
                    / (float) Math.max(1, Math.max(source.getWidth(), source.getHeight()));
        boolean borderComplete = detection != null
                ? detection.borderCompleteness >= 0.50f
                : boundedFallback != null && boundedFallback.borderComplete;
        return new VisualPreparation(
                normalized,
                !attemptPerspectiveCorrection
                        || (rectified != null && confidence >= RELIABLE_DETECTION && borderComplete),
                attemptPerspectiveCorrection
                        ? rectified != null
                            ? "detected-perspective"
                            : boundedFallback != null
                                ? "bounded-card-fallback"
                                : "search-region-fallback"
                        : "reference-normalized",
                confidence,
                coverage,
                attemptPerspectiveCorrection && rectified == null,
                sourceQuad,
                aspectRatio,
                attemptPerspectiveCorrection ? safetyMargin : 0f,
                detection == null ? 0f : detection.rotationDegrees
                        + (landscapeOrientation ? 90f : 0f),
                detection != null && detection.quad != null && detection.quad.length == 4,
                rectified != null,
                borderComplete
        );
    }

    private static CardDetection detectionFromQuad(PointF[] quad, int width, int height, float confidence) {
        if (quad == null || quad.length != 4) return null;
        float top = distance(quad[0], quad[1]);
        float right = distance(quad[1], quad[2]);
        float bottom = distance(quad[2], quad[3]);
        float left = distance(quad[3], quad[0]);
        float shortSide = Math.min((top + bottom) * 0.5f, (left + right) * 0.5f);
        float longSide = Math.max((top + bottom) * 0.5f, (left + right) * 0.5f);
        float aspect = shortSide / Math.max(1f, longSide);
        float area = Math.abs(polygonArea(quad));
        float coverage = area / Math.max(1f, width * height);
        if (aspect < 0.48f || aspect > 0.88f || coverage < 0.10f) return null;
        float margin = Math.min(Math.min(quad[0].x, width - quad[1].x),
                Math.min(quad[0].y, height - quad[3].y));
        float border = margin >= -Math.max(width, height) * 0.02f ? 0.75f : 0.25f;
        float rotation = (float) Math.toDegrees(Math.atan2(
                quad[1].y - quad[0].y, quad[1].x - quad[0].x));
        return new CardDetection(copyPoints(quad), clamp01(confidence), coverage, aspect, rotation, border);
    }

    private static float meanCornerDistance(PointF[] first, PointF[] second, int width, int height) {
        float diagonal = (float) Math.hypot(width, height);
        float sum = 0f;
        for (int index = 0; index < 4; index++) sum += distance(first[index], second[index]);
        return sum / Math.max(1f, 4f * diagonal);
    }

    private static CardDetection scaleDetection(CardDetection detection, float scaleX, float scaleY) {
        PointF[] quad = copyPoints(detection.quad);
        for (PointF point : quad) {
            point.x *= scaleX;
            point.y *= scaleY;
        }
        return new CardDetection(
                quad,
                detection.confidence,
                detection.coverage,
                detection.aspectRatio,
                detection.rotationDegrees,
                detection.borderCompleteness
        );
    }

    /** Axis-aligned fallback that removes table/background even when four-point fitting is weak. */
    private static FallbackCrop cropLikelyCardBounds(Bitmap source) {
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
        float coverage = rectangleWidth * rectangleHeight / Math.max(1f, width * height);
        float verticalPeakRatio = peakRatio(verticalEnergy, left, right);
        float horizontalPeakRatio = peakRatio(horizontalEnergy, top, bottom);
        boolean plausible = rectangleWidth >= width * 0.24f
                && rectangleHeight >= height * 0.24f
                && coverage >= 0.14f
                && portraitRatio >= 0.22f
                && portraitRatio <= 0.94f
                && verticalPeakRatio >= 1.06f
                && horizontalPeakRatio >= 1.06f;
        if (!plausible) {
            if (analysis != source) analysis.recycle();
            return null;
        }

        float scaleX = source.getWidth() / (float) width;
        float scaleY = source.getHeight() / (float) height;
        int paddingX = Math.max(1, Math.round(rectangleWidth * scaleX * 0.035f));
        int paddingY = Math.max(1, Math.round(rectangleHeight * scaleY * 0.035f));
        int cropLeft = clamp(Math.round(left * scaleX) - paddingX, 0, source.getWidth() - 2);
        int cropTop = clamp(Math.round(top * scaleY) - paddingY, 0, source.getHeight() - 2);
        int cropRight = clamp(Math.round(right * scaleX) + paddingX, cropLeft + 2, source.getWidth());
        int cropBottom = clamp(Math.round(bottom * scaleY) + paddingY, cropTop + 2, source.getHeight());
        if (analysis != source) analysis.recycle();
        Bitmap bitmap = Bitmap.createBitmap(
                source,
                cropLeft,
                cropTop,
                cropRight - cropLeft,
                cropBottom - cropTop
        );
        float aspectScore = tradingCardAspectScore(portraitRatio, 0.50f);
        float edgeScore = clamp01((Math.min(verticalPeakRatio, horizontalPeakRatio) - 1f) / 1.5f);
        float coverageScore = clamp01((coverage - 0.12f) / 0.48f);
        float confidence = clamp01(0.18f + aspectScore * 0.15f
                + edgeScore * 0.16f + coverageScore * 0.08f);
        boolean borderComplete = left > width * 0.008f && top > height * 0.008f
                && right < width * 0.992f && bottom < height * 0.992f;
        return new FallbackCrop(bitmap, confidence, coverage, portraitRatio, borderComplete);
    }

    /** Attempts a four-point document transform. Returns null when the edge evidence is weak. */
    public static Bitmap rectifyCard(Bitmap source) {
        Bitmap analysis = scaleDown(source, 520);
        CardDetection detection = detectCard(analysis);
        if (detection == null) {
            if (analysis != source) {
                analysis.recycle();
            }
            return null;
        }

        float scaleX = source.getWidth() / (float) analysis.getWidth();
        float scaleY = source.getHeight() / (float) analysis.getHeight();
        PointF[] quad = new PointF[4];
        for (int i = 0; i < 4; i++) {
            quad[i] = new PointF(detection.quad[i].x * scaleX, detection.quad[i].y * scaleY);
        }
        if (analysis != source) {
            analysis.recycle();
        }
        return rectifyCard(source, quad, safetyMarginForConfidence(detection.confidence));
    }

    private static float safetyMarginForConfidence(float confidence) {
        if (confidence >= 0.80f) return HIGH_CONFIDENCE_MARGIN;
        if (confidence >= RELIABLE_DETECTION) return NORMAL_DETECTION_MARGIN;
        return LOW_CONFIDENCE_MARGIN;
    }

    private static Bitmap rectifyCard(Bitmap source, PointF[] detectedQuad, float safetyMargin) {
        PointF[] quad = copyPoints(detectedQuad);
        expandQuad(quad, source.getWidth(), source.getHeight(), safetyMargin);

        float width = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2f;
        float height = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2f;
        boolean portrait = width <= height;
        // Preserve the detected physical geometry. Pokémon/One Piece are close to 63:88,
        // while Yu-Gi-Oh! is slightly narrower; the common canvas later uses contain/letterbox.
        float detectedRatio = clamp(shortLongRatio(width, height), 0.62f, 0.79f);
        int shortPixels = Math.max(780, Math.round(NORMALIZED_HEIGHT * detectedRatio));
        int outputWidth = portrait ? shortPixels : NORMALIZED_HEIGHT;
        int outputHeight = portrait ? NORMALIZED_HEIGHT : shortPixels;

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

    /**
     * Finds the printed card, not the guide frame. Several edge pairs are evaluated before the
     * best rectangle is line-fitted, which avoids locking onto one strong artwork/text-box edge.
     */
    private static CardDetection detectCard(Bitmap bitmap) {
        return detectCard(bitmap, false);
    }

    private static CardDetection detectCard(Bitmap bitmap, boolean fastPreview) {
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

        // Text boxes can contain more strong lines than the outer border. Keep enough separated
        // hypotheses so a low-contrast rounded bottom/top edge is still evaluated.
        int sidePeakCount = fastPreview ? 4 : 11;
        int horizontalPeakCount = fastPreview ? 5 : 18;
        int rectangleLimit = fastPreview ? 6 : 40;
        int[] leftPeaks = strongestSeparatedPeaks(
                verticalEnergy, 1, Math.round(width * 0.49f), sidePeakCount);
        int[] rightPeaks = strongestSeparatedPeaks(
                verticalEnergy, Math.round(width * 0.51f), width - 2, sidePeakCount);
        // Cards contain many strong horizontal attack/rule lines. Keep a wider horizontal pool so
        // a rounded or reflection-softened physical top/bottom edge is not discarded too early.
        int[] topPeaks = strongestSeparatedPeaks(
                horizontalEnergy, 1, Math.round(height * 0.49f), horizontalPeakCount);
        int[] bottomPeaks = strongestSeparatedPeaks(
                horizontalEnergy, Math.round(height * 0.51f), height - 2, horizontalPeakCount);
        List<RectCandidate> rectangles = new ArrayList<>();
        float verticalMean = mean(verticalEnergy);
        float horizontalMean = mean(horizontalEnergy);
        for (int left : leftPeaks) {
            for (int right : rightPeaks) {
                for (int top : topPeaks) {
                    for (int bottom : bottomPeaks) {
                        float candidateWidth = right - left;
                        float candidateHeight = bottom - top;
                        float coverage = candidateWidth * candidateHeight / Math.max(1f, width * height);
                        if (candidateWidth < width * 0.25f || candidateHeight < height * 0.25f
                                || coverage < 0.16f) continue;
                        float ratio = Math.min(candidateWidth, candidateHeight)
                                / Math.max(candidateWidth, candidateHeight);
                        if (ratio < 0.22f || ratio > 0.94f) continue;
                        float aspectScore = tradingCardAspectScore(ratio, 0.15f);
                        float edgeScore = clamp01(((verticalEnergy[left] + verticalEnergy[right])
                                / Math.max(1f, 2f * verticalMean) - 1f) / 2.3f);
                        edgeScore = (edgeScore + clamp01(((horizontalEnergy[top] + horizontalEnergy[bottom])
                                / Math.max(1f, 2f * horizontalMean) - 1f) / 2.3f)) / 2f;
                        float coverageScore = clamp01((coverage - 0.10f) / 0.48f);
                        float centerX = (left + right) / 2f;
                        float centerY = (top + bottom) / 2f;
                        float centerScore = clamp01(1f - (float) Math.hypot(
                                (centerX - width / 2f) / width,
                                (centerY - height / 2f) / height
                        ) * 2.2f);
                        insertRectangle(rectangles, new RectCandidate(
                                left, top, right, bottom,
                                aspectScore * 0.53f + edgeScore * 0.22f
                                        + coverageScore * 0.15f + centerScore * 0.10f
                        ), rectangleLimit);
                    }
                }
            }
        }

        float baselineGradient = averageGradient(luminance, width, height);
        CardDetection best = null;
        float bestScore = 0f;
        for (RectCandidate rectangle : rectangles) {
            LinearLine topLine = fitHorizontal(
                    luminance, width, height, rectangle.left, rectangle.right, rectangle.top);
            LinearLine bottomLine = fitHorizontal(
                    luminance, width, height, rectangle.left, rectangle.right, rectangle.bottom);
            LinearLine leftLine = fitVertical(
                    luminance, width, height, rectangle.top, rectangle.bottom, rectangle.left);
            LinearLine rightLine = fitVertical(
                    luminance, width, height, rectangle.top, rectangle.bottom, rectangle.right);
            if (topLine == null || bottomLine == null || leftLine == null || rightLine == null) continue;

            PointF[] quad = {
                    intersect(topLine, leftLine),
                    intersect(topLine, rightLine),
                    intersect(bottomLine, rightLine),
                    intersect(bottomLine, leftLine)
            };
            if (!fastPreview) {
                extendToSideEdgeEndpoints(
                        luminance, width, height, quad, leftLine, rightLine, baselineGradient);
            }
            if (!plausibleQuad(quad, width, height)) continue;
            float area = polygonArea(quad);
            float averageWidth = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2f;
            float averageHeight = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2f;
            float ratio = Math.min(averageWidth, averageHeight) / Math.max(1f, Math.max(averageWidth, averageHeight));
            float topWidth = distance(quad[0], quad[1]);
            float bottomWidth = distance(quad[3], quad[2]);
            float leftHeight = distance(quad[0], quad[3]);
            float rightHeight = distance(quad[1], quad[2]);
            float oppositeBalance = Math.min(
                    Math.min(topWidth, bottomWidth) / Math.max(1f, Math.max(topWidth, bottomWidth)),
                    Math.min(leftHeight, rightHeight) / Math.max(1f, Math.max(leftHeight, rightHeight))
            );
            // Multiple real TCG ratios are accepted, but an internally balanced rectangle far
            // from every known physical-card ratio must not outrank the actual outer edge.
            float aspectTolerance = 0.07f + (1f - oppositeBalance) * 0.55f;
            float aspectScore = tradingCardAspectScore(ratio, aspectTolerance);
            float coverage = area / Math.max(1f, width * height);
            float coverageScore = clamp01((coverage - 0.10f) / 0.48f);
            float geometryScore = quadGeometryScore(quad);
            float borderCompleteness = quadBorderCompleteness(quad, width, height);
            float score;
            if (fastPreview) {
                // Projection strength, aspect, geometry and completeness are sufficient for the
                // guide polygon. Expensive edge-continuity sampling is reserved for capture.
                score = rectangle.score * 0.48f
                        + aspectScore * 0.25f
                        + coverageScore * 0.08f
                        + geometryScore * 0.11f
                        + borderCompleteness * 0.08f;
            } else {
                EdgeEvidence evidence = edgeEvidence(
                        pixels, luminance, width, height, quad, baselineGradient);
                float endpointTermination = endpointTerminationScore(
                        luminance, width, height, quad, leftLine, rightLine, baselineGradient);
                score = aspectScore * 0.33f
                        + evidence.strength * 0.10f
                        + evidence.continuity * 0.12f
                        + evidence.separation * 0.15f
                        + coverageScore * 0.04f
                        + geometryScore * 0.06f
                        + endpointTermination * 0.16f
                        + borderCompleteness * 0.04f;
            }
            if (score > bestScore) {
                bestScore = score;
                best = new CardDetection(
                        quad,
                        score,
                        coverage,
                        ratio,
                        (float) Math.toDegrees(Math.atan2(
                                quad[1].y - quad[0].y,
                                quad[1].x - quad[0].x)),
                        borderCompleteness
                );
            }
        }
        // Weak evidence must not trigger an aggressive four-corner crop.
        return best != null && best.confidence >= 0.43f ? best : null;
    }

    /**
     * An internal header/footer rule can look like an ideal 63:88 rectangle. If both real side
     * borders visibly continue beyond that line, follow them to their endpoints so title and
     * collector/copyright rows remain inside the quadrilateral.
     */
    private static void extendToSideEdgeEndpoints(
            int[] luminance,
            int width,
            int height,
            PointF[] quad,
            LinearLine leftLine,
            LinearLine rightLine,
            float baselineGradient
    ) {
        if (quad == null || quad.length != 4) return;
        float averageHeight = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2f;
        int maximum = Math.max(4, Math.round(averageHeight * 0.16f));
        int minimumUseful = Math.max(3, Math.round(averageHeight * 0.035f));
        float threshold = Math.max(8f, baselineGradient * 0.88f);

        int leftBottomExtension = singleSideContinuation(
                luminance, width, height, quad[3].y, leftLine, 1, maximum, threshold);
        int rightBottomExtension = singleSideContinuation(
                luminance, width, height, quad[2].y, rightLine, 1, maximum, threshold);
        int bottomClosure = horizontalClosureOffset(
                luminance, width, height, quad[3].y, leftLine, rightLine,
                1, maximum, baselineGradient);
        // Extend an endpoint only when both physical side borders agree. A single diagonal
        // background pattern or shadow must never pull one corner away from the card. Prefer the
        // first continuous horizontal closure across the card: unlike a diagonal table pattern,
        // the physical bottom edge terminates both side borders at the same y position.
        if (bottomClosure >= minimumUseful) {
            float leftY = Math.min(height - 1f, quad[3].y + bottomClosure);
            float rightY = Math.min(height - 1f, quad[2].y + bottomClosure);
            quad[3].set(leftLine.slope * leftY + leftLine.intercept, leftY);
            quad[2].set(rightLine.slope * rightY + rightLine.intercept, rightY);
        } else if (leftBottomExtension >= minimumUseful && rightBottomExtension >= minimumUseful) {
            float leftY = Math.min(height - 1f, quad[3].y
                    + (leftBottomExtension >= minimumUseful ? leftBottomExtension + 1f : 0f));
            float rightY = Math.min(height - 1f, quad[2].y
                    + (rightBottomExtension >= minimumUseful ? rightBottomExtension + 1f : 0f));
            quad[3].set(leftLine.slope * leftY + leftLine.intercept, leftY);
            quad[2].set(rightLine.slope * rightY + rightLine.intercept, rightY);
        }

        int leftTopExtension = singleSideContinuation(
                luminance, width, height, quad[0].y, leftLine, -1, maximum, threshold);
        int rightTopExtension = singleSideContinuation(
                luminance, width, height, quad[1].y, rightLine, -1, maximum, threshold);
        int topClosure = horizontalClosureOffset(
                luminance, width, height, quad[0].y, leftLine, rightLine,
                -1, maximum, baselineGradient);
        if (topClosure >= minimumUseful) {
            float leftY = Math.max(0f, quad[0].y - topClosure);
            float rightY = Math.max(0f, quad[1].y - topClosure);
            quad[0].set(leftLine.slope * leftY + leftLine.intercept, leftY);
            quad[1].set(rightLine.slope * rightY + rightLine.intercept, rightY);
        } else if (leftTopExtension >= minimumUseful && rightTopExtension >= minimumUseful) {
            float leftY = Math.max(0f, quad[0].y
                    - (leftTopExtension >= minimumUseful ? leftTopExtension + 1f : 0f));
            float rightY = Math.max(0f, quad[1].y
                    - (rightTopExtension >= minimumUseful ? rightTopExtension + 1f : 0f));
            quad[0].set(leftLine.slope * leftY + leftLine.intercept, leftY);
            quad[1].set(rightLine.slope * rightY + rightLine.intercept, rightY);
        }
    }

    /**
     * Finds a broad horizontal edge outside an internal header/footer candidate. Physical card
     * edges cover most of the span between the two side borders; fabric stripes, fingers and
     * shadows normally affect only a few samples on the same row. The strongest plausible closure
     * is returned so anti-aliased or reflective borders remain detectable without following the
     * side lines into the background.
     */
    private static int horizontalClosureOffset(
            int[] luminance,
            int width,
            int height,
            float startY,
            LinearLine leftLine,
            LinearLine rightLine,
            int direction,
            int maximum,
            float baselineGradient
    ) {
        final int sampleCount = 13;
        float threshold = Math.max(11f, baselineGradient * 1.18f);
        float bestStrength = threshold;
        int bestOffset = 0;
        for (int offset = 4; offset <= maximum; offset++) {
            float y = startY + direction * offset;
            if (y < 3 || y >= height - 3) break;
            float leftX = leftLine.slope * y + leftLine.intercept;
            float rightX = rightLine.slope * y + rightLine.intercept;
            if (rightX - leftX < width * 0.18f) continue;
            float sum = 0f;
            int supported = 0;
            for (int sample = 0; sample < sampleCount; sample++) {
                // Avoid the rounded corners; inspect the central 80% of the possible edge.
                float position = 0.10f + 0.80f * sample / (sampleCount - 1f);
                float x = leftX + (rightX - leftX) * position;
                int sx = clamp(Math.round(x), 2, width - 3);
                int sy = clamp(Math.round(y), 2, height - 3);
                float gradient = Math.abs(luminance[(sy + 2) * width + sx]
                        - luminance[(sy - 2) * width + sx]);
                sum += gradient;
                if (gradient >= threshold) supported++;
            }
            float supportRatio = supported / (float) sampleCount;
            float strength = (sum / sampleCount) * (0.55f + supportRatio * 0.45f);
            if (supportRatio >= 0.54f && strength > bestStrength) {
                bestStrength = strength;
                bestOffset = offset;
            }
        }
        return bestOffset;
    }

    private static int singleSideContinuation(
            int[] luminance,
            int width,
            int height,
            float startY,
            LinearLine line,
            int direction,
            int maximum,
            float threshold
    ) {
        int lastSupported = 0;
        int misses = 0;
        int supported = 0;
        int signedMatches = 0;
        int expectedSign = 0;
        for (int offset = 2; offset <= maximum; offset++) {
            float y = startY + direction * offset;
            if (y < 2 || y >= height - 2) break;
            float x = line.slope * y + line.intercept;
            float signedGradient = verticalBorderSignedGradient(luminance, width, height, x, y);
            boolean edgePresent = Math.abs(signedGradient) >= threshold;
            if (edgePresent) {
                supported++;
                int sign = signedGradient >= 0f ? 1 : -1;
                if (expectedSign == 0) expectedSign = sign;
                if (sign == expectedSign) signedMatches++;
                lastSupported = offset;
                misses = 0;
            } else if (++misses > 3) {
                break;
            }
        }
        return supported >= Math.max(4, Math.round(lastSupported * 0.62f))
                && signedMatches >= Math.max(4, Math.round(supported * 0.78f))
                ? lastSupported : 0;
    }

    /**
     * A physical top/bottom corner terminates both side borders. Internal title/artwork boxes form
     * T-junctions where the long card sides visibly continue beyond the candidate line. Penalising
     * those continuations keeps a strong header rule or patterned background out of the final quad.
     */
    private static float endpointTerminationScore(
            int[] luminance,
            int width,
            int height,
            PointF[] quad,
            LinearLine leftLine,
            LinearLine rightLine,
            float baselineGradient
    ) {
        float averageHeight = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2f;
        int sampleLength = Math.max(8, Math.round(averageHeight * 0.07f));
        float threshold = Math.max(9f, baselineGradient * 1.05f);
        float continuation = continuationDensity(
                luminance, width, height, quad[0].y, leftLine, -1, sampleLength, threshold);
        continuation += continuationDensity(
                luminance, width, height, quad[1].y, rightLine, -1, sampleLength, threshold);
        continuation += continuationDensity(
                luminance, width, height, quad[3].y, leftLine, 1, sampleLength, threshold);
        continuation += continuationDensity(
                luminance, width, height, quad[2].y, rightLine, 1, sampleLength, threshold);
        continuation /= 4f;
        return clamp01(1f - Math.max(0f, continuation - 0.10f) / 0.58f);
    }

    private static float continuationDensity(
            int[] luminance,
            int width,
            int height,
            float startY,
            LinearLine line,
            int direction,
            int maximum,
            float threshold
    ) {
        int samples = 0;
        int supported = 0;
        for (int offset = 3; offset <= maximum; offset += 2) {
            float y = startY + direction * offset;
            if (y < 2 || y >= height - 2) break;
            float x = line.slope * y + line.intercept;
            if (Math.abs(verticalBorderSignedGradient(luminance, width, height, x, y)) >= threshold) {
                supported++;
            }
            samples++;
        }
        return supported / (float) Math.max(1, samples);
    }

    private static float verticalBorderSignedGradient(
            int[] luminance, int width, int height, float x, float y
    ) {
        int sampleY = clamp(Math.round(y), 1, height - 2);
        int sampleX = clamp(Math.round(x), 3, width - 4);
        int row = sampleY * width;
        return luminance[row + sampleX + 2] - luminance[row + sampleX - 2];
    }

    private static boolean plausibleQuad(PointF[] quad, int width, int height) {
        if (quad == null || quad.length != 4) return false;
        for (PointF point : quad) {
            if (point == null || point.x < -width * 0.06f || point.y < -height * 0.06f
                    || point.x > width * 1.06f || point.y > height * 1.06f) return false;
        }
        float area = polygonArea(quad);
        if (area < width * height * 0.12f) return false;
        float top = distance(quad[0], quad[1]);
        float right = distance(quad[1], quad[2]);
        float bottom = distance(quad[2], quad[3]);
        float left = distance(quad[3], quad[0]);
        float ratio = Math.min((top + bottom) / 2f, (left + right) / 2f)
                / Math.max(1f, Math.max((top + bottom) / 2f, (left + right) / 2f));
        return ratio >= 0.22f && ratio <= 0.94f
                && Math.min(top, bottom) / Math.max(1f, Math.max(top, bottom)) >= 0.32f
                && Math.min(left, right) / Math.max(1f, Math.max(left, right)) >= 0.32f;
    }

    private static float quadBorderCompleteness(PointF[] quad, int width, int height) {
        float minimum = 1f;
        for (PointF point : quad) {
            minimum = Math.min(minimum, point.x / Math.max(1f, width));
            minimum = Math.min(minimum, point.y / Math.max(1f, height));
            minimum = Math.min(minimum, (width - 1f - point.x) / Math.max(1f, width));
            minimum = Math.min(minimum, (height - 1f - point.y) / Math.max(1f, height));
        }
        return clamp01(minimum / 0.018f);
    }

    private static float quadGeometryScore(PointF[] quad) {
        float score = 0f;
        for (int i = 0; i < 4; i++) {
            PointF previous = quad[(i + 3) % 4];
            PointF center = quad[i];
            PointF next = quad[(i + 1) % 4];
            float ax = previous.x - center.x;
            float ay = previous.y - center.y;
            float bx = next.x - center.x;
            float by = next.y - center.y;
            float denominator = Math.max(1f, (float) Math.hypot(ax, ay) * (float) Math.hypot(bx, by));
            float cosine = Math.abs((ax * bx + ay * by) / denominator);
            score += clamp01(1f - cosine / 0.58f);
        }
        return score / 4f;
    }

    private static EdgeEvidence edgeEvidence(
            int[] pixels,
            int[] luminance,
            int width,
            int height,
            PointF[] quad,
            float baseline
    ) {
        float strength = 0f;
        float continuity = 0f;
        float separation = 0f;
        int count = 0;
        float centerX = 0f;
        float centerY = 0f;
        for (PointF point : quad) {
            centerX += point.x;
            centerY += point.y;
        }
        centerX /= 4f;
        centerY /= 4f;
        float separationStep = Math.max(3f, Math.min(width, height) / 150f);
        for (int side = 0; side < 4; side++) {
            PointF from = quad[side];
            PointF to = quad[(side + 1) % 4];
            float dx = to.x - from.x;
            float dy = to.y - from.y;
            float length = Math.max(1f, (float) Math.hypot(dx, dy));
            float nx = -dy / length;
            float ny = dx / length;
            for (int sample = 2; sample <= 38; sample++) {
                float position = sample / 40f;
                float x = from.x + dx * position;
                float y = from.y + dy * position;
                int x1 = clamp(Math.round(x - nx * 2.2f), 0, width - 1);
                int y1 = clamp(Math.round(y - ny * 2.2f), 0, height - 1);
                int x2 = clamp(Math.round(x + nx * 2.2f), 0, width - 1);
                int y2 = clamp(Math.round(y + ny * 2.2f), 0, height - 1);
                float gradient = Math.abs(luminance[y1 * width + x1] - luminance[y2 * width + x2]);
                strength += clamp01(gradient / Math.max(8f, baseline * 2.7f));
                if (gradient >= Math.max(10f, baseline * 1.15f)) continuity += 1f;

                // Wider inside/outside color separation distinguishes a true outer border from
                // a sharp attack box, rule line or footer line inside the card.
                float inwardX = centerX - x;
                float inwardY = centerY - y;
                float inwardLength = Math.max(1f, (float) Math.hypot(inwardX, inwardY));
                inwardX /= inwardLength;
                inwardY /= inwardLength;
                float redInside = 0f;
                float greenInside = 0f;
                float blueInside = 0f;
                float redOutside = 0f;
                float greenOutside = 0f;
                float blueOutside = 0f;
                for (int offsetIndex = 1; offsetIndex <= 3; offsetIndex++) {
                    float offset = separationStep * offsetIndex;
                    int insideColor = colorAt(pixels, width, height,
                            x + inwardX * offset, y + inwardY * offset);
                    int outsideColor = colorAt(pixels, width, height,
                            x - inwardX * offset, y - inwardY * offset);
                    redInside += (insideColor >> 16) & 0xff;
                    greenInside += (insideColor >> 8) & 0xff;
                    blueInside += insideColor & 0xff;
                    redOutside += (outsideColor >> 16) & 0xff;
                    greenOutside += (outsideColor >> 8) & 0xff;
                    blueOutside += outsideColor & 0xff;
                }
                float redDifference = (redInside - redOutside) / 3f;
                float greenDifference = (greenInside - greenOutside) / 3f;
                float blueDifference = (blueInside - blueOutside) / 3f;
                float colorDistance = (float) Math.sqrt(
                        redDifference * redDifference
                                + greenDifference * greenDifference
                                + blueDifference * blueDifference);
                separation += clamp01(colorDistance / 115f);
                count++;
            }
        }
        return new EdgeEvidence(
                strength / Math.max(1, count),
                continuity / Math.max(1, count),
                separation / Math.max(1, count));
    }

    private static int colorAt(int[] pixels, int width, int height, float x, float y) {
        int sampleX = clamp(Math.round(x), 0, width - 1);
        int sampleY = clamp(Math.round(y), 0, height - 1);
        return pixels[sampleY * width + sampleX];
    }

    private static float averageGradient(int[] luminance, int width, int height) {
        long total = 0L;
        int count = 0;
        for (int y = 3; y < height - 3; y += 4) {
            int row = y * width;
            for (int x = 3; x < width - 3; x += 4) {
                total += Math.abs(luminance[row + x + 1] - luminance[row + x - 1]);
                total += Math.abs(luminance[row + width + x] - luminance[row - width + x]);
                count += 2;
            }
        }
        return total / (float) Math.max(1, count);
    }

    private static int[] strongestSeparatedPeaks(float[] values, int start, int end, int count) {
        int[] result = new int[count];
        boolean[] selected = new boolean[values.length];
        int separation = Math.max(4, values.length / 36);
        for (int slot = 0; slot < count; slot++) {
            int best = clamp(start, 0, values.length - 1);
            float bestValue = -1f;
            for (int index = Math.max(0, start); index <= Math.min(values.length - 1, end); index++) {
                if (!selected[index] && values[index] > bestValue) {
                    bestValue = values[index];
                    best = index;
                }
            }
            result[slot] = best;
            for (int index = Math.max(0, best - separation);
                 index <= Math.min(values.length - 1, best + separation); index++) selected[index] = true;
        }
        return result;
    }

    private static void insertRectangle(List<RectCandidate> values, RectCandidate candidate, int limit) {
        int position = 0;
        while (position < values.size() && values.get(position).score >= candidate.score) position++;
        values.add(position, candidate);
        if (values.size() > limit) values.remove(values.size() - 1);
    }

    private static float mean(float[] values) {
        float sum = 0f;
        for (float value : values) sum += value;
        return sum / Math.max(1, values.length);
    }

    private static float clamp01(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    private static float shortLongRatio(float first, float second) {
        return Math.min(first, second) / Math.max(1f, Math.max(first, second));
    }

    /** Aspect ratio is supporting evidence across multiple physical TCG sizes, never a hard ID. */
    private static float tradingCardAspectScore(float ratio, float tolerance) {
        float pokemonOrOnePiece = Math.abs(ratio - CARD_RATIO);
        float yugioh = Math.abs(ratio - YUGIOH_CARD_RATIO);
        return clamp01(1f - Math.min(pokemonOrOnePiece, yugioh) / Math.max(0.01f, tolerance));
    }

    private static final class RectCandidate {
        final int left;
        final int top;
        final int right;
        final int bottom;
        final float score;

        RectCandidate(int left, int top, int right, int bottom, float score) {
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
            this.score = score;
        }
    }

    private static final class EdgeEvidence {
        final float strength;
        final float continuity;
        final float separation;

        EdgeEvidence(float strength, float continuity, float separation) {
            this.strength = strength;
            this.continuity = continuity;
            this.separation = separation;
        }
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
        // Wide bands let an outer-border hypothesis snap to a stronger header/footer rule.
        int band = Math.max(7, Math.round(height * 0.032f));
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
        return robustFit(points, true, Math.max(2.5f, band * 0.28f), 0.62f);
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
        // A side border moves under perspective, but allowing an unrestricted 16% jump lets a
        // textured table or fabric edge replace a low-contrast card side. Ten percent still
        // covers the supported perspective fixtures while keeping the fit attached to its peak.
        int band = Math.max(9, Math.round(width * 0.10f));
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
        return robustFit(points, false, Math.max(3f, band * 0.10f), 1.45f);
    }

    private static LinearLine robustFit(
            List<PointF> points,
            boolean horizontal,
            float tolerance,
            float maximumSlope
    ) {
        if (points.size() < 5) return null;
        LinearLine best = null;
        float bestScore = -1f;
        List<PointF> bestInliers = null;
        int minimumSeparation = Math.max(3, points.size() / 4);
        for (int first = 0; first < points.size() - minimumSeparation; first++) {
            for (int second = first + minimumSeparation; second < points.size(); second++) {
                PointF a = points.get(first);
                PointF b = points.get(second);
                float independentA = horizontal ? a.x : a.y;
                float independentB = horizontal ? b.x : b.y;
                float dependentA = horizontal ? a.y : a.x;
                float dependentB = horizontal ? b.y : b.x;
                float denominator = independentB - independentA;
                if (Math.abs(denominator) < 1f) continue;
                float slope = (dependentB - dependentA) / denominator;
                if (Math.abs(slope) > maximumSlope) continue;
                float intercept = dependentA - slope * independentA;
                List<PointF> inliers = new ArrayList<>();
                float residual = 0f;
                for (PointF point : points) {
                    float independent = horizontal ? point.x : point.y;
                    float actual = horizontal ? point.y : point.x;
                    float distance = Math.abs(slope * independent + intercept - actual);
                    if (distance <= tolerance) {
                        inliers.add(point);
                        residual += distance;
                    }
                }
                float spanBonus = inliers.isEmpty() ? 0f
                        : Math.abs((horizontal ? inliers.get(inliers.size() - 1).x : inliers.get(inliers.size() - 1).y)
                        - (horizontal ? inliers.get(0).x : inliers.get(0).y)) / 100f;
                float score = inliers.size() * 2f + spanBonus - residual * 0.08f;
                if (score > bestScore) {
                    bestScore = score;
                    best = new LinearLine(slope, intercept, horizontal);
                    bestInliers = inliers;
                }
            }
        }
        if (best == null) {
            LinearLine fallback = leastSquares(points, horizontal);
            return fallback != null && Math.abs(fallback.slope) <= maximumSlope ? fallback : null;
        }
        LinearLine refined = bestInliers != null && bestInliers.size() >= 6
                ? leastSquares(bestInliers, horizontal)
                : null;
        return refined != null && Math.abs(refined.slope) <= maximumSlope ? refined : best;
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

    /** Scales the whole detected card into 63:88 without discarding any edge pixels. */
    private static Bitmap fitCardToCanvas(Bitmap source, int targetWidth, int targetHeight) {
        float factor = Math.min(
                targetWidth / (float) source.getWidth(),
                targetHeight / (float) source.getHeight()
        );
        int width = Math.max(2, Math.min(targetWidth, Math.round(source.getWidth() * factor)));
        int height = Math.max(2, Math.min(targetHeight, Math.round(source.getHeight() * factor)));
        Bitmap scaled = Bitmap.createScaledBitmap(source, width, height, true);
        Bitmap output = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        canvas.drawColor(averageCornerColor(source));
        canvas.drawBitmap(scaled, (targetWidth - width) / 2f, (targetHeight - height) / 2f, null);
        if (scaled != source) scaled.recycle();
        return output;
    }

    private static int averageCornerColor(Bitmap source) {
        int insetX = Math.max(0, Math.min(source.getWidth() - 1, source.getWidth() / 80));
        int insetY = Math.max(0, Math.min(source.getHeight() - 1, source.getHeight() / 80));
        int[] colors = {
                source.getPixel(insetX, insetY),
                source.getPixel(source.getWidth() - 1 - insetX, insetY),
                source.getPixel(source.getWidth() - 1 - insetX, source.getHeight() - 1 - insetY),
                source.getPixel(insetX, source.getHeight() - 1 - insetY)
        };
        int red = 0;
        int green = 0;
        int blue = 0;
        for (int color : colors) {
            red += color >> 16 & 0xff;
            green += color >> 8 & 0xff;
            blue += color & 0xff;
        }
        return 0xff000000 | red / colors.length << 16 | green / colors.length << 8 | blue / colors.length;
    }

    private static void expandQuad(PointF[] quad, int width, int height, float fraction) {
        float centerX = 0f;
        float centerY = 0f;
        for (PointF point : quad) {
            centerX += point.x;
            centerY += point.y;
        }
        centerX /= quad.length;
        centerY /= quad.length;
        // fraction is the requested guard band per side (3% left/right/top/bottom), therefore
        // the full quadrilateral grows by twice that value.
        float factor = 1f + fraction * 2f;
        for (PointF point : quad) {
            point.x = clamp(centerX + (point.x - centerX) * factor, 0f, width - 1f);
            point.y = clamp(centerY + (point.y - centerY) * factor, 0f, height - 1f);
        }
    }

    private static PointF[] copyPoints(PointF[] points) {
        if (points == null) return null;
        PointF[] copy = new PointF[points.length];
        for (int index = 0; index < points.length; index++) {
            copy[index] = new PointF(points[index].x, points[index].y);
        }
        return copy;
    }

    /** Debug-only visualization helper; never used as OCR or matching input. */
    public static Bitmap drawDetectedQuad(Bitmap source, PointF[] quad, boolean reliable) {
        Bitmap output = source.copy(Bitmap.Config.ARGB_8888, true);
        if (quad == null || quad.length != 4) return output;
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(reliable ? 0xff58d7aa : 0xffffb84d);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(3f, Math.min(source.getWidth(), source.getHeight()) / 180f));
        Path path = new Path();
        path.moveTo(quad[0].x, quad[0].y);
        for (int index = 1; index < quad.length; index++) path.lineTo(quad[index].x, quad[index].y);
        path.close();
        canvas.drawPath(path, paint);
        return output;
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

        // A second, tighter 16% metadata ROI gives small collector numbers substantially
        // more pixels without letting attack damage from the lower rule box dominate OCR.
        int metadataTop = Math.max(0, Math.round(card.getHeight() * 0.84f));
        Bitmap metadata = Bitmap.createBitmap(
                card, 0, metadataTop, card.getWidth(), card.getHeight() - metadataTop);
        int metadataWidth = 1800;
        Bitmap metadataLarge = Bitmap.createScaledBitmap(
                metadata,
                metadataWidth,
                Math.max(2, Math.round(metadata.getHeight() * metadataWidth / (float) metadata.getWidth())),
                true
        );
        variants.add(new OcrVariant("unterkante-metadata-normal-" + rotation, metadataLarge));
        Bitmap metadataGray = grayscaleForOcr(metadataLarge);
        variants.add(new OcrVariant("unterkante-metadata-scharf-" + rotation, sharpenForOcr(metadataGray)));
        metadataGray.recycle();
        metadata.recycle();
    }

    /** Yu-Gi-Oh! set code, ATK/DEF and the 8-digit passcode live below the artwork. */
    private static void addYuGiOhMetadataOcrVariants(
            List<OcrVariant> variants, Bitmap card, int rotation
    ) {
        addSemanticRoi(variants, card, 0.54f, 0.86f, 1300,
                "untertext-yugioh-normal-" + rotation, true);
        addSemanticRoi(variants, card, 0.76f, 1f, 1800,
                "unterkante-yugioh-passcode-" + rotation, true);
    }

    /** One Piece character names are physically low on the card but semantically the title. */
    private static void addOnePieceNameOcrVariants(
            List<OcrVariant> variants, Bitmap card, int rotation
    ) {
        addSemanticRoi(variants, card, 0.58f, 0.88f, 1450,
                "kopfzeile-onepiece-normal-" + rotation, true);
    }

    /** One Piece card code and counter metadata are concentrated at the lower/right edge. */
    private static void addOnePieceMetadataOcrVariants(
            List<OcrVariant> variants, Bitmap card, int rotation
    ) {
        addSemanticRoi(variants, card, 0.70f, 1f, 1700,
                "unterkante-onepiece-code-" + rotation, true);
    }

    private static void addSemanticRoi(
            List<OcrVariant> variants,
            Bitmap card,
            float topFraction,
            float bottomFraction,
            int targetWidth,
            String name,
            boolean addEnhanced
    ) {
        int top = clamp(Math.round(card.getHeight() * topFraction), 0, card.getHeight() - 2);
        int bottom = clamp(Math.round(card.getHeight() * bottomFraction), top + 2, card.getHeight());
        Bitmap roi = Bitmap.createBitmap(card, 0, top, card.getWidth(), bottom - top);
        Bitmap scaled = Bitmap.createScaledBitmap(
                roi,
                targetWidth,
                Math.max(2, Math.round(roi.getHeight() * targetWidth / (float) roi.getWidth())),
                true
        );
        variants.add(new OcrVariant(name, scaled));
        if (addEnhanced) variants.add(new OcrVariant(name.replace("-normal-", "-kontrast-"),
                enhanceForOcr(scaled)));
        if (roi != card) roi.recycle();
    }

    /** Stage/evolution line below the title. Kept separate so it cannot become the main title. */
    private static void addSecondaryHeaderOcrVariants(
            List<OcrVariant> variants,
            Bitmap card,
            int rotation
    ) {
        int top = Math.max(0, Math.round(card.getHeight() * 0.11f));
        int bottom = Math.min(card.getHeight(), Math.round(card.getHeight() * 0.31f));
        Bitmap roi = Bitmap.createBitmap(card, 0, top, card.getWidth(), Math.max(2, bottom - top));
        int width = 1200;
        Bitmap scaled = Bitmap.createScaledBitmap(
                roi,
                width,
                Math.max(2, Math.round(roi.getHeight() * width / (float) roi.getWidth())),
                true
        );
        variants.add(new OcrVariant("sekundaer-normal-" + rotation, scaled));
        variants.add(new OcrVariant("sekundaer-grau-" + rotation, grayscaleForOcr(scaled)));
        if (roi != card) roi.recycle();
    }

    /** Attack, ability and trainer rule text used as supporting evidence, never as a title. */
    private static void addMiddleTextOcrVariants(
            List<OcrVariant> variants,
            Bitmap card,
            int rotation
    ) {
        int top = Math.max(0, Math.round(card.getHeight() * 0.34f));
        int bottom = Math.min(card.getHeight(), Math.round(card.getHeight() * 0.78f));
        Bitmap roi = Bitmap.createBitmap(card, 0, top, card.getWidth(), Math.max(2, bottom - top));
        int width = 1200;
        Bitmap scaled = Bitmap.createScaledBitmap(
                roi,
                width,
                Math.max(2, Math.round(roi.getHeight() * width / (float) roi.getWidth())),
                true
        );
        variants.add(new OcrVariant("mitteltext-normal-" + rotation, scaled));
        variants.add(new OcrVariant("mitteltext-kontrast-" + rotation, enhanceForOcr(scaled)));
        if (roi != card) roi.recycle();
    }

    /** Lower rules and weakness/retreat zone, deliberately separate from collector metadata. */
    private static void addLowerTextOcrVariant(
            List<OcrVariant> variants,
            Bitmap card,
            int rotation
    ) {
        int top = Math.max(0, Math.round(card.getHeight() * 0.67f));
        int bottom = Math.min(card.getHeight(), Math.round(card.getHeight() * 0.88f));
        Bitmap roi = Bitmap.createBitmap(card, 0, top, card.getWidth(), Math.max(2, bottom - top));
        int width = 1100;
        Bitmap scaled = Bitmap.createScaledBitmap(
                roi,
                width,
                Math.max(2, Math.round(roi.getHeight() * width / (float) roi.getWidth())),
                true
        );
        variants.add(new OcrVariant("untertext-normal-" + rotation, scaled));
        if (roi != card) roi.recycle();
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

    private static float clamp(float value, float minimum, float maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
