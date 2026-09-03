namespace PokeFolio.Desktop.Tests;

internal static class TestPaths
{
    public static string RepositoryRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "settings.gradle"))
                && Directory.Exists(Path.Combine(current.FullName, "app", "src", "main", "assets")))
            {
                return current.FullName;
            }
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("Repository root could not be located from the test output directory.");
    }
}
