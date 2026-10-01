package de.pokefolio.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class FixedCaptureFrameTest {
    private float[] box(float x, float y, float size) {
        return new float[]{x,y,x+size,y,x+size,y+size,x,y+size};
    }
    @Test public void centeredFullCardCanCapture() {
        assertTrue(FixedCaptureFrame.containsCard(box(.08f,.08f,.84f)));
        assertTrue(FixedCaptureFrame.ready(true,true,true,true));
    }
    @Test public void partialCardNeverCaptures() {
        assertFalse(FixedCaptureFrame.containsCard(box(-.05f,.08f,.84f)));
        assertFalse(FixedCaptureFrame.containsCard(box(.2f,.2f,.84f)));
        assertFalse(FixedCaptureFrame.ready(false,true,true,true));
    }
    @Test public void blurryOrMovingCardNeverCaptures() {
        assertFalse(FixedCaptureFrame.ready(true,false,true,true));
        assertFalse(FixedCaptureFrame.ready(true,true,false,true));
    }
    @Test public void missingNameOrFooterPreventsCapture() {
        assertFalse(FixedCaptureFrame.ready(true,true,true,false));
    }
    @Test public void tinyBackgroundRectangleIsRejected() {
        assertFalse(FixedCaptureFrame.containsCard(box(.3f,.3f,.35f)));
        assertFalse(FixedCaptureFrame.containsCard(null));
        assertFalse(FixedCaptureFrame.containsCard(box(Float.NaN,.1f,.8f)));
    }
}
