package de.pokefolio.app;

import android.graphics.Bitmap;

/** Lightweight local artwork comparison; OCR and card metadata remain authoritative. */
public final class CardVisualMatcher {
    private CardVisualMatcher() {
    }

    public static final class Result {
        public final double similarity;
        public final double artworkHash;
        public final double structure;
        public final double color;

        Result(double similarity, double artworkHash, double structure, double color) {
            this.similarity = similarity;
            this.artworkHash = artworkHash;
            this.structure = structure;
            this.color = color;
        }
    }

    public static Result compare(Bitmap photographedCard, Bitmap referenceCard) {
        Bitmap left = CardImageProcessor.prepareForVisualComparison(photographedCard, true);
        Bitmap right = CardImageProcessor.prepareForVisualComparison(referenceCard, false);
        try {
            long leftArtworkHash = differenceHash(left, 0.055f, 0.14f, 0.945f, 0.64f);
            long rightArtworkHash = differenceHash(right, 0.055f, 0.14f, 0.945f, 0.64f);
            double artworkHash = 1d - Long.bitCount(leftArtworkHash ^ rightArtworkHash) / 64d;

            long leftWholeHash = differenceHash(left, 0.03f, 0.04f, 0.97f, 0.96f);
            long rightWholeHash = differenceHash(right, 0.03f, 0.04f, 0.97f, 0.96f);
            double wholeHash = 1d - Long.bitCount(leftWholeHash ^ rightWholeHash) / 64d;

            double structure = structureCorrelation(left, right);
            double color = colorGridSimilarity(left, right);
            double combined = clamp(
                    artworkHash * 0.43d
                            + structure * 0.27d
                            + wholeHash * 0.15d
                            + color * 0.15d,
                    0d,
                    1d
            );
            return new Result(combined, artworkHash, structure, color);
        } finally {
            left.recycle();
            right.recycle();
        }
    }

    private static long differenceHash(
            Bitmap source,
            float leftFraction,
            float topFraction,
            float rightFraction,
            float bottomFraction
    ) {
        int left = Math.max(0, Math.round(source.getWidth() * leftFraction));
        int top = Math.max(0, Math.round(source.getHeight() * topFraction));
        int right = Math.min(source.getWidth(), Math.round(source.getWidth() * rightFraction));
        int bottom = Math.min(source.getHeight(), Math.round(source.getHeight() * bottomFraction));
        Bitmap crop = Bitmap.createBitmap(source, left, top, Math.max(2, right - left), Math.max(2, bottom - top));
        Bitmap tiny = Bitmap.createScaledBitmap(crop, 9, 8, true);
        if (crop != source && crop != tiny) crop.recycle();
        long hash = 0L;
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                hash <<= 1;
                if (luminance(tiny.getPixel(x, y)) < luminance(tiny.getPixel(x + 1, y))) {
                    hash |= 1L;
                }
            }
        }
        tiny.recycle();
        return hash;
    }

    /** Pearson correlation over the artwork luminance grid, tolerant of exposure changes. */
    private static double structureCorrelation(Bitmap left, Bitmap right) {
        double[] a = artworkLuminance(left, 16, 12);
        double[] b = artworkLuminance(right, 16, 12);
        double meanA = mean(a);
        double meanB = mean(b);
        double numerator = 0d;
        double squareA = 0d;
        double squareB = 0d;
        for (int index = 0; index < a.length; index++) {
            double centeredA = a[index] - meanA;
            double centeredB = b[index] - meanB;
            numerator += centeredA * centeredB;
            squareA += centeredA * centeredA;
            squareB += centeredB * centeredB;
        }
        if (squareA < 1d || squareB < 1d) return 0.5d;
        return clamp((numerator / Math.sqrt(squareA * squareB) + 1d) / 2d, 0d, 1d);
    }

    private static double colorGridSimilarity(Bitmap left, Bitmap right) {
        Bitmap a = artworkBitmap(left, 8, 6);
        Bitmap b = artworkBitmap(right, 8, 6);
        double difference = 0d;
        for (int y = 0; y < 6; y++) {
            for (int x = 0; x < 8; x++) {
                int ca = a.getPixel(x, y);
                int cb = b.getPixel(x, y);
                difference += Math.abs(((ca >> 16) & 0xff) - ((cb >> 16) & 0xff));
                difference += Math.abs(((ca >> 8) & 0xff) - ((cb >> 8) & 0xff));
                difference += Math.abs((ca & 0xff) - (cb & 0xff));
            }
        }
        a.recycle();
        b.recycle();
        return clamp(1d - difference / (8d * 6d * 3d * 255d), 0d, 1d);
    }

    private static double[] artworkLuminance(Bitmap source, int width, int height) {
        Bitmap artwork = artworkBitmap(source, width, height);
        double[] values = new double[width * height];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                values[y * width + x] = luminance(artwork.getPixel(x, y));
            }
        }
        artwork.recycle();
        return values;
    }

    private static Bitmap artworkBitmap(Bitmap source, int width, int height) {
        int left = Math.round(source.getWidth() * 0.055f);
        int top = Math.round(source.getHeight() * 0.14f);
        int right = Math.round(source.getWidth() * 0.945f);
        int bottom = Math.round(source.getHeight() * 0.64f);
        Bitmap crop = Bitmap.createBitmap(source, left, top, right - left, bottom - top);
        Bitmap output = Bitmap.createScaledBitmap(crop, width, height, true);
        if (crop != source && crop != output) crop.recycle();
        return output;
    }

    private static double luminance(int color) {
        return 0.2126d * ((color >> 16) & 0xff)
                + 0.7152d * ((color >> 8) & 0xff)
                + 0.0722d * (color & 0xff);
    }

    private static double mean(double[] values) {
        double sum = 0d;
        for (double value : values) sum += value;
        return sum / Math.max(1, values.length);
    }

    private static double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
