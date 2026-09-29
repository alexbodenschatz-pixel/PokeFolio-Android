package de.pokefolio.app;

/** Conservative geometric gate. Failure means retain the original photograph, not crop harder. */
final class CardCropSafety {
    private CardCropSafety() { }

    static boolean accepts(float[] points, int width, int height) {
        if (points == null || points.length != 8 || width < 2 || height < 2) return false;
        double winding = 0;
        for (int i = 0; i < 4; i++) {
            float x = points[i * 2], y = points[i * 2 + 1];
            if (!Float.isFinite(x) || !Float.isFinite(y)
                    || x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return false;
            int j = (i + 1) % 4, k = (i + 2) % 4;
            double cross = (points[j * 2] - x) * (points[k * 2 + 1] - y)
                    - (points[j * 2 + 1] - y) * (points[k * 2] - x);
            if (Math.abs(cross) < 1 || i > 0 && cross * winding <= 0) return false;
            winding = cross;
        }
        double horizontal = (edge(points, 0, 1) + edge(points, 3, 2)) / 2;
        double vertical = (edge(points, 0, 3) + edge(points, 1, 2)) / 2;
        double ratio = Math.min(horizontal, vertical) / Math.max(horizontal, vertical);
        // Covers 63:88 and 59:86 physical cards. More severe perspective needs the full
        // source fallback; a short internal artwork rectangle must not become the card.
        return ratio >= 0.665 && ratio <= 0.755;
    }

    private static double edge(float[] p, int a, int b) {
        return Math.hypot(p[a * 2] - p[b * 2], p[a * 2 + 1] - p[b * 2 + 1]);
    }
}
