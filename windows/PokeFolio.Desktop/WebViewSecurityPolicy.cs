namespace PokeFolio.Desktop;

/// <summary>Defines which documents may run inside the privileged desktop WebView.</summary>
public static class WebViewSecurityPolicy
{
    public const string ApplicationHost = "app.pokefolio.local";
    public const string DesktopAssetHost = "desktop.pokefolio.local";
    public const string StartPage = "https://app.pokefolio.local/index.html";

    public static bool IsAllowedTopLevelNavigation(string? value)
    {
        if (!TryCreateTrustedUri(value, out var uri) ||
            !string.Equals(uri.Host, ApplicationHost, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return string.Equals(uri.AbsolutePath, "/", StringComparison.Ordinal) ||
               string.Equals(uri.AbsolutePath, "/index.html", StringComparison.Ordinal);
    }

    public static bool IsAllowedFrameNavigation(string? value) =>
        TryCreateTrustedUri(value, out _);

    private static bool TryCreateTrustedUri(string? value, out Uri uri)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri!) ||
            !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            !uri.IsDefaultPort ||
            !string.IsNullOrEmpty(uri.UserInfo))
        {
            return false;
        }

        return string.Equals(uri.Host, ApplicationHost, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(uri.Host, DesktopAssetHost, StringComparison.OrdinalIgnoreCase);
    }
}
