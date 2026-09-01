namespace PokeFolio.Desktop;

public sealed class SharedWebAssetLocator
{
    private static readonly string[] RequiredFiles =
    {
        "index.html",
        "styles.css",
        "app.js",
        "recognition-core.js",
        "collection-core.js",
        "grading-core.js",
        "api-core.js",
        "variant-core.js",
        "learning-core.js",
        "pokemon-asia-core.js",
        "pokemon-names.js",
        "bulk-fast-core.js"
    };

    public SharedWebAssetLocator(string? root = null)
    {
        Root = root ?? Path.Combine(AppContext.BaseDirectory, "WebAssets");
        DesktopRoot = Path.Combine(AppContext.BaseDirectory, "DesktopAssets");
    }

    public string Root { get; }

    public string DesktopRoot { get; }

    public string IndexPath => Path.Combine(Root, "index.html");

    public IReadOnlyList<string> FindMissingRequiredFiles() => RequiredFiles
        .Where(file => !File.Exists(Path.Combine(Root, file)))
        .ToArray();

    public int CountAssets() => Directory.Exists(Root)
        ? Directory.EnumerateFiles(Root, "*", SearchOption.AllDirectories).Count()
        : 0;
}

public sealed record StartupValidationResult(bool Success, int AssetCount, IReadOnlyList<string> Errors);

public static class StartupValidator
{
    public static StartupValidationResult Validate(SharedWebAssetLocator assets)
    {
        var errors = new List<string>();
        if (!Directory.Exists(assets.Root))
        {
            errors.Add($"Shared web asset directory is missing: {assets.Root}");
        }
        else
        {
            errors.AddRange(assets.FindMissingRequiredFiles().Select(file => $"Required shared asset is missing: {file}"));
        }

        foreach (var desktopAsset in new[] { "desktop-bootstrap.js", "desktop.css" })
        {
            if (!File.Exists(Path.Combine(assets.DesktopRoot, desktopAsset)))
            {
                errors.Add($"Required desktop asset is missing: {desktopAsset}");
            }
        }

        return new StartupValidationResult(errors.Count == 0, assets.CountAssets(), errors);
    }
}
