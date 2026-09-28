using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PokeFolio.Domain.Collection;
using PokeFolio.Infrastructure.Persistence;
using PokeFolio.Infrastructure.Sync;

namespace PokeFolio.Api.Collection;

public sealed class CollectionMutationService(
    PokeFolioDbContext database,
    TimeProvider timeProvider)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<CollectionMutationResult> CreateAsync(
        Guid userId,
        Guid deviceSessionId,
        Guid operationId,
        CreateHoldingCommand command,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<string, string[]> errors = CollectionCommandValidator.Validate(command);
        if (errors.Count > 0) return ValidationFailed(errors);
        const string operationKind = "holding.create";
        string requestHash = HashRequest(operationKind, command);

        try
        {
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            await AcquireOperationLockAsync(userId, operationId, cancellationToken);
            CollectionMutationResult? replay = await FindReplayAsync(
                userId,
                operationId,
                operationKind,
                requestHash,
                cancellationToken);
            if (replay is not null)
            {
                await transaction.CommitAsync(cancellationToken);
                return replay;
            }

            if (!await database.Cards.AsNoTracking()
                    .AnyAsync(card => card.Id == command.CardId, cancellationToken))
            {
                return Failed(
                    StatusCodes.Status400BadRequest,
                    "unknown_card",
                    "The selected catalog card does not exist.");
            }

            DateTimeOffset now = timeProvider.GetUtcNow();
            CollectionHolding holding = CollectionHolding.Create(
                command.Id,
                userId,
                command.CardId,
                command.VariantId,
                CollectionCommandValidator.NormalizeLanguage(command.Language!),
                command.Variant!,
                command.Condition!,
                command.Quantity,
                command.Notes,
                now);
            CollectionHoldingResponse response = ToResponse(holding);
            string payload = JsonSerializer.Serialize(response, JsonOptions);
            database.CollectionHoldings.Add(holding);
            AddSuccessRecords(
                userId,
                deviceSessionId,
                operationId,
                operationKind,
                requestHash,
                holding.Id,
                "upsert",
                holding.Version,
                payload,
                now);
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return CollectionMutationResult.Success(response);
        }
        catch (DbUpdateException error) when (
            error.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation
            })
        {
            return Failed(
                StatusCodes.Status409Conflict,
                "holding_conflict",
                "A holding with the same identifier or card identity already exists.");
        }
    }

    public async Task<CollectionMutationResult> ApplyQuantityDeltaAsync(
        Guid userId,
        Guid deviceSessionId,
        Guid holdingId,
        Guid operationId,
        QuantityDeltaCommand command,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<string, string[]> errors = CollectionCommandValidator.Validate(command);
        if (errors.Count > 0) return ValidationFailed(errors);
        if (command.OperationId != operationId)
        {
            return Failed(
                StatusCodes.Status400BadRequest,
                "idempotency_key_mismatch",
                "Idempotency-Key must match the operationId in the request body.");
        }
        const string operationKind = "holding.quantityDelta";
        string requestHash = HashRequest(
            operationKind,
            new QuantityDeltaFingerprint(holdingId, command));

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await AcquireOperationLockAsync(userId, operationId, cancellationToken);
        CollectionMutationResult? replay = await FindReplayAsync(
            userId,
            operationId,
            operationKind,
            requestHash,
            cancellationToken);
        if (replay is not null)
        {
            await transaction.CommitAsync(cancellationToken);
            return replay;
        }

        DateTimeOffset now = timeProvider.GetUtcNow();
        IQueryable<CollectionHolding> target = database.CollectionHoldings.Where(holding =>
            holding.UserId == userId &&
            holding.Id == holdingId &&
            holding.Version < long.MaxValue);
        target = command.Delta > 0
            ? target.Where(holding =>
                holding.Quantity <= CollectionHolding.MaximumQuantity - command.Delta)
            : target.Where(holding => holding.Quantity >= -command.Delta);

        int updated = await target.ExecuteUpdateAsync(
            setters => setters
                .SetProperty(holding => holding.Quantity, holding => holding.Quantity + command.Delta)
                .SetProperty(holding => holding.Version, holding => holding.Version + 1)
                .SetProperty(
                    holding => holding.UpdatedAt,
                    holding => holding.UpdatedAt > now ? holding.UpdatedAt : now),
            cancellationToken);
        if (updated != 1)
        {
            bool exists = await database.CollectionHoldings.AsNoTracking().AnyAsync(
                holding => holding.UserId == userId && holding.Id == holdingId,
                cancellationToken);
            return exists
                ? Failed(
                    StatusCodes.Status409Conflict,
                    "quantity_conflict",
                    $"Quantity must remain between 0 and {CollectionHolding.MaximumQuantity}.")
                : Failed(
                    StatusCodes.Status404NotFound,
                    "holding_not_found",
                    "The selected collection holding was not found.");
        }

        CollectionHolding changed = await database.CollectionHoldings.AsNoTracking().SingleAsync(
            holding => holding.UserId == userId && holding.Id == holdingId,
            cancellationToken);
        CollectionHoldingResponse response = ToResponse(changed);
        string payload = JsonSerializer.Serialize(response, JsonOptions);
        AddSuccessRecords(
            userId,
            deviceSessionId,
            operationId,
            operationKind,
            requestHash,
            changed.Id,
            "upsert",
            changed.Version,
            payload,
            now);
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return CollectionMutationResult.Success(response);
    }

    public async Task<CollectionMutationResult> UpdateAsync(
        Guid userId,
        Guid deviceSessionId,
        Guid holdingId,
        Guid operationId,
        long expectedVersion,
        JsonElement command,
        CancellationToken cancellationToken)
    {
        if (!CollectionCommandValidator.TryParseUpdate(
                command,
                out UpdateHoldingPatch patch,
                out IReadOnlyDictionary<string, string[]> errors))
        {
            return ValidationFailed(errors);
        }

        const string operationKind = "holding.update";
        string requestHash = HashRequest(
            operationKind,
            new UpdateFingerprint(holdingId, expectedVersion, patch));
        try
        {
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            await AcquireOperationLockAsync(userId, operationId, cancellationToken);
            CollectionMutationResult? replay = await FindReplayAsync(
                userId,
                operationId,
                operationKind,
                requestHash,
                cancellationToken);
            if (replay is not null)
            {
                await transaction.CommitAsync(cancellationToken);
                return replay;
            }

            CollectionHolding? holding = await database.CollectionHoldings.SingleOrDefaultAsync(
                item => item.UserId == userId && item.Id == holdingId,
                cancellationToken);
            if (holding is null)
            {
                return Failed(
                    StatusCodes.Status404NotFound,
                    "holding_not_found",
                    "The selected collection holding was not found.");
            }
            if (holding.Version != expectedVersion || holding.Version == long.MaxValue)
            {
                return PreconditionFailed();
            }

            DateTimeOffset now = timeProvider.GetUtcNow();
            holding.UpdateDetails(
                expectedVersion,
                patch.HasLanguage
                    ? CollectionCommandValidator.NormalizeLanguage(patch.Language!)
                    : holding.Language,
                patch.HasVariant ? patch.Variant! : holding.Variant,
                patch.HasCondition ? patch.Condition! : holding.Condition,
                patch.HasNotes ? patch.Notes : holding.Notes,
                now);
            CollectionHoldingResponse response = ToResponse(holding);
            string payload = JsonSerializer.Serialize(response, JsonOptions);
            AddSuccessRecords(
                userId,
                deviceSessionId,
                operationId,
                operationKind,
                requestHash,
                holding.Id,
                "upsert",
                holding.Version,
                payload,
                now);
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return CollectionMutationResult.Success(response);
        }
        catch (DbUpdateConcurrencyException)
        {
            return PreconditionFailed();
        }
        catch (DbUpdateException error) when (
            error.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation
            })
        {
            return Failed(
                StatusCodes.Status409Conflict,
                "holding_conflict",
                "Another holding already uses the requested card identity.");
        }
    }

    public async Task<CollectionMutationResult> DeleteAsync(
        Guid userId,
        Guid deviceSessionId,
        Guid holdingId,
        Guid operationId,
        long expectedVersion,
        CancellationToken cancellationToken)
    {
        const string operationKind = "holding.delete";
        string requestHash = HashRequest(
            operationKind,
            new DeleteFingerprint(holdingId, expectedVersion));
        try
        {
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            await AcquireOperationLockAsync(userId, operationId, cancellationToken);
            CollectionMutationResult? replay = await FindReplayAsync(
                userId,
                operationId,
                operationKind,
                requestHash,
                cancellationToken);
            if (replay is not null)
            {
                await transaction.CommitAsync(cancellationToken);
                return replay;
            }

            CollectionHolding? holding = await database.CollectionHoldings.SingleOrDefaultAsync(
                item => item.UserId == userId && item.Id == holdingId,
                cancellationToken);
            if (holding is null)
            {
                return Failed(
                    StatusCodes.Status404NotFound,
                    "holding_not_found",
                    "The selected collection holding was not found.");
            }
            if (holding.Version != expectedVersion || holding.Version == long.MaxValue)
            {
                return PreconditionFailed();
            }

            DateTimeOffset now = timeProvider.GetUtcNow();
            holding.MarkDeleted(expectedVersion, now);
            CollectionHoldingResponse tombstone = ToResponse(holding) with
            {
                Quantity = 0
            };
            string responseJson = JsonSerializer.Serialize(tombstone, JsonOptions);
            AddSuccessRecords(
                userId,
                deviceSessionId,
                operationId,
                operationKind,
                requestHash,
                holding.Id,
                "delete",
                tombstone.Version,
                responseJson,
                now,
                tombstone: true);
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return CollectionMutationResult.Success(tombstone);
        }
        catch (DbUpdateConcurrencyException)
        {
            return PreconditionFailed();
        }
    }

    private async Task AcquireOperationLockAsync(
        Guid userId,
        Guid operationId,
        CancellationToken cancellationToken)
    {
        long lockKey = CreateLockKey(userId, operationId);
        await database.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({lockKey})",
            cancellationToken);
    }

    private async Task<CollectionMutationResult?> FindReplayAsync(
        Guid userId,
        Guid operationId,
        string operationKind,
        string requestHash,
        CancellationToken cancellationToken)
    {
        var processed = await database.ProcessedSyncOperations
            .AsNoTracking()
            .Where(operation =>
                operation.UserId == userId &&
                operation.OperationId == operationId)
            .Select(operation => new
            {
                operation.Status,
                operation.OperationKind,
                operation.RequestHash,
                operation.ResponseJson
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (processed is null) return null;
        if (!string.Equals(processed.Status, "succeeded", StringComparison.Ordinal) ||
            !string.Equals(processed.OperationKind, operationKind, StringComparison.Ordinal) ||
            !string.Equals(processed.RequestHash, requestHash, StringComparison.Ordinal))
        {
            return Failed(
                StatusCodes.Status409Conflict,
                "idempotency_key_reused",
                "Idempotency-Key was already used for a different mutation.");
        }

        CollectionHoldingResponse response = JsonSerializer.Deserialize<CollectionHoldingResponse>(
            processed.ResponseJson
                ?? throw new InvalidOperationException("Stored idempotency response is missing."),
            JsonOptions)
            ?? throw new InvalidOperationException("Stored idempotency response is invalid.");
        return CollectionMutationResult.Success(response, replayed: true);
    }

    private void AddSuccessRecords(
        Guid userId,
        Guid deviceSessionId,
        Guid operationId,
        string operationKind,
        string requestHash,
        Guid holdingId,
        string action,
        long version,
        string payload,
        DateTimeOffset now,
        bool tombstone = false)
    {
        database.ProcessedSyncOperations.Add(new ProcessedSyncOperation
        {
            UserId = userId,
            DeviceSessionId = deviceSessionId,
            OperationId = operationId,
            OperationKind = operationKind,
            RequestHash = requestHash,
            Status = "succeeded",
            ResponseJson = payload,
            ProcessedAt = now
        });
        database.UserChanges.Add(new UserChange
        {
            UserId = userId,
            EntityType = "holding",
            EntityId = holdingId,
            Action = action,
            Version = version,
            PayloadJson = tombstone ? null : payload,
            OccurredAt = now
        });
    }

    private static long CreateLockKey(Guid userId, Guid operationId)
    {
        byte[] input = new byte[32];
        userId.ToByteArray().CopyTo(input, 0);
        operationId.ToByteArray().CopyTo(input, 16);
        byte[] hash = SHA256.HashData(input);
        return BinaryPrimitives.ReadInt64BigEndian(hash);
    }

    private static string HashRequest<TPayload>(string operationKind, TPayload payload)
    {
        byte[] serialized = JsonSerializer.SerializeToUtf8Bytes(
            new RequestFingerprint<TPayload>(operationKind, payload),
            JsonOptions);
        return Convert.ToHexStringLower(SHA256.HashData(serialized));
    }

    private static CollectionHoldingResponse ToResponse(CollectionHolding holding) => new(
        holding.Id,
        holding.CardId,
        holding.VariantId,
        holding.Language,
        holding.Variant,
        holding.Condition,
        holding.Quantity,
        holding.Notes,
        holding.Version,
        holding.CreatedAt,
        holding.UpdatedAt);

    private static CollectionMutationResult ValidationFailed(
        IReadOnlyDictionary<string, string[]> errors) =>
        CollectionMutationResult.Failed(new CollectionMutationFailure(
            StatusCodes.Status400BadRequest,
            "validation_failed",
            "One or more fields are invalid.",
            errors));

    private static CollectionMutationResult Failed(int status, string code, string title) =>
        CollectionMutationResult.Failed(new CollectionMutationFailure(status, code, title));

    private static CollectionMutationResult PreconditionFailed() => Failed(
        StatusCodes.Status412PreconditionFailed,
        "version_mismatch",
        "If-Match does not match the current holding version.");

    private sealed record RequestFingerprint<TPayload>(string OperationKind, TPayload Payload);
    private sealed record QuantityDeltaFingerprint(Guid HoldingId, QuantityDeltaCommand Command);
    private sealed record UpdateFingerprint(
        Guid HoldingId,
        long ExpectedVersion,
        UpdateHoldingPatch Patch);
    private sealed record DeleteFingerprint(Guid HoldingId, long ExpectedVersion);
}
