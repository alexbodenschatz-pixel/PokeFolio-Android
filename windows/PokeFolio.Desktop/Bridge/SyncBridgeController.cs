using System.Text.Json;
using PokeFolio.Desktop.Backend;
using PokeFolio.Desktop.Diagnostics;

namespace PokeFolio.Desktop.Bridge;

internal sealed class SyncBridgeController : IDisposable
{
    private readonly IJavaScriptCallbackDispatcher callbacks;
    private readonly IPokeFolioSyncService sync;
    private readonly CancellationTokenSource lifetime = new();
    private int disposed;

    public SyncBridgeController(
        IJavaScriptCallbackDispatcher callbacks,
        IPokeFolioSyncService sync)
    {
        this.callbacks = callbacks ?? throw new ArgumentNullException(nameof(callbacks));
        this.sync = sync ?? throw new ArgumentNullException(nameof(sync));
    }

    public void Push(string operationBatchJson, string requestId) =>
        _ = RunAsync(
            "push",
            requestId,
            cancellationToken => sync.PushSyncOperationsAsync(
                operationBatchJson,
                cancellationToken));

    public void Pull(string? cursor, int limit, string requestId) =>
        _ = RunAsync(
            "pull",
            requestId,
            cancellationToken => sync.PullSyncChangesAsync(
                string.IsNullOrEmpty(cursor) ? null : cursor,
                limit,
                cancellationToken));

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
                ? ParseSuccessfulResponse(response.Body, operation)
                : null;
            DesktopLog.Info(
                "SYNC_OPERATION",
                ("operation", operation),
                ("success", response.Succeeded),
                ("status", response.Status));
            await callbacks.SendAsync("onDesktopSyncResult", new
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
            // Application shutdown cancels outstanding sync work.
        }
        catch (Exception) when (IsDisposed)
        {
            // The native transport may finish disposal with a non-cancellation exception.
        }
        catch (Exception error)
        {
            DesktopLog.Warning(
                "SYNC_OPERATION_FAILED",
                ("operation", operation),
                ("type", error.GetType().Name));
            await callbacks.SendAsync("onDesktopSyncResult", new
            {
                requestId = safeRequestId,
                operation,
                ok = false,
                status = 0,
                data = (object?)null,
                problem = (object?)null,
                errorType = SyncErrorType(error),
                error = SyncErrorMessage(error)
            });
        }
    }

    private static JsonElement ParseSuccessfulResponse(string body, string operation)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(body, new JsonDocumentOptions
            {
                MaxDepth = 64
            });
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || HasDuplicateProperty(root))
            {
                throw new InvalidDataException(
                    "Sync response must be one JSON object without duplicate properties.");
            }
            ValidateEnvelope(root, operation);
            return root.Clone();
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Sync response is invalid.", error);
        }
    }

    private static void ValidateEnvelope(JsonElement root, string operation)
    {
        if (operation == "push")
        {
            if (!root.TryGetProperty("results", out JsonElement results) ||
                results.ValueKind != JsonValueKind.Array ||
                results.GetArrayLength() > 100)
            {
                throw new InvalidDataException("Sync push response violates the API contract.");
            }
            return;
        }

        if (!root.TryGetProperty("changes", out JsonElement changes) ||
            changes.ValueKind != JsonValueKind.Array ||
            changes.GetArrayLength() > 500 ||
            !root.TryGetProperty("nextCursor", out JsonElement nextCursor) ||
            nextCursor.ValueKind != JsonValueKind.String ||
            string.IsNullOrEmpty(nextCursor.GetString()) ||
            nextCursor.GetString()!.Length > 2048 ||
            !root.TryGetProperty("hasMore", out JsonElement hasMore) ||
            hasMore.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new InvalidDataException("Sync pull response violates the API contract.");
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

    private static string SyncErrorType(Exception error) => error switch
    {
        ArgumentException => "validation",
        HttpRequestException => "network",
        InvalidDataException => "invalid-response",
        _ => "internal"
    };

    private static string SyncErrorMessage(Exception error) => error switch
    {
        ArgumentException => "Die Synchronisationsanfrage ist ungültig.",
        HttpRequestException => "Das PokeFolio-Backend ist nicht erreichbar.",
        InvalidDataException => "Das PokeFolio-Backend hat ungültige Sync-Daten geliefert.",
        _ => "Die Synchronisation ist fehlgeschlagen."
    };

    private bool IsDisposed => Volatile.Read(ref disposed) != 0;

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        lifetime.Cancel();
        lifetime.Dispose();
    }
}
