namespace PokeFolio.Desktop.Capture;

public sealed record AutoCaptureObservation(
    bool CardPresent,
    double DetectionConfidence,
    double MotionScore,
    double SharpnessScore,
    double ExposureScore,
    string Fingerprint,
    DateTimeOffset Timestamp);

public sealed record AutoCaptureDecision(bool ShouldCapture, string State, int StableFrames);

public sealed class AutoCaptureStateMachine(
    int requiredStableFrames = 5,
    TimeSpan? cooldown = null)
{
    private readonly TimeSpan cooldownDuration = cooldown ?? TimeSpan.FromMilliseconds(1200);
    private int stableFrames;
    private DateTimeOffset lastCapture = DateTimeOffset.MinValue;
    private string lastFingerprint = "";
    private bool awaitingRemoval;

    public AutoCaptureDecision Update(AutoCaptureObservation observation)
    {
        if (!observation.CardPresent)
        {
            stableFrames = 0;
            awaitingRemoval = false;
            return new AutoCaptureDecision(false, "NO_CARD", stableFrames);
        }
        var changedCard = awaitingRemoval && !string.IsNullOrWhiteSpace(observation.Fingerprint)
            && !string.Equals(observation.Fingerprint, lastFingerprint, StringComparison.Ordinal);
        if (awaitingRemoval && !changedCard)
            return new AutoCaptureDecision(false, "AWAITING_CARD_REMOVAL", stableFrames);
        if (changedCard)
        {
            awaitingRemoval = false;
            stableFrames = 0;
        }
        var stable = observation.DetectionConfidence >= 0.72
            && observation.MotionScore <= 0.075
            && observation.SharpnessScore >= 0.45
            && observation.ExposureScore >= 0.48;
        stableFrames = stable ? stableFrames + 1 : 0;
        if (!stable) return new AutoCaptureDecision(false, "CARD_UNSTABLE", stableFrames);
        if (stableFrames < requiredStableFrames)
            return new AutoCaptureDecision(false, "STABILIZING", stableFrames);
        if (observation.Timestamp - lastCapture < cooldownDuration)
            return new AutoCaptureDecision(false, "COOLDOWN", stableFrames);
        return new AutoCaptureDecision(true, "CAPTURE_READY", stableFrames);
    }

    public void MarkCaptured(string fingerprint, DateTimeOffset timestamp)
    {
        lastFingerprint = fingerprint ?? "";
        lastCapture = timestamp;
        awaitingRemoval = true;
        stableFrames = 0;
    }
}
