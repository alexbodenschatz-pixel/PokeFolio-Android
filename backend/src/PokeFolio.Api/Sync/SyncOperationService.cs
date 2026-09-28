using PokeFolio.Api.Collection;

namespace PokeFolio.Api.Sync;

public sealed class SyncOperationService(IServiceScopeFactory scopeFactory)
{
    public async Task<SyncOperationResultBatchResponse> ExecuteAsync(
        Guid userId,
        Guid deviceSessionId,
        IReadOnlyList<SyncOperationCommand> operations,
        string correlationId,
        CancellationToken cancellationToken)
    {
        var results = new List<SyncOperationResultResponse>(operations.Count);
        foreach (SyncOperationCommand operation in operations)
        {
            results.Add(await ExecuteOneAsync(
                userId,
                deviceSessionId,
                operation,
                correlationId,
                cancellationToken));
        }
        return new SyncOperationResultBatchResponse(results);
    }

    private async Task<SyncOperationResultResponse> ExecuteOneAsync(
        Guid userId,
        Guid deviceSessionId,
        SyncOperationCommand operation,
        string correlationId,
        CancellationToken cancellationToken)
    {
        if (operation.OperationId == Guid.Empty)
        {
            return Rejected(
                operation.OperationId,
                "validation_failed",
                "Operation id must be a non-empty UUID.",
                correlationId);
        }

        await using AsyncServiceScope scope = scopeFactory.CreateAsyncScope();
        CollectionMutationService collection = scope.ServiceProvider
            .GetRequiredService<CollectionMutationService>();
        CollectionMutationResult mutation = operation switch
        {
            SyncHoldingCreateOperationCommand { Holding: not null } create =>
                await collection.CreateAsync(
                    userId,
                    deviceSessionId,
                    create.OperationId,
                    create.Holding,
                    cancellationToken),
            SyncHoldingCreateOperationCommand => InvalidOperation(
                "Holding payload is required."),
            SyncQuantityDeltaOperationCommand delta when delta.HoldingId != Guid.Empty =>
                await collection.ApplyQuantityDeltaAsync(
                    userId,
                    deviceSessionId,
                    delta.HoldingId,
                    delta.OperationId,
                    new QuantityDeltaCommand(delta.OperationId, delta.Delta),
                    cancellationToken),
            SyncQuantityDeltaOperationCommand => InvalidOperation(
                "Holding id must be a non-empty UUID."),
            SyncHoldingUpdateOperationCommand update
                when update.HoldingId != Guid.Empty && update.BaseVersion > 0 =>
                await collection.UpdateAsync(
                    userId,
                    deviceSessionId,
                    update.HoldingId,
                    update.OperationId,
                    update.BaseVersion,
                    update.Changes,
                    cancellationToken),
            SyncHoldingUpdateOperationCommand => InvalidOperation(
                "Holding id and a positive baseVersion are required."),
            SyncHoldingDeleteOperationCommand remove
                when remove.HoldingId != Guid.Empty && remove.BaseVersion > 0 =>
                await collection.DeleteAsync(
                    userId,
                    deviceSessionId,
                    remove.HoldingId,
                    remove.OperationId,
                    remove.BaseVersion,
                    cancellationToken),
            SyncHoldingDeleteOperationCommand => InvalidOperation(
                "Holding id and a positive baseVersion are required."),
            _ => InvalidOperation("Operation kind is not supported.")
        };

        return ToResponse(operation.OperationId, mutation, correlationId);
    }

    private static SyncOperationResultResponse ToResponse(
        Guid operationId,
        CollectionMutationResult mutation,
        string correlationId)
    {
        if (mutation.Holding is not null)
        {
            return new SyncOperationResultResponse(
                operationId,
                mutation.Replayed ? "duplicate" : "applied",
                mutation.Holding,
                null);
        }

        CollectionMutationFailure failure = mutation.Failure!;
        string status = failure.Status is
            StatusCodes.Status409Conflict or
            StatusCodes.Status412PreconditionFailed
            ? "conflict"
            : "rejected";
        return new SyncOperationResultResponse(
            operationId,
            status,
            null,
            new SyncOperationProblemResponse(
                "about:blank",
                failure.Title,
                failure.Status,
                failure.Code,
                correlationId,
                failure.Errors));
    }

    private static CollectionMutationResult InvalidOperation(string title) =>
        CollectionMutationResult.Failed(new CollectionMutationFailure(
            StatusCodes.Status400BadRequest,
            "validation_failed",
            title));

    private static SyncOperationResultResponse Rejected(
        Guid operationId,
        string code,
        string title,
        string correlationId) => new(
            operationId,
            "rejected",
            null,
            new SyncOperationProblemResponse(
                "about:blank",
                title,
                StatusCodes.Status400BadRequest,
                code,
                correlationId));
}
