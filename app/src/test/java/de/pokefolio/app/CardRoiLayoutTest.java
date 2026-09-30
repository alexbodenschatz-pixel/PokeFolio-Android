package de.pokefolio.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class CardRoiLayoutTest {
    @Test public void uprightSolgaleoAlwaysKeepsSensorOrientation() {
        CardRoiLayout.Evidence zero = new CardRoiLayout.Evidence();
        zero.add("Solgaleo 170 KP", 0.09f); zero.add("MEP DE 094", 0.92f);
        assertTrue(zero.complete());
        assertFalse(CardRoiLayout.allowRotation(zero.complete(), true, 50, 20, 20));
    }
    @Test public void uncertainManualPhotoDoesNotFlip() {
        assertFalse(CardRoiLayout.allowRotation(false, false, 25, 1, 2));
        assertFalse(CardRoiLayout.allowRotation(false, true, 14, 12, 12));
    }
    @Test public void upsideDownPhotoRotatesOnlyWithBothCorrectRegions() {
        CardRoiLayout.Evidence zero = new CardRoiLayout.Evidence();
        zero.add("094", 0.1f); zero.add("Solgaleo", 0.9f);
        CardRoiLayout.Evidence upside = new CardRoiLayout.Evidence();
        upside.add("Solgaleo", 0.1f); upside.add("094", 0.9f);
        assertFalse(zero.complete()); assertTrue(upside.complete());
        assertTrue(CardRoiLayout.allowRotation(zero.complete(), upside.complete(), 21, 2, 3));
    }
    @Test public void oneWordCannotAuthorizeRotation() {
        CardRoiLayout.Evidence evidence = new CardRoiLayout.Evidence();
        evidence.add("Solgaleo", 0.1f);
        assertFalse(evidence.complete());
        assertFalse(CardRoiLayout.allowRotation(false, evidence.complete(), 30, 0, 0));
    }
    @Test public void namesPreserveFormsAndSuffixes() {
        for (String name : new String[]{"Alola-Kokowei", "Famieps", "Glurak ex", "Mewtu VSTAR", "Mega Glurak EX"})
            assertTrue(name, CardRoiLayout.plausibleName(name));
    }
    @Test public void labelsAndEvolutionCannotProvideTitleEvidence() {
        for (String name : new String[]{"PHASE 1", "PHASE 2", "BASIS", "170 KP", "KP", "Entwickelt sich aus Zwieps", "Fähigkeit"})
            assertFalse(name, CardRoiLayout.plausibleName(name));
    }
    @Test public void footerEvidenceAcceptsSingleAndPrefixedNumbers() {
        for (String value : new String[]{"094", "013/091", "TG01/TG30", "SV001/SV122", "MEP DE 094"})
            assertTrue(value, CardRoiLayout.plausibleBottom(value));
        for (String value : new String[]{"170 KP", "220 Schaden", "2026", "Pokédex 094", "12 KG"})
            assertFalse(value, CardRoiLayout.plausibleBottom(value));
    }
    @Test public void roisStayInsideCardAndIgnoreMiddleNumbers() {
        assertTrue(CardRoiLayout.NAME_BOTTOM <= .18f);
        assertTrue(CardRoiLayout.BOTTOM_TOP >= .84f);
        assertTrue(CardRoiLayout.LEFT > 0 && CardRoiLayout.RIGHT < 1);
        CardRoiLayout.Evidence evidence = new CardRoiLayout.Evidence();
        evidence.add("Solgaleo", .1f); evidence.add("094", .5f);
        assertFalse(evidence.complete());
    }
}
