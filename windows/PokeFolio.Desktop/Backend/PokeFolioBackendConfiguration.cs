namespace PokeFolio.Desktop.Backend;

public sealed record PokeFolioBackendConfiguration(
    Uri? BackendOrigin,
    string? Error)
{
    public const string EnvironmentVariableName = "POKEFOLIO_BACKEND_ORIGIN";

    public bool IsConfigured => BackendOrigin is not null;

    public static PokeFolioBackendConfiguration FromEnvironment() =>
        Parse(Environment.GetEnvironmentVariable(EnvironmentVariableName));

    internal static PokeFolioBackendConfiguration Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return new PokeFolioBackendConfiguration(BackendOrigin: null, Error: null);
        }

        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out Uri? origin) ||
            !PokeFolioApiClient.IsAllowedBackendOrigin(origin))
        {
            return new PokeFolioBackendConfiguration(
                BackendOrigin: null,
                $"{EnvironmentVariableName} must be path-free HTTPS, or loopback HTTP for local development.");
        }

        return new PokeFolioBackendConfiguration(
            new Uri(origin.GetLeftPart(UriPartial.Authority) + "/", UriKind.Absolute),
            Error: null);
    }
}
