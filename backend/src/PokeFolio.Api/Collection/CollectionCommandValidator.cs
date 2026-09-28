using System.Text.Json;
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

    public static bool TryParseUpdate(
        JsonElement value,
        out UpdateHoldingPatch patch,
        out IReadOnlyDictionary<string, string[]> errors)
    {
        var mutableErrors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        string? language = null;
        string? variant = null;
        string? condition = null;
        string? notes = null;
        bool hasLanguage = false;
        bool hasVariant = false;
        bool hasCondition = false;
        bool hasNotes = false;

        if (value.ValueKind != JsonValueKind.Object)
        {
            mutableErrors["body"] = ["Merge patch must be a JSON object."];
        }
        else
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonProperty property in value.EnumerateObject())
            {
                if (!seen.Add(property.Name))
                {
                    mutableErrors[property.Name] = ["Property must not occur more than once."];
                    continue;
                }

                switch (property.Name)
                {
                    case "language":
                        hasLanguage = true;
                        language = ReadString(property, mutableErrors);
                        if (language is not null) ValidateLanguage(language, mutableErrors);
                        break;
                    case "variant":
                        hasVariant = true;
                        variant = ReadString(property, mutableErrors);
                        if (variant is not null) ValidateText(variant, 80, "variant", mutableErrors);
                        break;
                    case "condition":
                        hasCondition = true;
                        condition = ReadString(property, mutableErrors);
                        if (condition is not null)
                        {
                            ValidateText(condition, 40, "condition", mutableErrors);
                        }
                        break;
                    case "notes":
                        hasNotes = true;
                        if (property.Value.ValueKind == JsonValueKind.Null)
                        {
                            notes = null;
                        }
                        else
                        {
                            notes = ReadString(property, mutableErrors);
                            if (notes?.Length > 10_000)
                            {
                                mutableErrors["notes"] = ["Notes cannot exceed 10000 characters."];
                            }
                        }
                        break;
                    default:
                        mutableErrors[property.Name] = ["Property is not supported by this merge patch."];
                        break;
                }
            }

            if (!hasLanguage && !hasVariant && !hasCondition && !hasNotes)
            {
                mutableErrors["body"] = ["Merge patch must contain at least one supported property."];
            }
        }

        patch = new UpdateHoldingPatch(
            hasLanguage,
            language,
            hasVariant,
            variant,
            hasCondition,
            condition,
            hasNotes,
            notes);
        errors = mutableErrors;
        return mutableErrors.Count == 0;
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

    private static string? ReadString(
        JsonProperty property,
        Dictionary<string, string[]> errors)
    {
        if (property.Value.ValueKind != JsonValueKind.String)
        {
            errors[property.Name] = ["Value must be a JSON string."];
            return null;
        }
        return property.Value.GetString();
    }
}
