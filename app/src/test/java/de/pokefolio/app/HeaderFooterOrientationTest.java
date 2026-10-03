package de.pokefolio.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class HeaderFooterOrientationTest {
    private final String header = "Deoxys\n110 KP";
    private final String footer = "CRI DE\n031/086\n2026 Pokémon/Nintendo/Creatures/GAME FREAK";
    @Test public void uprightDeoxysIsNeverRotated() {
        assertEquals(8, CardRoiLayout.orientationScore(header, footer));
        assertFalse(CardRoiLayout.reversedStructure(header, footer));
    }
    @Test public void swappedHeaderAndFooterPermitOneCountercheck() {
        assertTrue(CardRoiLayout.reversedStructure(footer, header));
        assertTrue(CardRoiLayout.orientationScore(header, footer) - CardRoiLayout.orientationScore(footer, header) >= 6);
    }
    @Test public void uncertainTextCannotTriggerRotation() {
        assertFalse(CardRoiLayout.reversedStructure("", ""));
        assertFalse(CardRoiLayout.reversedStructure("2026 Copyright", ""));
        assertFalse(CardRoiLayout.reversedStructure("Deoxys", "031/086"));
    }
    @Test public void megaAndMorudaStayUpright() {
        assertFalse(CardRoiLayout.reversedStructure("Mega-Dragoran ex\n370 KP", "MEP DE\n091"));
        assertEquals(8, CardRoiLayout.orientationScore("Moruda\n140 KP", "PBL DE\n039/084"));
    }
    @Test public void copyrightAndSetCodeAreNotNames() {
        assertFalse(CardRoiLayout.plausibleName("2026 Pokémon/Nintendo/Creatures/GAME FREAK"));
        assertFalse(CardRoiLayout.reversedStructure("031/086", "CRI DE\nCopyright"));
    }
}
