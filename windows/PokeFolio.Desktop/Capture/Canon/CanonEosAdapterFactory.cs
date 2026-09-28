using System.Reflection;
using System.Runtime.Loader;

namespace PokeFolio.Desktop.Capture.Canon;

public static class CanonEosAdapterFactory
{
    public const string AdapterEnvironmentVariable = "POKEFOLIO_CANON_ADAPTER_PATH";
    public const string SdkEnvironmentVariable = "POKEFOLIO_CANON_EDSDK_PATH";
    private const string AdapterFileName = "PokeFolio.Canon.EdsdkAdapter.dll";

    public static ICanonEosSdkAdapter Create()
    {
        var configuredAdapter = Environment.GetEnvironmentVariable(AdapterEnvironmentVariable);
        var sdkDirectory = Environment.GetEnvironmentVariable(SdkEnvironmentVariable);
        var adapterPath = !string.IsNullOrWhiteSpace(configuredAdapter)
            ? configuredAdapter
            : !string.IsNullOrWhiteSpace(sdkDirectory)
                ? Path.Combine(sdkDirectory, AdapterFileName)
                : "";
        if (string.IsNullOrWhiteSpace(adapterPath))
        {
            return new UnavailableCanonEosSdkAdapter(
                "Canon EDSDK ist nicht konfiguriert. Datei-Import bleibt verfügbar.");
        }
        if (!Path.IsPathFullyQualified(adapterPath) || !File.Exists(adapterPath))
        {
            return new UnavailableCanonEosSdkAdapter(
                "Der konfigurierte Canon-Adapter wurde nicht gefunden.");
        }
        try
        {
            var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.GetFullPath(adapterPath));
            var implementation = assembly.GetTypes().FirstOrDefault(type =>
                !type.IsAbstract && typeof(ICanonEosSdkAdapter).IsAssignableFrom(type)
                && type.GetConstructor(Type.EmptyTypes) is not null);
            return implementation is null
                ? new UnavailableCanonEosSdkAdapter(
                    "Der Canon-Adapter implementiert ICanonEosSdkAdapter nicht.")
                : (ICanonEosSdkAdapter)Activator.CreateInstance(implementation)!;
        }
        catch (Exception error) when (error is IOException or BadImageFormatException
            or ReflectionTypeLoadException or TypeLoadException)
        {
            return new UnavailableCanonEosSdkAdapter(
                "Canon-Adapter konnte nicht geladen werden: " + error.Message);
        }
    }
}
