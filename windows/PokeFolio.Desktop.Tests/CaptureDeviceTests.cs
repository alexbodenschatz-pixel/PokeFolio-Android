using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Capture;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class CaptureDeviceTests
{
    [TestMethod]
    public async Task FileCaptureReturnsDataUrlForImportedImage()
    {
        var path = Path.Combine(Path.GetTempPath(), "pokefolio-capture-" + Guid.NewGuid().ToString("N") + ".png");
        try
        {
            await File.WriteAllBytesAsync(path, new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
            var device = new WindowsFileCapture(_ => Task.FromResult<string?>(path));
            var result = await device.CaptureAsync(new CardCaptureRequest(CardCaptureIntent.Front));
            Assert.IsTrue(result.Ok);
            StringAssert.StartsWith(result.DataUrl!, "data:image/png;base64,");
            Assert.AreEqual("windows-file", result.Source);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [TestMethod]
    public async Task MissingCameraStubFailsCleanlyWithoutSdk()
    {
        var device = new CanonEosCapture();
        var status = await device.GetStatusAsync();
        var capture = await device.CaptureAsync(new CardCaptureRequest(CardCaptureIntent.Precision));
        Assert.IsFalse(status.Available);
        Assert.IsFalse(status.Connected);
        Assert.IsFalse(capture.Ok);
        StringAssert.Contains(capture.Error!, "EDSDK");
    }
}
