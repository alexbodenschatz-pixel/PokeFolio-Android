using System.Text;
using System.Text.RegularExpressions;

namespace PokeFolio.Desktop.Bridge;

public sealed partial class LocalDataService
{
    private readonly string root;

    public LocalDataService(string? root = null)
    {
        this.root = root ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PokeFolio",
            "DesktopData");
        Directory.CreateDirectory(this.root);
    }

    public string Root => root;

    public string? Load(string key)
    {
        var path = ResolvePath(key);
        return File.Exists(path) ? File.ReadAllText(path, Encoding.UTF8) : null;
    }

    public void Save(string key, string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        var path = ResolvePath(key);
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, json, new UTF8Encoding(false));
        File.Move(temporary, path, true);
    }

    public void Delete(string key)
    {
        var path = ResolvePath(key);
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }

    private string ResolvePath(string key)
    {
        if (string.IsNullOrWhiteSpace(key) || !SafeKey().IsMatch(key))
        {
            throw new ArgumentException("Ungültiger lokaler Datenschlüssel.", nameof(key));
        }
        return Path.Combine(root, key + ".json");
    }

    [GeneratedRegex("^[A-Za-z0-9._-]{1,80}$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeKey();
}
