using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Desktop.Bridge;
using PokeFolio.Desktop.Capture;

namespace PokeFolio.Desktop.Tests;

[TestClass]
public sealed class PokeNativeBridgeTests
{
    [TestMethod]
    public async Task OcrCompatibilityCallReturnsNonFatalWindowsResult()
    {
        var callbacks = new RecordingDispatcher();
        using var http = new HttpBridgeService();
        var localRoot = Path.Combine(Path.GetTempPath(), "pokefolio-bridge-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            var fileCapture = new WindowsFileCapture(_ => Task.FromResult<string?>(null));
            var bridge = new PokeNativeBridge(callbacks, http, new LocalDataService(localRoot),
                new DesktopStatusService(), fileCapture, new ICardCaptureDevice[] { fileCapture, new CanonEosCapture() });
            bridge.recognizeCardProfiled("data:image/jpeg;base64,AA==", "ocr-1", "de", "pokemon");
            var callback = await callbacks.NextAsync();
            Assert.AreEqual("onNativeOcrResult", callback.Name);
            using var json = JsonDocument.Parse(callback.Json);
            Assert.IsTrue(json.RootElement.GetProperty("ok").GetBoolean());
            Assert.AreEqual("windows", json.RootElement.GetProperty("platform").GetString());
            Assert.AreEqual("ocr-1", json.RootElement.GetProperty("requestId").GetString());
        }
        finally
        {
            if (Directory.Exists(localRoot)) Directory.Delete(localRoot, true);
        }
    }

    [TestMethod]
    public async Task PreparedImageHandoffKeepsSharedRecognitionDataUrl()
    {
        var callbacks = new RecordingDispatcher();
        using var http = new HttpBridgeService();
        var root = Path.Combine(Path.GetTempPath(), "pokefolio-bridge-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            var fileCapture = new WindowsFileCapture(_ => Task.FromResult<string?>(null));
            var bridge = new PokeNativeBridge(callbacks, http, new LocalDataService(root),
                new DesktopStatusService(), fileCapture, new ICardCaptureDevice[] { fileCapture });
            const string dataUrl = "data:image/png;base64,iVBORw0KGgo=";
            bridge.prepareCardImage(dataUrl, "prepare-1");
            var callback = await callbacks.NextAsync();
            Assert.AreEqual("onNativePreparedCard", callback.Name);
            using var json = JsonDocument.Parse(callback.Json);
            Assert.IsTrue(json.RootElement.GetProperty("ok").GetBoolean());
            Assert.AreEqual(dataUrl, json.RootElement.GetProperty("dataUrl").GetString());
            Assert.AreEqual("windows-import-passthrough", json.RootElement.GetProperty("method").GetString());
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    private sealed class RecordingDispatcher : IJavaScriptCallbackDispatcher
    {
        private readonly ConcurrentQueue<Callback> queue = new();
        private readonly SemaphoreSlim signal = new(0);

        public Task SendAsync(string callbackName, object payload)
        {
            queue.Enqueue(new Callback(callbackName, JsonSerializer.Serialize(payload)));
            signal.Release();
            return Task.CompletedTask;
        }

        public async Task<Callback> NextAsync()
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await signal.WaitAsync(timeout.Token);
            Assert.IsTrue(queue.TryDequeue(out var callback));
            return callback!;
        }
    }

    private sealed record Callback(string Name, string Json);
}
