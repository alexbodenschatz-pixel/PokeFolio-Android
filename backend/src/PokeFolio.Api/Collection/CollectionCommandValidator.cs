using PokeFolio.Domain.Collection;

namespace PokeFolio.Api.Collection;

public static class CollectionCommandValidator
{
    private static readonly Dictionary<string, string> Languages = new(
        StringComparer.OrdinalIgnoreCase)
    {
        ["de"] = "de",
        ["en"] = "en",
        ["ja"] = "ja",
        ["fr"] = "fr",
        ["it"] = "it",
        ["es"] = "es",
        ["ko"] = "ko",
        ["zh-Hans"] = "zh-Hans",
        ["zh-Hant"] = "zh-Hant"
    };

    public static IReadOnlyDictionary<string, string[]> Validate(CreateHoldingCommand command)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (command.Id == Guid.Empty) errors["id"] = ["Holding id must be a non-empty UUID."];
        if (command.CardId == Guid.Empty) errors["cardId"] = ["Card id must be a non-empty UUID."];
        if (command.VariantId == Guid.Empty)
        {
            errors["variantId"] = ["Variant id must be null or a non-empty UUID."];
        }
        ValidateLanguage(command.Language, errors);
        ValidateText(command.Variant, 80, "variant", errors);
        ValidateText(command.Condition, 40, "condition", errors);
        if (command.Quantity is < 1 or > CollectionHolding.MaximumQuantity)
        {
            errors["quantity"] =
                [$"Quantity must be between 1 and {CollectionHolding.MaximumQuantity}."];
        }
        if (command.Notes?.Length > 10_000)
        {
            errors["notes"] = ["Notes cannot exceed 10000 characters."];
        }
        return errors;
    }

    public static IReadOnlyDictionary<string, string[]> Validate(QuantityDeltaCommand command)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (command.OperationId == Guid.Empty)
        {
            errors["operationId"] = ["Operation id must be a non-empty UUID."];
        }
        if (command.Delta == 0 || command.Delta is < -10_000 or > 10_000)
        {
            errors["delta"] = ["Delta must be non-zero and between -10000 and 10000."];
        }
        return errors;
    }

    public static string NormalizeLanguage(string language) =>
        Languages[language.Trim()];

    private static void ValidateLanguage(
        string? language,
        Dictionary<string, string[]> errors)
    {
        string normalized = language?.Trim() ?? string.Empty;
        if (!Languages.ContainsKey(normalized))
        {
            errors["language"] = ["Card language is not supported."];
        }
    }

    private static void ValidateText(
        string? value,
        int maximumLength,
        string field,
        Dictionary<string, string[]> errors)
    {
        int length = value?.Trim().Length ?? 0;
        if (length is < 1 || length > maximumLength)
        {
            errors[field] = [$"Value must contain 1 to {maximumLength} characters."];
        }
    }
}
