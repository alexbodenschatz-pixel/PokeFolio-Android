using System.Runtime.InteropServices;

namespace PokeFolio.Desktop.Bridge;

public sealed class DesktopStatusService
{
    public object GetStatus() => new
    {
        platform = "windows",
        host = "webview2",
        version = "0.16.5",
        operatingSystem = RuntimeInformation.OSDescription,
        architecture = RuntimeInformation.OSArchitecture.ToString(),
        dotNet = RuntimeInformation.FrameworkDescription,
        ocr = new { available = false, provider = "Android ML Kit bleibt auf Android" },
        eos = new { available = false, reason = "Canon EDSDK ist nicht installiert" },
        collectionFormat = "shared-web-core"
    };
}
