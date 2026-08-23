package de.pokefolio.app;

import android.graphics.Bitmap;

import java.util.Arrays;

/** Regional, exposure-tolerant card fingerprint without a heavyweight ML dependency. */
public final class CardVisualMatcher {
    private static final Region WHOLE = new Region(0.025f, 0.025f, 0.975f, 0.975f);
    private static final Region HEADER = new Region(0.045f, 0.025f, 0.955f, 0.19f);
    private static final Region ARTWORK = new Region(0.045f, 0.14f, 0.955f, 0.66f);
    private static final Region FOOTER = new Region(0.035f, 0.73f, 0.965f, 0.985f);

    private CardVisualMatcher() {
    }

    public static final class Result {
        public final double similarity;
        public final double whole;
        public final double header;
        public final double artwork;
        public final double footer;
        public final boolean reliable;
        public final String method;

        Result(
                double similarity,
                double whole,
                double header,
                double artwork,
                double footer,
                boolean reliable,
                String method
        ) {
            this.similarity = similarity;
            this.whole = whole;
            this.header = header;
            this.artwork = artwork;
            this.footer = footer;
            this.reliable = reliable;
            this.method = method;
        }
    }

    public static Result compare(Bitmap photographedCard, Bitmap referenceCard) {
        CardImageProcessor.VisualPreparation scan =
                CardImageProcessor.prepareForVisualComparisonDetailed(photographedCard, true);
        CardImageProcessor.VisualPreparation reference =
                CardImageProcessor.prepareForVisualComparisonDetailed(referenceCard, false);
        try {
            return compareNormalized(scan.bitmap, reference.bitmap, scan.reliable, scan.method);
        } finally {
            scan.bitmap.recycle();
            reference.bitmap.recycle();
        }
    }

    public static Result comparePrepared(
            Bitmap preparedScan,
            Bitmap referenceCard,
            boolean reliable,
            String method
    ) {
        CardImageProcessor.VisualPreparation reference =
                CardImageProcessor.prepareForVisualComparisonDetailed(referenceCard, false);
        try {
            return compareNormalized(preparedScan, reference.bitmap, reliable, method);
        } finally {
            reference.bitmap.recycle();
        }
    }

    private static Result compareNormalized(
            Bitmap scan,
            Bitmap reference,
            boolean reliable,
            String method
    ) {
        double whole = compareRegion(scan, reference, WHOLE);
        double header = compareRegion(scan, reference, HEADER);
        double artwork = compareRegion(scan, reference, ARTWORK);
        double footer = compareRegion(scan, reference, FOOTER);
        // Artwork separates print variants most strongly. Header/footer preserve
        // layout generation, HP, set and collector-number structure.
        double combined = clamp(
                whole * 0.16d
                        + header * 0.12d
                        + artwork * 0.54d
                        + footer * 0.18d,
                0d,
                1d
        );
        return new Result(combined, whole, header, artwork, footer, reliable, method);
    }

    private static double compareRegion(Bitmap left, Bitmap right, Region region) {
        double[] grayLeft = grayscale(left, region, 32, 32);
        double[] grayRight = grayscale(right, region, 32, 32);
        long pHashLeft = perceptualHash(grayLeft, 32, 32);
        long pHashRight = perceptualHash(grayRight, 32, 32);
        double pHash = 1d - Long.bitCount(pHashLeft ^ pHashRight) / 64d;

        long dHashLeft = differenceHash(left, region);
        long dHashRight = differenceHash(right, region);
        double dHash = 1d - Long.bitCount(dHashLeft ^ dHashRight) / 64d;

        double grayCorrelation = normalizedCorrelation(grayLeft, grayRight);
        double gradient = gradientSimilarity(grayLeft, grayRight, 32, 32);
        double color = colorHistogramSimilarity(left, right, region);
        return clamp(
                pHash * 0.28d
                        + dHash * 0.24d
                        + grayCorrelation * 0.20d
                        + gradient * 0.20d
                        + color * 0.08d,
                0d,
                1d
        );
    }

    /** Low-frequency 8x8 DCT hash (pHash-style), resilient to exposure and resize changes. */
    private static long perceptualHash(double[] values, int width, int height) {
        double[] coefficients = new double[64];
        double[][] cosineX = new double[8][width];
        double[][] cosineY = new double[8][height];
        for (int frequency = 0; frequency < 8; frequency++) {
            for (int x = 0; x < width; x++) {
                cosineX[frequency][x] = Math.cos(
                        (2d * x + 1d) * frequency * Math.PI / (2d * width)
                );
            }
            for (int y = 0; y < height; y++) {
                cosineY[frequency][y] = Math.cos(
                        (2d * y + 1d) * frequency * Math.PI / (2d * height)
                );
            }
        }
        int index = 0;
        for (int v = 0; v < 8; v++) {
            for (int u = 0; u < 8; u++) {
                double sum = 0d;
                for (int y = 0; y < height; y++) {
                    for (int x = 0; x < width; x++) {
                        sum += values[y * width + x] * cosineX[u][x] * cosineY[v][y];
                    }
                }
                coefficients[index++] = sum;
            }
        }
        double[] withoutDc = Arrays.copyOfRange(coefficients, 1, coefficients.length);
        Arrays.sort(withoutDc);
        double median = withoutDc[withoutDc.length / 2];
        long hash = 0L;
        for (double coefficient : coefficients) {
            hash <<= 1;
            if (coefficient >= median) hash |= 1L;
        }
        return hash;
    }

    private static long differenceHash(Bitmap source, Region region) {
        double[] values = grayscale(source, region, 9, 8);
        long hash = 0L;
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                hash <<= 1;
                if (values[y * 9 + x] < values[y * 9 + x + 1]) hash |= 1L;
            }
        }
        return hash;
    }

    /** Pearson correlation is stable under uniform brightness/contrast changes. */
    private static double normalizedCorrelation(double[] left, double[] right) {
        double meanLeft = mean(left);
        double meanRight = mean(right);
        double numerator = 0d;
        double squareLeft = 0d;
        double squareRight = 0d;
        for (int index = 0; index < left.length; index++) {
            double a = left[index] - meanLeft;
            double b = right[index] - meanRight;
            numerator += a * b;
            squareLeft += a * a;
            squareRight += b * b;
        }
        if (squareLeft < 1d || squareRight < 1d) return 0.5d;
        return clamp((numerator / Math.sqrt(squareLeft * squareRight) + 1d) / 2d, 0d, 1d);
    }

    private static double gradientSimilarity(double[] left, double[] right, int width, int height) {
        double[] gradientLeft = gradient(left, width, height);
        double[] gradientRight = gradient(right, width, height);
        return normalizedCorrelation(gradientLeft, gradientRight);
    }

    private static double[] gradient(double[] values, int width, int height) {
        double[] output = new double[(width - 2) * (height - 2)];
        int target = 0;
        for (int y = 1; y < height - 1; y++) {
            for (int x = 1; x < width - 1; x++) {
                double horizontal = values[y * width + x + 1] - values[y * width + x - 1];
                double vertical = values[(y + 1) * width + x] - values[(y - 1) * width + x];
                output[target++] = Math.hypot(horizontal, vertical);
            }
        }
        return output;
    }

    /** Coarse RGB histograms retain broad artwork palette while ignoring pixel noise. */
    private static double colorHistogramSimilarity(Bitmap left, Bitmap right, Region region) {
        double[] a = colorHistogram(left, region);
        double[] b = colorHistogram(right, region);
        double intersection = 0d;
        for (int index = 0; index < a.length; index++) intersection += Math.min(a[index], b[index]);
        return clamp(intersection / 3d, 0d, 1d);
    }

    private static double[] colorHistogram(Bitmap source, Region region) {
        Bitmap sample = sample(source, region, 24, 24);
        double[] histogram = new double[12];
        int count = sample.getWidth() * sample.getHeight();
        for (int y = 0; y < sample.getHeight(); y++) {
            for (int x = 0; x < sample.getWidth(); x++) {
                int color = sample.getPixel(x, y);
                histogram[Math.min(3, ((color >> 16) & 0xff) / 64)]++;
                histogram[4 + Math.min(3, ((color >> 8) & 0xff) / 64)]++;
                histogram[8 + Math.min(3, (color & 0xff) / 64)]++;
            }
        }
        sample.recycle();
        for (int index = 0; index < histogram.length; index++) histogram[index] /= Math.max(1, count);
        return histogram;
    }

    private static double[] grayscale(Bitmap source, Region region, int width, int height) {
        Bitmap sample = sample(source, region, width, height);
        double[] values = new double[width * height];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                values[y * width + x] = luminance(sample.getPixel(x, y));
            }
        }
        sample.recycle();
        return values;
    }

    private static Bitmap sample(Bitmap source, Region region, int width, int height) {
        int left = Math.max(0, Math.round(source.getWidth() * region.left));
        int top = Math.max(0, Math.round(source.getHeight() * region.top));
        int right = Math.min(source.getWidth(), Math.round(source.getWidth() * region.right));
        int bottom = Math.min(source.getHeight(), Math.round(source.getHeight() * region.bottom));
        Bitmap crop = Bitmap.createBitmap(source, left, top, Math.max(2, right - left), Math.max(2, bottom - top));
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

    private static final class Region {
        final float left;
        final float top;
        final float right;
        final float bottom;

        Region(float left, float top, float right, float bottom) {
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }
    }
}
