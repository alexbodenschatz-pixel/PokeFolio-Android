package de.pokefolio.app;

/** Acceptance geometry relative to the immovable target, also shared by the authoritative capture crop. */
final class FixedCaptureFrame {
    private FixedCaptureFrame() { }
    static boolean containsCard(float[] xy) {
        if (xy == null || xy.length != 8) return false;
        double area = 0;
        float minX = 1, minY = 1, maxX = 0, maxY = 0;
        for (int i = 0; i < 4; i++) {
            float x = xy[2*i], y = xy[2*i+1];
            if (!Float.isFinite(x) || !Float.isFinite(y) || x < .01f || y < .01f || x > .99f || y > .99f) return false;
            minX = Math.min(minX,x); minY = Math.min(minY,y);
            maxX = Math.max(maxX,x); maxY = Math.max(maxY,y);
            int next = (i+1)%4;
            area += x*xy[2*next+1] - y*xy[2*next];
        }
        return Math.abs(area)/2 >= .65 && maxX-minX >= .82f && maxY-minY >= .82f
                && minX <= .12f && minY <= .12f && maxX >= .88f && maxY >= .88f;
    }
    static boolean ready(boolean inside, boolean sharp, boolean stable, boolean text) {
        return inside && sharp && stable && text;
    }
}
