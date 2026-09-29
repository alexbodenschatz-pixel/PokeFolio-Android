package de.pokefolio.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class CardCropSafetyTest {
    private float[] rect(float x, float y, float width, float height) {
        return new float[]{x, y, x + width, y, x + width, y + height, x, y + height};
    }
    @Test public void fullPokemonCardRetainsTitleAndFooter() {
        assertTrue(CardCropSafety.accepts(rect(100, 100, 630, 880), 1000, 1200));
    }
    @Test public void missingTitleStripFallsBack() {
        assertFalse(CardCropSafety.accepts(rect(100, 240, 630, 740), 1000, 1200));
    }
    @Test public void missingCollectorStripFallsBack() {
        assertFalse(CardCropSafety.accepts(rect(100, 100, 630, 740), 1000, 1200));
    }
    @Test public void clippedSideFallsBack() {
        assertFalse(CardCropSafety.accepts(rect(180, 100, 550, 880), 1000, 1200));
    }
    @Test public void incompleteOutsideCornersFallBack() {
        assertFalse(CardCropSafety.accepts(rect(100, -20, 630, 880), 1000, 1200));
    }
    @Test public void landscapeAndOtherTradingCardsRemainValid() {
        assertTrue(CardCropSafety.accepts(rect(50, 50, 880, 630), 1000, 1200));
        assertTrue(CardCropSafety.accepts(rect(100, 100, 590, 860), 1000, 1200));
    }
    @Test public void malformedAndCrossedCornersFallBack() {
        assertFalse(CardCropSafety.accepts(null, 1000, 1200));
        assertFalse(CardCropSafety.accepts(new float[]{100, 100, 730, 980, 730, 100, 100, 980}, 1000, 1200));
        assertFalse(CardCropSafety.accepts(rect(Float.NaN, 100, 630, 880), 1000, 1200));
    }
}
