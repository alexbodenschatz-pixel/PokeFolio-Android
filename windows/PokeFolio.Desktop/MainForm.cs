using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using PokeFolio.Desktop.Bridge;
using PokeFolio.Desktop.Capture;

namespace PokeFolio.Desktop;

public sealed class MainForm : Form
{
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly SharedWebAssetLocator assets = new();
    private HttpBridgeService? httpBridge;
    private PokeNativeBridge? nativeBridge;

    public MainForm()
    {
        Text = "PokéFolio Desktop";
        MinimumSize = new Size(980, 700);
        Size = new Size(1320, 900);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(7, 15, 25);
        Controls.Add(webView);
        Shown += OnShown;
    }

    private async void OnShown(object? sender, EventArgs eventArgs)
    {
        Shown -= OnShown;
        try
        {
            await InitializeWebViewAsync();
        }
        catch (Exception error)
        {
            MessageBox.Show(
                this,
                "PokéFolio Desktop konnte nicht gestartet werden.\n\n" + error.Message,
                "Startfehler",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    private async Task InitializeWebViewAsync()
    {
        var validation = StartupValidator.Validate(assets);
        if (!validation.Success)
        {
            throw new InvalidOperationException(string.Join(Environment.NewLine, validation.Errors));
        }

        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PokeFolio",
            "WebView2");
        Directory.CreateDirectory(userDataFolder);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
        await webView.EnsureCoreWebView2Async(environment);

        webView.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = true;
        webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
#if !DEBUG
        webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
#endif
        webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "app.pokefolio.local",
            assets.Root,
            CoreWebView2HostResourceAccessKind.Allow);
        webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "desktop.pokefolio.local",
            assets.DesktopRoot,
            CoreWebView2HostResourceAccessKind.Allow);

        var callbackDispatcher = new WebView2CallbackDispatcher(ExecuteScriptOnUiAsync);
        var fileCapture = new WindowsFileCapture(SelectImageFileAsync);
        var captureDevices = new ICardCaptureDevice[] { fileCapture, new CanonEosCapture() };
        httpBridge = new HttpBridgeService();
        nativeBridge = new PokeNativeBridge(
            callbackDispatcher,
            httpBridge,
            new LocalDataService(),
            new DesktopStatusService(),
            fileCapture,
            captureDevices);

        webView.CoreWebView2.AddHostObjectToScript("PokeNative", nativeBridge);
        var bootstrap = await File.ReadAllTextAsync(Path.Combine(assets.DesktopRoot, "desktop-bootstrap.js"));
        await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(bootstrap);
        webView.Source = new Uri("https://app.pokefolio.local/index.html");
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            httpBridge?.Dispose();
            webView.Dispose();
        }
        base.Dispose(disposing);
    }

    private Task<string?> SelectImageFileAsync(CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested)
        {
            return Task.FromCanceled<string?>(cancellationToken);
        }

        var completion = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        void ShowPicker()
        {
            using var dialog = new OpenFileDialog
            {
                Title = "Kartenbild auswählen",
                Filter = "Bilddateien|*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.heic;*.heif|Alle Dateien|*.*",
                CheckFileExists = true,
                Multiselect = false
            };
            completion.TrySetResult(dialog.ShowDialog(this) == DialogResult.OK ? dialog.FileName : null);
        }

        if (InvokeRequired)
        {
            BeginInvoke((Action)ShowPicker);
        }
        else
        {
            ShowPicker();
        }
        return completion.Task;
    }

    private Task ExecuteScriptOnUiAsync(string script)
    {
        if (!InvokeRequired)
        {
            return webView.CoreWebView2.ExecuteScriptAsync(script);
        }

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        BeginInvoke((Action)(async () =>
        {
            try
            {
                await webView.CoreWebView2.ExecuteScriptAsync(script);
                completion.TrySetResult();
            }
            catch (Exception error)
            {
                completion.TrySetException(error);
            }
        }));
        return completion.Task;
    }
}
