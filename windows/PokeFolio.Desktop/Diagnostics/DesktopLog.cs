using System.Diagnostics;
using System.Text;

namespace PokeFolio.Desktop.Diagnostics;

public static class DesktopLog
{
    private static readonly object Sync = new();
    private static readonly string DirectoryPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PokeFolio", "Logs");

    public static void Info(string eventName, params (string Name, object? Value)[] fields) =>
        Write("INFO", eventName, fields);

    public static void Warning(string eventName, params (string Name, object? Value)[] fields) =>
        Write("WARN", eventName, fields);

    private static void Write(string level, string eventName,
        IEnumerable<(string Name, object? Value)> fields)
    {
        var line = new StringBuilder()
            .Append(DateTimeOffset.UtcNow.ToString("O")).Append(' ')
            .Append(level).Append(' ').Append(Sanitize(eventName));
        foreach (var field in fields)
        {
            line.Append(' ').Append(Sanitize(field.Name)).Append('=')
                .Append(Sanitize(Convert.ToString(field.Value,
                    System.Globalization.CultureInfo.InvariantCulture) ?? ""));
        }
        var value = line.ToString();
        Debug.WriteLine("[PokeFolio Desktop] " + value);
        try
        {
            lock (Sync)
            {
                Directory.CreateDirectory(DirectoryPath);
                var path = Path.Combine(DirectoryPath, "desktop.log");
                if (File.Exists(path) && new FileInfo(path).Length > 1_000_000)
                {
                    var previous = Path.Combine(DirectoryPath, "desktop.previous.log");
                    File.Move(path, previous, true);
                }
                File.AppendAllText(path, value + Environment.NewLine, Encoding.UTF8);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException
            or System.Security.SecurityException)
        {
            // Logging must never break capture or recognition.
        }
    }

    private static string Sanitize(string value)
    {
        var clean = value.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return clean.Length <= 180 ? clean : clean[..180];
    }
}
