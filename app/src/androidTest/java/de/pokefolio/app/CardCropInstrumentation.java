package de.pokefolio.app;

import android.app.Instrumentation;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PointF;
import android.graphics.Shader;
import android.os.Bundle;
import android.util.Log;

import java.util.Locale;
import java.io.File;
import java.io.FileOutputStream;

/** Device-side regression suite for the native crop without a third-party test framework. */
public final class CardCropInstrumentation extends Instrumentation {
    private static final String TAG = "PokeFolioCropTest";

    @Override
    public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        start();
    }

    @Override
    public void onStart() {
        Bundle result = new Bundle();
        try {
            int syntheticCases = runCropCases();
            int geometryCases = runPreviewMappingCase() + runSafeFallbackCase() + runTrackingCase();
            int externalCases = runExternalPhotoCases();
            int total = syntheticCases + geometryCases + externalCases;
            result.putString("stream", "\nCardCropInstrumentation: " + total + "/" + total
                    + " crop cases passed\n");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            Log.e(TAG, "Crop regression failed", error);
            result.putString("stream", "\nCardCropInstrumentation FAILED: " + error + "\n");
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    /** Optional real-photo probes are copied into target cache by the local QA script. */
    private int runExternalPhotoCases() throws Exception {
        File inputDirectory = new File(getTargetContext().getCacheDir(), "qa-inputs");
        if (!inputDirectory.isDirectory()) return 0;
        File outputDirectory = new File(getTargetContext().getExternalFilesDir(null), "qa-crop-results");
        if (!outputDirectory.exists() && !outputDirectory.mkdirs()) {
            throw new IllegalStateException("QA output directory could not be created");
        }
        int completed = 0;
        completed += runExternalPhoto(
                new File(inputDirectory, "german-kapuno-photo.jpg"),
                new File(outputDirectory, "german-kapuno-normalized.jpg"),
                true);
        completed += runExternalPhoto(
                new File(inputDirectory, "japanese-starmie-v-photo.jpg"),
                new File(outputDirectory, "japanese-starmie-v-normalized.jpg"),
                false);
        return completed;
    }

    private int runExternalPhoto(File input, File output, boolean requireReliable) throws Exception {
        if (!input.isFile()) return 0;
        Bitmap source = BitmapFactory.decodeFile(input.getAbsolutePath());
        assertTrue(input.getName() + " decoded", source != null);
        CardImageProcessor.PhysicalCardDetection rawDetection =
                CardImageProcessor.analyzePhysicalCard(source);
        CardImageProcessor.VisualPreparation preparation =
                CardImageProcessor.prepareCapturedCardDetailed(source);
        Log.i(TAG, "REAL_PHOTO " + input.getName()
                + " rawConfidence=" + (rawDetection == null ? "none"
                    : String.format(Locale.US, "%.3f", rawDetection.confidence))
                + " method=" + preparation.method
                + " confidence=" + String.format(Locale.US, "%.3f", preparation.confidence)
                + " coverage=" + String.format(Locale.US, "%.3f", preparation.cardCoverage)
                + " fallback=" + preparation.fallbackUsed
                + " quad=" + quadText(preparation.detectedQuad));
        assertTrue(input.getName() + " normalized width", preparation.bitmap.getWidth() == 900);
        assertTrue(input.getName() + " normalized height", preparation.bitmap.getHeight() == 1257);
        if (requireReliable) {
            assertTrue(input.getName() + " real card contour", !preparation.fallbackUsed);
            assertTrue(input.getName() + " real card confidence=" + preparation.confidence,
                    preparation.confidence >= 0.61f);
        }
        try (FileOutputStream stream = new FileOutputStream(output)) {
            assertTrue(input.getName() + " result written",
                    preparation.bitmap.compress(Bitmap.CompressFormat.JPEG, 94, stream));
        }
        Log.i(TAG, "REAL_PHOTO output=" + output.getAbsolutePath());
        preparation.bitmap.recycle();
        source.recycle();
        return 1;
    }

    private String quadText(PointF[] quad) {
        if (quad == null) return "none";
        StringBuilder text = new StringBuilder("[");
        for (int index = 0; index < quad.length; index++) {
            if (index > 0) text.append(';');
            text.append(Math.round(quad[index].x)).append(',').append(Math.round(quad[index].y));
        }
        return text.append(']').toString();
    }

    private int runCropCases() {
        Case[] cases = {
                new Case("center-light", Color.rgb(226, 226, 222), false,
                        quad(250, 210, 950, 210, 950, 1188, 250, 1188)),
                new Case("small-70-percent", Color.rgb(42, 45, 52), false,
                        quad(302, 282, 898, 282, 898, 1115, 302, 1115)),
                new Case("left-pattern", Color.rgb(62, 55, 75), true,
                        quad(125, 245, 795, 235, 815, 1171, 140, 1180)),
                new Case("right-pattern", Color.rgb(105, 82, 58), true,
                        quad(390, 220, 1065, 248, 1040, 1188, 370, 1160)),
                new Case("rotated", Color.rgb(214, 206, 192), false,
                        quad(245, 250, 920, 185, 1000, 1125, 315, 1190)),
                new Case("perspective", Color.rgb(28, 31, 36), false,
                        quad(285, 205, 910, 265, 1015, 1170, 205, 1125)),
                new Case("holo-reflection", Color.rgb(55, 65, 56), true,
                        quad(265, 225, 940, 218, 960, 1160, 248, 1175), true),
                new Case("dark-background", Color.rgb(8, 9, 12), false,
                        quad(275, 230, 930, 230, 930, 1145, 275, 1145)),
                new Case("bright-background", Color.rgb(247, 245, 238), false,
                        quad(270, 225, 935, 232, 928, 1155, 266, 1148)),
                new Case("dark-card-border", Color.rgb(135, 138, 143), false,
                        quad(275, 225, 930, 235, 945, 1155, 260, 1148)),
                new Case("card-in-hand", Color.rgb(187, 139, 112), true,
                        quad(260, 220, 925, 245, 950, 1160, 248, 1148)),
                new Case("german-card", Color.rgb(71, 65, 58), false,
                        quad(292, 245, 905, 210, 955, 1128, 275, 1165)),
                new Case("chinese-card", Color.rgb(36, 43, 51), true,
                        quad(305, 245, 900, 230, 940, 1125, 270, 1155)),
                new Case("japanese-card", Color.rgb(215, 211, 201), false,
                        quad(292, 205, 918, 258, 1000, 1155, 220, 1118))
        };

        for (Case testCase : cases) {
            Bitmap source = makeScene(testCase);
            CardImageProcessor.VisualPreparation preparation =
                    CardImageProcessor.prepareCapturedCardDetailed(source);
            assertTrue(testCase.name + " width", preparation.bitmap.getWidth() == 900);
            assertTrue(testCase.name + " height", preparation.bitmap.getHeight() == 1257);
            assertTrue(testCase.name + " detected", !preparation.fallbackUsed);
            assertTrue(testCase.name + " four corners", preparation.fourCornersDetected);
            assertTrue(testCase.name + " perspective", preparation.perspectiveCorrected);
            assertTrue(testCase.name + " border complete", preparation.borderComplete);
            assertTrue(testCase.name + " reliable confidence=" + preparation.confidence,
                    preparation.confidence >= 0.61f);
            assertTrue(testCase.name + " normalized ratio",
                    Math.abs(preparation.bitmap.getWidth() / (float) preparation.bitmap.getHeight()
                            - 63f / 88f) < 0.002f);
            assertTrue(testCase.name + " adaptive safety margin=" + preparation.safetyMargin,
                    preparation.safetyMargin >= 0.018f && preparation.safetyMargin <= 0.030f);
            assertTrue(testCase.name + " actual card coverage=" + preparation.cardCoverage,
                    preparation.cardCoverage >= 0.20f && preparation.cardCoverage <= 0.78f);
            Log.i(TAG, testCase.name + " method=" + preparation.method
                    + " confidence=" + String.format(Locale.US, "%.3f", preparation.confidence)
                    + " coverage=" + String.format(Locale.US, "%.3f", preparation.cardCoverage)
                    + " aspect=" + String.format(Locale.US, "%.3f", preparation.detectedAspectRatio)
                    + " quad=" + quadText(preparation.detectedQuad));
            writeSyntheticDiagnostic(testCase.name, "source", source);
            writeSyntheticDiagnostic(testCase.name, "normalized", preparation.bitmap);
            assertQuadTracksPhysicalCard(testCase, preparation.detectedQuad);
            int center = preparation.bitmap.getPixel(450, 620);
            assertTrue(testCase.name + " card content", Color.blue(center) > 55);
            if (!testCase.name.contains("dark-card-border")) {
                assertTrue(testCase.name + " complete top border",
                        containsYellowBorder(preparation.bitmap, 0));
                assertTrue(testCase.name + " complete right border",
                        containsYellowBorder(preparation.bitmap, 1));
                assertTrue(testCase.name + " complete bottom border",
                        containsYellowBorder(preparation.bitmap, 2));
                assertTrue(testCase.name + " complete left border",
                        containsYellowBorder(preparation.bitmap, 3));
            }
            preparation.bitmap.recycle();
            source.recycle();
        }
        return cases.length;
    }

    private void writeSyntheticDiagnostic(String caseName, String stage, Bitmap bitmap) {
        try {
            File directory = new File(getTargetContext().getExternalFilesDir(null), "qa-crop-synthetic");
            if (!directory.exists() && !directory.mkdirs()) return;
            try (FileOutputStream stream = new FileOutputStream(
                    new File(directory, caseName + "-" + stage + ".jpg"))) {
                bitmap.compress(Bitmap.CompressFormat.JPEG, 91, stream);
            }
        } catch (Exception error) {
            Log.w(TAG, "Could not persist synthetic diagnostic " + caseName, error);
        }
    }

    private void assertQuadTracksPhysicalCard(Case testCase, PointF[] detected) {
        assertTrue(testCase.name + " detected quad exists", detected != null && detected.length == 4);
        float expectedTop = (testCase.quad[0].y + testCase.quad[1].y) / 2f;
        float expectedRight = (testCase.quad[1].x + testCase.quad[2].x) / 2f;
        float expectedBottom = (testCase.quad[2].y + testCase.quad[3].y) / 2f;
        float expectedLeft = (testCase.quad[3].x + testCase.quad[0].x) / 2f;
        float actualTop = (detected[0].y + detected[1].y) / 2f;
        float actualRight = (detected[1].x + detected[2].x) / 2f;
        float actualBottom = (detected[2].y + detected[3].y) / 2f;
        float actualLeft = (detected[3].x + detected[0].x) / 2f;
        float height = Math.max(1f, expectedBottom - expectedTop);
        float width = Math.max(1f, expectedRight - expectedLeft);
        float verticalTolerance = Math.max(32f, height * 0.05f);
        float horizontalTolerance = Math.max(28f, width * 0.05f);
        assertTrue(testCase.name + " top is complete", actualTop <= expectedTop + 30f);
        assertTrue(testCase.name + " bottom is complete", actualBottom >= expectedBottom - 30f);
        assertTrue(testCase.name + " left is complete", actualLeft <= expectedLeft + 30f);
        assertTrue(testCase.name + " right is complete", actualRight >= expectedRight - 30f);
        assertTrue(testCase.name + " no excessive top background", actualTop >= expectedTop - verticalTolerance);
        assertTrue(testCase.name + " no excessive bottom background", actualBottom <= expectedBottom + verticalTolerance);
        assertTrue(testCase.name + " no excessive left background", actualLeft >= expectedLeft - horizontalTolerance);
        assertTrue(testCase.name + " no excessive right background", actualRight <= expectedRight + horizontalTolerance);
    }

    private int runPreviewMappingCase() {
        Bitmap capture = Bitmap.createBitmap(1600, 1200, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(capture);
        canvas.drawColor(Color.DKGRAY);
        // A square FILL_CENTER preview shows the central 1200x1200 pixels of this 4:3 capture.
        CardImageProcessor.PreviewCrop crop = CardImageProcessor.cropPreviewRegionDetailed(
                capture,
                new android.graphics.RectF(150, 100, 850, 900),
                1000,
                1000
        );
        assertTrue("preview mapping left", Math.abs(crop.sourceRect.left - 359f) <= 3f);
        assertTrue("preview mapping top", Math.abs(crop.sourceRect.top - 96f) <= 3f);
        assertTrue("preview mapping right", Math.abs(crop.sourceRect.right - 1241f) <= 3f);
        assertTrue("preview mapping bottom", Math.abs(crop.sourceRect.bottom - 1104f) <= 3f);
        assertTrue("guide remains search ROI", crop.bitmap.getWidth() > 800
                && crop.bitmap.getHeight() > 980);
        PointF[] previewQuad = quad(260, 190, 740, 190, 740, 830, 260, 830);
        PointF[] mapped = CardImageProcessor.mapPreviewQuadToCrop(
                previewQuad, 1000, 1000, 1600, 1200, crop);
        assertTrue("live quad mapped", mapped != null && mapped.length == 4);
        assertTrue("live quad left maps inside capture ROI", mapped[0].x > 100 && mapped[0].x < 300);
        assertTrue("live quad right maps inside capture ROI", mapped[1].x > 600 && mapped[1].x < 800);
        crop.bitmap.recycle();
        capture.recycle();
        return 1;
    }

    private int runTrackingCase() {
        CardDetectionTracker tracker = new CardDetectionTracker();
        CardDetectionTracker.Snapshot snapshot = null;
        for (int frame = 0; frame < 12; frame++) {
            PointF[] measured = quad(
                    220 + frame % 2, 300, 820, 295 + frame % 2,
                    825 - frame % 2, 1120, 215, 1115 - frame % 2);
            snapshot = tracker.update(measured, 0.92f, 1080, 1920, frame * 66L);
        }
        assertTrue("stable physical quad becomes ready", snapshot != null && snapshot.ready);
        assertTrue("stable score", snapshot.stability >= 0.82f);
        CardDetectionTracker.Snapshot moved = tracker.update(
                quad(340, 410, 940, 405, 945, 1230, 335, 1225),
                0.92f, 1080, 1920, 900L);
        assertTrue("moving card is no longer ready", !moved.ready);
        assertTrue("smoothed corner does not jump", moved.quad[0].x < 340f);
        return 1;
    }

    private int runSafeFallbackCase() {
        Bitmap source = Bitmap.createBitmap(1200, 1400, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(source);
        canvas.drawColor(Color.rgb(86, 88, 91));
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.rgb(92, 94, 97));
        for (int y = 30; y < 1400; y += 64) canvas.drawLine(0, y, 1200, y + 18, paint);
        CardImageProcessor.VisualPreparation preparation =
                CardImageProcessor.prepareCapturedCardDetailed(source);
        Log.i(TAG, "ambiguous method=" + preparation.method
                + " confidence=" + String.format(Locale.US, "%.3f", preparation.confidence)
                + " coverage=" + String.format(Locale.US, "%.3f", preparation.cardCoverage)
                + " aspect=" + String.format(Locale.US, "%.3f", preparation.detectedAspectRatio)
                + " quad=" + quadText(preparation.detectedQuad));
        assertTrue("ambiguous scene is fallback", preparation.fallbackUsed);
        assertTrue("ambiguous scene is not perspective warped", !preparation.perspectiveCorrected);
        assertTrue("ambiguous scene is low confidence", !preparation.reliable);
        assertTrue("fallback still preserves normalized geometry",
                preparation.bitmap.getWidth() == 900 && preparation.bitmap.getHeight() == 1257);
        preparation.bitmap.recycle();
        source.recycle();
        return 1;
    }

    private boolean containsYellowBorder(Bitmap bitmap, int side) {
        int insetX = Math.max(1, Math.round(bitmap.getWidth() * 0.12f));
        int insetY = Math.max(1, Math.round(bitmap.getHeight() * 0.12f));
        int startX = side == 3 ? 0 : side == 1 ? bitmap.getWidth() - insetX : 0;
        int endX = side == 3 ? insetX : side == 1 ? bitmap.getWidth() : bitmap.getWidth();
        int startY = side == 0 ? 0 : side == 2 ? bitmap.getHeight() - insetY : 0;
        int endY = side == 0 ? insetY : side == 2 ? bitmap.getHeight() : bitmap.getHeight();
        int matches = 0;
        for (int y = startY; y < endY; y += 4) {
            for (int x = startX; x < endX; x += 4) {
                int color = bitmap.getPixel(x, y);
                if (Color.red(color) >= 175 && Color.green(color) >= 145 && Color.blue(color) <= 155) {
                    if (++matches >= 18) return true;
                }
            }
        }
        return false;
    }

    private Bitmap makeScene(Case testCase) {
        Bitmap scene = Bitmap.createBitmap(1200, 1400, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(scene);
        canvas.drawColor(testCase.background);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        if (testCase.pattern) {
            paint.setColor(adjust(testCase.background, 24));
            paint.setStrokeWidth(13f);
            for (int offset = -1400; offset < 1600; offset += 92) {
                canvas.drawLine(offset, 0, offset + 1400, 1400, paint);
            }
        }
        if (testCase.name.contains("hand")) {
            paint.setColor(Color.rgb(219, 174, 145));
            canvas.drawOval(155, 315, 1090, 1275, paint);
        }

        Bitmap card = makeCard(testCase.holo, testCase.name.contains("dark-card-border"));
        float[] from = {0, 0, 630, 0, 630, 880, 0, 880};
        float[] to = {
                testCase.quad[0].x, testCase.quad[0].y,
                testCase.quad[1].x, testCase.quad[1].y,
                testCase.quad[2].x, testCase.quad[2].y,
                testCase.quad[3].x, testCase.quad[3].y
        };
        Matrix transform = new Matrix();
        assertTrue(testCase.name + " source transform", transform.setPolyToPoly(from, 0, to, 0, 4));
        canvas.drawBitmap(card, transform, new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG));
        card.recycle();
        return scene;
    }

    private Bitmap makeCard(boolean holo, boolean darkBorder) {
        Bitmap card = Bitmap.createBitmap(630, 880, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(card);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(darkBorder ? Color.rgb(31, 35, 43) : Color.rgb(245, 226, 96));
        canvas.drawRoundRect(1, 1, 629, 879, 22, 22, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(10f);
        paint.setColor(Color.rgb(28, 33, 40));
        canvas.drawRoundRect(8, 8, 622, 872, 18, 18, paint);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.rgb(18, 27, 43));
        canvas.drawRect(38, 45, 592, 122, paint);
        paint.setColor(Color.WHITE);
        paint.setTextSize(37f);
        paint.setFakeBoldText(true);
        canvas.drawText("DAMYTHIR V", 58, 96, paint);
        paint.setTextSize(25f);
        canvas.drawText("220 KP", 485, 95, paint);
        paint.setShader(new LinearGradient(45, 145, 590, 535,
                new int[]{0xff204080, 0xff69b4ce, 0xff552f72}, null, Shader.TileMode.CLAMP));
        canvas.drawRect(42, 145, 588, 535, paint);
        paint.setShader(null);
        paint.setColor(0xfff2ead8);
        canvas.drawRoundRect(42, 560, 588, 810, 12, 12, paint);
        paint.setColor(0xff222831);
        paint.setTextSize(27f);
        canvas.drawText("Vorreiter", 70, 630, paint);
        canvas.drawText("Barrierenstoß                    130", 70, 713, paint);
        paint.setTextSize(20f);
        canvas.drawText("134/189", 66, 838, paint);
        if (holo) {
            paint.setColor(0x82ffffff);
            Path reflection = new Path();
            reflection.moveTo(90, 80);
            reflection.lineTo(230, 80);
            reflection.lineTo(540, 800);
            reflection.lineTo(390, 800);
            reflection.close();
            canvas.drawPath(reflection, paint);
        }
        return card;
    }

    private static int adjust(int color, int delta) {
        return Color.rgb(
                Math.min(255, Color.red(color) + delta),
                Math.min(255, Color.green(color) + delta),
                Math.min(255, Color.blue(color) + delta));
    }

    private static PointF[] quad(float... coordinates) {
        return new PointF[]{
                new PointF(coordinates[0], coordinates[1]),
                new PointF(coordinates[2], coordinates[3]),
                new PointF(coordinates[4], coordinates[5]),
                new PointF(coordinates[6], coordinates[7])
        };
    }

    private static void assertTrue(String message, boolean value) {
        if (!value) throw new AssertionError(message);
    }

    private static final class Case {
        final String name;
        final int background;
        final boolean pattern;
        final PointF[] quad;
        final boolean holo;

        Case(String name, int background, boolean pattern, PointF[] quad) {
            this(name, background, pattern, quad, false);
        }

        Case(String name, int background, boolean pattern, PointF[] quad, boolean holo) {
            this.name = name;
            this.background = background;
            this.pattern = pattern;
            this.quad = quad;
            this.holo = holo;
        }
    }
}
