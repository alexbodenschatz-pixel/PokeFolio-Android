package de.pokefolio.app;

import org.junit.Test;
import java.util.Arrays;
import static org.junit.Assert.*;

public class PreviewQualityTest {
    @Test public void rejectsDarkClippedAndFeaturelessFrames() {
        int[] pixels = new int[48 * 64];
        for (int value : new int[]{0, 20, 128, 230, 255}) {
            Arrays.fill(pixels, value);
            assertFalse(PreviewQuality.acceptable(pixels, 48, 64));
        }
    }
    @Test public void acceptsWellExposedDetailButRejectsClipping() {
        int[] pixels = new int[48 * 64];
        for (int i = 0; i < pixels.length; i++) pixels[i] = i % 2 == 0 ? 95 : 160;
        assertTrue(PreviewQuality.acceptable(pixels, 48, 64));
        for (int i = 0; i < pixels.length / 3; i++) pixels[i] = 255;
        assertFalse(PreviewQuality.acceptable(pixels, 48, 64));
    }
}
