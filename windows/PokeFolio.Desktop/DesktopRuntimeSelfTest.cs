using OpenCvSharp;
using PokeFolio.Desktop.Capture;
using PokeFolio.Desktop.Recognition;
using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop;

public sealed record DesktopRuntimeSelfTestResult(bool Success, IReadOnlyList<string> Checks,
    IReadOnlyList<string> Errors);

public static class DesktopRuntimeSelfTest
{
    public static DesktopRuntimeSelfTestResult Run()
    {
        var checks = new List<string>();
        var errors = new List<string>();
        try
        {
            using var image = new Mat(80, 80, MatType.CV_8UC3, Scalar.White);
            using var gray = new Mat();
            Cv2.CvtColor(image, gray, ColorConversionCodes.BGR2GRAY);
            checks.Add("OpenCV " + Cv2.GetVersionString());
        }
        catch (Exception error)
        {
            errors.Add("OpenCV runtime: " + error.Message);
        }

        try
        {
            var parser = new CardIdentifierParser();
            if (parser.Parse("050/195", "pokemon").Value != "050/195"
                || parser.Parse("91152256", "yugioh").Value != "91152256"
                || parser.Parse("OP04-032", "onepiece").Value != "OP04-032")
                throw new InvalidOperationException("TCG identifier parser did not return exact keys.");
            checks.Add("TCG identifier profiles");
        }
        catch (Exception error)
        {
            errors.Add("Recognition: " + error.Message);
        }

        try
        {
            // Do not activate WinRT OCR before the STA message pump exists. Referencing the
            // adapter verifies that the OCR bridge shipped; activation and recognition are
            // covered by the asynchronous test suite and normal application flows.
            _ = typeof(WindowsTextRecognitionService).FullName
                ?? throw new InvalidOperationException("Windows OCR adapter is unavailable.");
            checks.Add("Windows local OCR adapter");
        }
        catch (Exception error)
        {
            errors.Add("Windows OCR: " + error.Message);
        }

        try
        {
            var capture = new CanonEosCapture();
            var status = capture.GetStatusAsync().GetAwaiter().GetResult();
            capture.DisposeAsync().AsTask().GetAwaiter().GetResult();
            checks.Add(status.Available ? "Canon adapter" : "Canon optional fallback");
        }
        catch (Exception error)
        {
            errors.Add("Canon adapter: " + error.Message);
        }
        return new DesktopRuntimeSelfTestResult(errors.Count == 0, checks, errors);
    }
}
