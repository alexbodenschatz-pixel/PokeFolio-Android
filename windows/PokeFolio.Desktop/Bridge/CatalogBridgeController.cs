using System.Text.Json;
using PokeFolio.Desktop.Backend;
using PokeFolio.Desktop.Diagnostics;

namespace PokeFolio.Desktop.Bridge;

internal sealed class CatalogBridgeController : IDisposable
{
    private static readonly Dictionary<string, string> ProviderTcgs =
        new(StringComparer.Ordinal)
        {
            ["pokemon-tcg-api"] = "pokemon",
            ["tcgdex"] = "pokemon",
            ["ygoprodeck"] = "yugioh",
            ["optcgapi"] = "onepiece"
        };
    private static readonly HashSet<string> ResolutionProperties =
        new(StringComparer.Ordinal) { "card", "created", "metadataMatched" };
    private static readonly HashSet<string> CardProperties = new(StringComparer.Ordinal)
    {
        "id",
        "provider",
        "providerCardId",
        "tcg",
        "name",
        "setCode",
        "number",
        "createdAt",
        "updatedAt"
    };

    private readonly IJavaScriptCallbackDispatcher callbacks;
    private readonly IPokeFolioCloudService cloud;
    private readonly CancellationTokenSource lifetime = new();
    private int disposed;

    public CatalogBridgeController(
        IJavaScriptCallbackDispatcher callbacks,
        IPokeFolioCloudService cloud)
    {
        this.callbacks = callbacks ?? throw new ArgumentNullException(nameof(callbacks));
        this.cloud = cloud ?? throw new ArgumentNullException(nameof(cloud));
    }

    public void Resolve(string cardReferenceJson, string requestId)
    {
        Guid expectedUserId = AuthenticatedUserId();
        _ = RunAsync(
            "resolve",
            requestId,
            cancellationToken => cloud.ResolveCatalogCardAsync(
                cardReferenceJson,
                cancellationToken,
                expectedUserId));
    }

    public void Get(string cardId, string requestId)
    {
        Guid expectedUserId = AuthenticatedUserId();
        _ = RunAsync(
            "get",
            requestId,
            cancellationToken => cloud.GetCatalogCardAsync(
                ParseCardId(cardId),
                cancellationToken,
                expectedUserId));
    }

    private Guid AuthenticatedUserId()
    {
        PokeFolioAccountStatus status = cloud.GetStatus();
        if (!status.Authenticated || status.Session is null || status.Session.UserId == Guid.Empty)
        {
            throw new InvalidOperationException(
                "An authenticated account is required for catalog operations.");
        }
        return status.Session.UserId;
    }

    private async Task RunAsync(
        string operation,
        string requestId,
        Func<CancellationToken, Task<PokeFolioApiResponse>> action)
    {
        string safeRequestId = SafeRequestId(requestId);
        try
        {
            PokeFolioApiResponse response = await action(lifetime.Token);
            JsonElement? data = response.Succeeded
                ? ParseSuccessfulResponse(response.Body, operation, response.Status)
                : null;
            DesktopLog.Info(
                "CATALOG_OPERATION",
                ("operation", operation),
                ("success", response.Succeeded),
                ("status", response.Status));
            await callbacks.SendAsync("onPokeCatalogResult", new
            {
                requestId = safeRequestId,
                operation,
                ok = response.Succeeded,
                status = response.Status,
                data,
                problem = ProblemPayload(response.Problem)
            });
        }
        catch (OperationCanceledException) when (IsDisposed)
        {
            // Application shutdown cancels outstanding catalog work.
        }
        catch (Exception) when (IsDisposed)
        {
            // The native transport may finish disposal with a non-cancellation exception.
        }
        catch (Exception error)
        {
            DesktopLog.Warning(
                "CATALOG_OPERATION_FAILED",
                ("operation", operation),
                ("type", error.GetType().Name));
            await callbacks.SendAsync("onPokeCatalogResult", new
            {
                requestId = safeRequestId,
                operation,
                ok = false,
                status = 0,
                data = (object?)null,
                problem = (object?)null,
                errorType = ErrorType(error),
                error = ErrorMessage(error)
            });
        }
    }

    private static JsonElement ParseSuccessfulResponse(
        string body,
        string operation,
        int status)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(body, new JsonDocumentOptions
            {
                MaxDepth = 16
            });
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || HasDuplicateProperty(root))
            {
                throw new InvalidDataException(
                    "Catalog response must be one JSON object without duplicate properties.");
            }

            if (operation == "resolve")
            {
                ValidateResolution(root, status);
            }
            else
            {
                if (status != 200)
                {
                    throw new InvalidDataException("Catalog lookup returned an invalid status.");
                }
                ValidateCard(root);
            }
            return root.Clone();
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Catalog response is invalid.", error);
        }
    }

    private static void ValidateResolution(JsonElement root, int status)
    {
        RequireExactProperties(root, ResolutionProperties);
        if (!root.TryGetProperty("card", out JsonElement card) ||
            !root.TryGetProperty("created", out JsonElement created) ||
            created.ValueKind is not (JsonValueKind.True or JsonValueKind.False) ||
            !root.TryGetProperty("metadataMatched", out JsonElement metadataMatched) ||
            metadataMatched.ValueKind is not (JsonValueKind.True or JsonValueKind.False) ||
            status is not (200 or 201) ||
            created.GetBoolean() != (status == 201))
        {
            throw new InvalidDataException("Catalog resolution violates the API contract.");
        }
        ValidateCard(card);
    }

    private static void ValidateCard(JsonElement card)
    {
        RequireExactProperties(card, CardProperties);
        if (!card.TryGetProperty("id", out JsonElement id) ||
            !id.TryGetGuid(out Guid cardId) ||
            cardId == Guid.Empty)
        {
            throw new InvalidDataException("Catalog card id is invalid.");
        }

        string provider = RequiredString(card, "provider");
        string providerCardId = RequiredString(card, "providerCardId");
        string tcg = RequiredString(card, "tcg");
        if (!ProviderTcgs.TryGetValue(provider, out string? expectedTcg) ||
            !string.Equals(expectedTcg, tcg, StringComparison.Ordinal) ||
            providerCardId.Length is < 1 or > 160 ||
            !string.Equals(providerCardId, providerCardId.ToLowerInvariant(), StringComparison.Ordinal) ||
            providerCardId.Any(character =>
                !char.IsAsciiLetterOrDigit(character) &&
                character is not '-' and not '_' and not '.' and not ':' and not '/'))
        {
            throw new InvalidDataException("Catalog card provider identity is invalid.");
        }

        ValidateText(RequiredString(card, "name"), 240);
        ValidateText(RequiredString(card, "setCode"), 64);
        ValidateText(RequiredString(card, "number"), 64);
        if (!card.TryGetProperty("createdAt", out JsonElement createdAt) ||
            !createdAt.TryGetDateTimeOffset(out DateTimeOffset created) ||
            created == default ||
            !card.TryGetProperty("updatedAt", out JsonElement updatedAt) ||
            !updatedAt.TryGetDateTimeOffset(out DateTimeOffset updated) ||
            updated < created)
        {
            throw new InvalidDataException("Catalog card timestamps are invalid.");
        }
    }

    private static void RequireExactProperties(
        JsonElement value,
        HashSet<string> expected)
    {
        if (value.ValueKind != JsonValueKind.Object ||
            value.EnumerateObject().Count() != expected.Count ||
            value.EnumerateObject().Any(property => !expected.Contains(property.Name)))
        {
            throw new InvalidDataException("Catalog response contains unexpected fields.");
        }
    }

    private static string RequiredString(JsonElement value, string propertyName)
    {
        if (!value.TryGetProperty(propertyName, out JsonElement property) ||
            property.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"Catalog field {propertyName} is invalid.");
        }
        return property.GetString()!;
    }

    private static void ValidateText(string value, int maximumLength)
    {
        if (value.Length is < 1 ||
            value.Length > maximumLength ||
            !string.Equals(value, value.Trim(), StringComparison.Ordinal) ||
            value.Any(char.IsControl))
        {
            throw new InvalidDataException("Catalog metadata is invalid.");
        }
    }

    private static bool HasDuplicateProperty(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Array)
        {
            return value.EnumerateArray().Any(HasDuplicateProperty);
        }
        if (value.ValueKind != JsonValueKind.Object) return false;

        var propertyNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonProperty property in value.EnumerateObject())
        {
            if (!propertyNames.Add(property.Name) || HasDuplicateProperty(property.Value))
            {
                return true;
            }
        }
        return false;
    }

    private static Guid ParseCardId(string? cardId)
    {
        if (!Guid.TryParseExact(cardId, "D", out Guid parsed) || parsed == Guid.Empty)
        {
            throw new ArgumentException("Catalog card id must be a non-empty UUID.", nameof(cardId));
        }
        return parsed;
    }

    private static object? ProblemPayload(PokeFolioApiProblem? problem) =>
        problem is null ? null : new
        {
            status = problem.Status,
            code = problem.Code,
            title = problem.Title,
            errors = problem.Errors
        };

    private static string SafeRequestId(string? requestId) =>
        requestId is { Length: >= 1 and <= 128 } ? requestId : "";

    private static string ErrorType(Exception error) => error switch
    {
        ArgumentException => "validation",
        HttpRequestException => "network",
        InvalidDataException => "invalid-response",
        _ => "internal"
    };

    private static string ErrorMessage(Exception error) => error switch
    {
        ArgumentException => "Die Kartenreferenz ist ungültig.",
        HttpRequestException => "Das PokeFolio-Backend ist nicht erreichbar.",
        InvalidDataException => "Das PokeFolio-Backend hat ungültige Kartendaten geliefert.",
        _ => "Die Kataloganfrage ist fehlgeschlagen."
    };

    private bool IsDisposed => Volatile.Read(ref disposed) != 0;

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        lifetime.Cancel();
        lifetime.Dispose();
    }
}
