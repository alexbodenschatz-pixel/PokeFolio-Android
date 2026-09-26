package de.pokefolio.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class AutoCaptureGateTest {
    @Test public void requiresContinuousQualityAndStability() {
        AutoCaptureGate gate = new AutoCaptureGate(false);
        for (long t = 0; t < 700; t += 100) assertFalse(gate.update(t, true, true));
        assertTrue(gate.update(700, true, true));
        assertFalse(gate.update(800, true, false));
        assertFalse(gate.update(900, true, true));
    }

    @Test public void sameCardNeverRearmsWithTimeAlone() {
        AutoCaptureGate gate = new AutoCaptureGate(false);
        gate.captured(0);
        for (long t = 100; t < 10000; t += 100) assertFalse(gate.update(t, true, true));
        assertTrue(gate.waitingForRemoval());
        assertFalse(gate.removalConfirmed());
    }

    @Test public void briefLostContourDoesNotCountAsRemoval() {
        AutoCaptureGate gate = new AutoCaptureGate(true);
        for (long t = 0; t < 600; t += 100) gate.update(t, false, false);
        gate.update(600, true, false);
        for (long t = 700; t < 1300; t += 100) gate.update(t, false, false);
        assertTrue(gate.waitingForRemoval());
    }

    @Test public void confirmedRemovalAllowsSamePrintedCardAgain() {
        AutoCaptureGate gate = new AutoCaptureGate(true);
        for (long t = 0; t <= 700; t += 100) assertFalse(gate.update(t, false, false));
        assertFalse(gate.waitingForRemoval());
        assertTrue(gate.removalConfirmed());
        for (long t = 800; t < 1500; t += 100) assertFalse(gate.update(t, true, true));
        assertTrue(gate.update(1500, true, true));
    }

    @Test public void pauseAndStaleFramesCannotCompleteEvidence() {
        AutoCaptureGate gate = new AutoCaptureGate(true);
        gate.update(0, false, false);
        gate.update(5000, false, false);
        assertTrue(gate.waitingForRemoval());
        gate = new AutoCaptureGate(false);
        for (long t = 0; t < 600; t += 100) gate.update(t, true, true);
        gate.resetEvidence();
        assertFalse(gate.update(700, true, true));
        assertFalse(gate.update(5000, true, true));
    }

    @Test public void errorRetriesOnlyAfterCooldownAndNewStableFrames() {
        AutoCaptureGate gate = new AutoCaptureGate(false);
        gate.captured(0);
        gate.failed(100);
        for (long t = 200; t < 3300; t += 100) assertFalse(gate.update(t, true, true));
        assertTrue(gate.update(3300, true, true));
    }

    @Test public void cropFailurePreservesRemovalProofForRetry() {
        AutoCaptureGate gate = new AutoCaptureGate(true);
        for (long t = 0; t <= 700; t += 100) gate.update(t, false, false);
        gate.captured(1500);
        assertFalse(gate.removalConfirmed());
        gate.failed(1600);
        assertTrue(gate.removalConfirmed());
    }
}
