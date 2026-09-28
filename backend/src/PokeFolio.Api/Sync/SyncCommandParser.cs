using System.Text.Json;
using System.Text.Json.Serialization;

namespace PokeFolio.Api.Sync;

public static class SyncCommandParser
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        AllowOutOfOrderMetadataProperties = true,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    public static bool TryParse(
        JsonElement body,
        out IReadOnlyList<SyncOperationCommand> operations,
        out IReadOnlyDictionary<string, string[]> errors)
    {
        var mutableErrors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        operations = [];
        if (body.ValueKind != JsonValueKind.Object)
        {
            mutableErrors["body"] = ["Sync batch must be a JSON object."];
            errors = mutableErrors;
            return false;
        }
        if (HasDuplicateProperty(body))
        {
            mutableErrors["body"] = ["Sync batch must not contain duplicate JSON properties."];
            errors = mutableErrors;
            return false;
        }

        SyncOperationBatchCommand? batch;
        try
        {
            batch = body.Deserialize<SyncOperationBatchCommand>(JsonOptions);
        }
        catch (JsonException)
        {
            mutableErrors["body"] = ["Sync batch shape or operation kind is invalid."];
            errors = mutableErrors;
            return false;
        }
        catch (NotSupportedException)
        {
            mutableErrors["body"] = ["Sync batch operation kind is not supported."];
            errors = mutableErrors;
            return false;
        }

        if (batch?.Operations is null || batch.Operations.Count is < 1 or > 100)
        {
            mutableErrors["operations"] = ["Sync batch must contain 1 to 100 operations."];
        }
        else if (batch.Operations.Any(operation => operation is null))
        {
            mutableErrors["operations"] = ["Sync operations cannot be null."];
        }
        else
        {
            operations = batch.Operations.Select(operation => operation!).ToArray();
        }

        errors = mutableErrors;
        return mutableErrors.Count == 0;
    }

    private static bool HasDuplicateProperty(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Array)
        {
            return value.EnumerateArray().Any(HasDuplicateProperty);
        }
        if (value.ValueKind != JsonValueKind.Object) return false;

        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonProperty property in value.EnumerateObject())
        {
            if (!names.Add(property.Name) || HasDuplicateProperty(property.Value)) return true;
        }
        return false;
    }
}
