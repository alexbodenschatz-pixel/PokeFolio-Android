package de.pokefolio.app;

/** Monotonic-clock state machine, independent of CameraX and Android for regression tests. */
final class AutoCaptureGate {
    private long stableSince = -1;
    private long absentSince = -1;
    private long lastFrame = -1;
    private long cooldownUntil;
    private int stableFrames;
    private int absentFrames;
    private boolean waitingForRemoval;
    private boolean removalConfirmed;
    private boolean captureRemovalConfirmed;

    AutoCaptureGate(boolean waitingForRemoval) {
        this.waitingForRemoval = waitingForRemoval;
    }

    boolean update(long now, boolean present, boolean qualityReady) {
        if (lastFrame >= 0 && (now < lastFrame || now - lastFrame > 350)) resetEvidence();
        lastFrame = now;
        if (waitingForRemoval) {
            if (present) {
                absentSince = -1;
                absentFrames = 0;
            } else {
                if (absentSince < 0) absentSince = now;
                absentFrames++;
                if (absentFrames >= 6 && now - absentSince >= 700) {
                    waitingForRemoval = false;
                    removalConfirmed = true;
                    resetEvidence();
                }
            }
            return false;
        }
        if (!present || !qualityReady || now < cooldownUntil) {
            stableSince = -1;
            stableFrames = 0;
            return false;
        }
        if (stableSince < 0) stableSince = now;
        return ++stableFrames >= 6 && now - stableSince >= 650;
    }

    void captured(long now) {
        captureRemovalConfirmed = removalConfirmed;
        waitingForRemoval = true;
        removalConfirmed = false;
        cooldownUntil = now + 1500;
        resetEvidence();
    }

    void failed(long now) {
        waitingForRemoval = false;
        removalConfirmed = captureRemovalConfirmed;
        cooldownUntil = now + 2500;
        resetEvidence();
    }

    void resetEvidence() {
        stableSince = absentSince = -1;
        stableFrames = absentFrames = 0;
    }

    boolean waitingForRemoval() { return waitingForRemoval; }
    boolean removalConfirmed() { return removalConfirmed; }
}
