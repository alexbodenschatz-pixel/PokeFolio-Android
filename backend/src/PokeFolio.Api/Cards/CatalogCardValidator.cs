namespace PokeFolio.Api.Cards;

public static class CatalogCardValidator
{
    private static readonly Dictionary<string, string> ProviderTcgs =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["pokemon-tcg-api"] = "pokemon",
            ["tcgdex"] = "pokemon",
            ["ygoprodeck"] = "yugioh",
            ["optcgapi"] = "onepiece"
        };

    public static IReadOnlyDictionary<string, string[]> Validate(
        ResolveCatalogCardCommand command)
    {
        ArgumentNullException.ThrowIfNull(command);
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        string provider = command.Provider?.Trim() ?? string.Empty;
        string tcg = command.Tcg?.Trim() ?? string.Empty;
        if (!ProviderTcgs.TryGetValue(provider, out string? providerTcg))
        {
            errors["provider"] = ["Card provider is not supported."];
        }
        else if (!string.Equals(providerTcg, tcg, StringComparison.OrdinalIgnoreCase))
        {
            errors["tcg"] = ["Card provider does not match the selected TCG."];
        }

        ValidateProviderCardId(command.ProviderCardId, errors);
        ValidateText(command.Name, 240, "name", errors);
        ValidateText(command.SetCode, 64, "setCode", errors);
        ValidateText(command.Number, 64, "number", errors);
        return errors;
    }

    public static ResolveCatalogCardCommand Normalize(ResolveCatalogCardCommand command)
    {
        IReadOnlyDictionary<string, string[]> errors = Validate(command);
        if (errors.Count > 0)
        {
            throw new ArgumentException("Catalog card command is invalid.", nameof(command));
        }

        string provider = command.Provider!.Trim().ToLowerInvariant();
        return new ResolveCatalogCardCommand(
            provider,
            command.ProviderCardId!.Trim().ToLowerInvariant(),
            ProviderTcgs[provider],
            command.Name!.Trim(),
            command.SetCode!.Trim(),
            command.Number!.Trim());
    }

    private static void ValidateProviderCardId(
        string? value,
        Dictionary<string, string[]> errors)
    {
        string normalized = value?.Trim() ?? string.Empty;
        if (normalized.Length is < 1 or > 160 || normalized.Any(character =>
                !char.IsAsciiLetterOrDigit(character) &&
                character is not '-' and not '_' and not '.' and not ':' and not '/'))
        {
            errors["providerCardId"] =
                ["Provider card id must contain 1 to 160 safe identifier characters."];
        }
    }

    private static void ValidateText(
        string? value,
        int maximumLength,
        string field,
        Dictionary<string, string[]> errors)
    {
        string normalized = value?.Trim() ?? string.Empty;
        if (normalized.Length is < 1 || normalized.Length > maximumLength ||
            normalized.Any(char.IsControl))
        {
            errors[field] =
                [$"Value must contain 1 to {maximumLength} non-control characters."];
        }
    }
}
