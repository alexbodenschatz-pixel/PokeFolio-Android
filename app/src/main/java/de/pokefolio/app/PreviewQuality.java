package de.pokefolio.app;

/** Quality of a small card-interior luminance grid; thresholds require real-device calibration. */
final class PreviewQuality {
    static boolean acceptable(int[] gray, int width, int height) {
        if (width < 3 || height < 3 || gray.length != width * height) return false;
        double sum = 0, lapSum = 0, lapSquared = 0;
        int clipped = 0, count = 0;
        for (int value : gray) {
            sum += value;
            if (value < 12 || value > 245) clipped++;
        }
        for (int y = 1; y < height - 1; y++) {
            for (int x = 1; x < width - 1; x++) {
                int i = y * width + x;
                double lap = 4 * gray[i] - gray[i - 1] - gray[i + 1]
                        - gray[i - width] - gray[i + width];
                lapSum += lap;
                lapSquared += lap * lap;
                count++;
            }
        }
        double mean = sum / gray.length;
        double variance = lapSquared / count - Math.pow(lapSum / count, 2);
        return mean >= 35 && mean <= 220 && clipped < gray.length * 0.25 && variance >= 65;
    }
}
