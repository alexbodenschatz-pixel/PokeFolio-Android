package de.pokefolio.app;

import java.util.Locale;

/** Shared normalized coordinates and text-presence evidence, without card identification. */
final class CardRoiLayout {
    static final float LEFT = 0.025f, RIGHT = 0.975f;
    static final float NAME_TOP = 0.015f, NAME_BOTTOM = 0.18f;
    static final float BOTTOM_TOP = 0.84f, BOTTOM_BOTTOM = 0.995f;

    static boolean plausibleName(String text) {
        String value = text == null ? "" : text.trim();
        if (value.matches("(?iu).*(?:entwickelt|evolves|copyright|illus|nintendo|creatures|game freak|fähigkeit|ability|©).*")) return false;
        value = value.replaceAll("(?iu)\\b(?:KP|HP)\\s*\\d{2,3}|\\b\\d{2,3}\\s*(?:KP|HP)\\b", "")
                .replaceAll("(?iu)\\b(?:PHASE|STAGE)\\s*\\d|\\b(?:BASIS|BASIC|KP|HP)\\b", "").trim();
        return value.length() >= 3 && value.length() <= 55
                && value.replaceAll("[^\\p{L}]", "").length() >= 3 && !value.matches(".*\\d.*");
    }

    static boolean plausibleBottom(String text) {
        String value = text == null ? "" : text.trim().toUpperCase(Locale.ROOT);
        if (value.matches(".*(?:KP|HP|SCHADEN|DAMAGE|POK.DEX|GEWICHT|GR.SSE|KG|CM).*")) return false;
        return value.matches(".*\\b(?:[A-Z]{0,4}\\d{1,3}/[A-Z]{0,4}\\d{1,3}|MEP|SVP|SWSH\\d{1,3})\\b.*")
                || value.matches("\\d{3}") || value.matches(".*\\b[A-Z]{2,5}\\s+(?:DE|EN|FR|IT|ES)\\b.*");
    }

    static final class Evidence {
        boolean name, number;
        void add(String text, float y) {
            if (y <= NAME_BOTTOM) name |= plausibleName(text);
            if (y >= BOTTOM_TOP) number |= plausibleBottom(text);
        }
        boolean complete() { return name && number; }
    }

    static boolean allowRotation(boolean uprightComplete, boolean candidateComplete,
                                 float candidateScore, float uprightScore, float runnerUpScore) {
        return !uprightComplete && candidateComplete && candidateScore >= 8f
                && candidateScore - uprightScore >= 6f
                && candidateScore - runnerUpScore >= Math.max(4f, candidateScore * 0.35f);
    }
}
