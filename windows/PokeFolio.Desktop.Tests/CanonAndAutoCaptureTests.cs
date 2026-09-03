using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Capture;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class CanonAndAutoCaptureTests
{
    [TestMethod]
    public async Task MockAdapterEnumeratesConnectsCapturesAndDisconnects()
    {
        var adapter = new MockCanonAdapter();
        await using var capture = new CanonEosCapture(adapter);
        var cameras = await capture.EnumerateAsync();
        Assert.AreEqual(1, cameras.Count);
        await capture.ConnectAsync(cameras[0].Id);
        var result = await capture.CaptureAsync(new CardCaptureRequest(CardCaptureIntent.Front));
        Assert.IsTrue(result.Ok);
        StringAssert.StartsWith(result.DataUrl!, "data:image/jpeg;base64,");
        await capture.DisconnectAsync();
        Assert.IsFalse((await capture.GetStatusAsync()).Connected);
    }

    [TestMethod]
    public async Task CaptureTimeoutIsControlledAndDoesNotCrash()
    {
        var adapter = new MockCanonAdapter { NeverCompleteCapture = true };
        await adapter.ConnectAsync("eos-1");
        await using var capture = new CanonEosCapture(adapter, TimeSpan.FromMilliseconds(25));
        var result = await capture.CaptureAsync(new CardCaptureRequest(CardCaptureIntent.Front));
        Assert.IsFalse(result.Ok);
        StringAssert.Contains(result.Error!, "Zeitlimit");
    }

    [TestMethod]
    public async Task CameraDisconnectDuringCaptureReturnsControlledFailure()
    {
        var adapter = new MockCanonAdapter { DisconnectDuringCapture = true };
        await adapter.ConnectAsync("eos-1");
        await using var capture = new CanonEosCapture(adapter);
        var result = await capture.CaptureAsync(new CardCaptureRequest(CardCaptureIntent.Front));
        Assert.IsFalse(result.Ok);
        StringAssert.Contains(result.Error!, "USB-Verbindung");
        Assert.IsFalse((await capture.GetStatusAsync()).Connected);
    }

    [TestMethod]
    public void AutoCaptureRequiresStableFramesThenWaitsForRemoval()
    {
        var machine = new AutoCaptureStateMachine(3, TimeSpan.Zero);
        var now = DateTimeOffset.UtcNow;
        AutoCaptureDecision decision = default!;
        for (var index = 0; index < 3; index++)
        {
            decision = machine.Update(new AutoCaptureObservation(true, .91, .01, .88, .9,
                "card-a", now.AddMilliseconds(index * 40)));
        }
        Assert.IsTrue(decision.ShouldCapture);
        machine.MarkCaptured("card-a", now.AddMilliseconds(100));
        decision = machine.Update(new AutoCaptureObservation(true, .95, 0, .9, .9,
            "card-a", now.AddMilliseconds(150)));
        Assert.AreEqual("AWAITING_CARD_REMOVAL", decision.State);
        machine.Update(new AutoCaptureObservation(false, 0, 1, 0, 0, "", now.AddMilliseconds(200)));
        decision = machine.Update(new AutoCaptureObservation(true, .95, 0, .9, .9,
            "card-b", now.AddMilliseconds(250)));
        Assert.AreEqual("STABILIZING", decision.State);
    }

    [TestMethod]
    public async Task MissingSdkRemainsOptional()
    {
        await using var capture = new CanonEosCapture();
        var status = await capture.GetStatusAsync();
        Assert.IsFalse(status.Available);
        var cameras = await capture.EnumerateAsync();
        Assert.AreEqual(0, cameras.Count);
    }

    [TestMethod]
    public void LiveAnalyzerOnlyComputesContourMotionAndQualitySignals()
    {
        var dataUrl = SyntheticCard.DataUrl();
        var bytes = Convert.FromBase64String(dataUrl[(dataUrl.IndexOf(',') + 1)..]);
        var analyzer = new LiveViewCardAnalyzer(new CardDetector());
        var first = analyzer.Analyze(bytes);
        var second = analyzer.Analyze(bytes);
        Assert.IsTrue(first.Detection.FourCornersDetected);
        Assert.IsLessThan(.01, second.MotionScore);
        Assert.AreEqual(16, second.Fingerprint.Length);
        Assert.IsGreaterThan(0, second.SharpnessScore);
    }
}
