namespace PokeFolio.Domain.Collection;

public sealed class CollectionHolding
{
    public const int MaximumQuantity = 1_000_000;

    private CollectionHolding()
    {
    }

    private CollectionHolding(
        Guid id,
        Guid userId,
        Guid cardId,
        Guid? variantId,
        string language,
        string variant,
        string condition,
        int quantity,
        string? notes,
        DateTimeOffset now)
    {
        Id = RequireId(id, nameof(id));
        UserId = RequireId(userId, nameof(userId));
        CardId = RequireId(cardId, nameof(cardId));
        VariantId = variantId;
        Language = RequireText(language, 16, nameof(language));
        Variant = RequireText(variant, 80, nameof(variant));
        Condition = RequireText(condition, 40, nameof(condition));
        Quantity = quantity is > 0 and <= MaximumQuantity
            ? quantity
            : throw new ArgumentOutOfRangeException(
                nameof(quantity),
                $"Initial quantity must be between 1 and {MaximumQuantity}.");
        Notes = NormalizeOptionalText(notes, 10_000, nameof(notes));
        Version = 1;
        CreatedAt = now;
        UpdatedAt = now;
    }

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public Guid CardId { get; private set; }
    public Guid? VariantId { get; private set; }
    public string Language { get; private set; } = string.Empty;
    public string Variant { get; private set; } = string.Empty;
    public string Condition { get; private set; } = string.Empty;
    public int Quantity { get; private set; }
    public string? Notes { get; private set; }
    public long Version { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public DateTimeOffset? DeletedAt { get; private set; }

    public static CollectionHolding Create(
        Guid id,
        Guid userId,
        Guid cardId,
        Guid? variantId,
        string language,
        string variant,
        string condition,
        int quantity,
        string? notes,
        DateTimeOffset now) =>
        new(id, userId, cardId, variantId, language, variant, condition, quantity, notes, now);

    public void ApplyQuantityDelta(int delta, DateTimeOffset now)
    {
        if (delta == 0) throw new ArgumentOutOfRangeException(nameof(delta), "Quantity delta cannot be zero.");
        if (delta is < -10_000 or > 10_000)
        {
            throw new ArgumentOutOfRangeException(nameof(delta), "Quantity delta exceeds the command limit.");
        }

        int updated;
        try
        {
            updated = checked(Quantity + delta);
        }
        catch (OverflowException error)
        {
            throw new CollectionConflictException(error.Message);
        }

        if (updated is < 0 or > MaximumQuantity)
        {
            throw new CollectionConflictException(
                $"Quantity must remain between 0 and {MaximumQuantity}.");
        }
        Quantity = updated;
        Touch(now);
    }

    public void UpdateDetails(
        long expectedVersion,
        string language,
        string variant,
        string condition,
        string? notes,
        DateTimeOffset now)
    {
        if (expectedVersion != Version)
        {
            throw new CollectionConflictException("The holding was changed by another operation.");
        }

        Language = RequireText(language, 16, nameof(language));
        Variant = RequireText(variant, 80, nameof(variant));
        Condition = RequireText(condition, 40, nameof(condition));
        Notes = NormalizeOptionalText(notes, 10_000, nameof(notes));
        Touch(now);
    }

    public void MarkDeleted(long expectedVersion, DateTimeOffset now)
    {
        if (expectedVersion != Version)
        {
            throw new CollectionConflictException("The holding was changed by another operation.");
        }
        if (DeletedAt.HasValue)
        {
            throw new CollectionConflictException("The holding was already deleted.");
        }

        Touch(now);
        DeletedAt = now;
    }

    private void Touch(DateTimeOffset now)
    {
        if (now < UpdatedAt) throw new ArgumentOutOfRangeException(nameof(now), "Timestamp cannot move backwards.");
        Version = checked(Version + 1);
        UpdatedAt = now;
    }

    private static Guid RequireId(Guid value, string parameterName) =>
        value != Guid.Empty ? value : throw new ArgumentException("Identifier cannot be empty.", parameterName);

    private static string RequireText(string value, int maximumLength, string parameterName)
    {
        string normalized = value?.Trim() ?? string.Empty;
        if (normalized.Length == 0 || normalized.Length > maximumLength)
        {
            throw new ArgumentException($"Value must contain 1 to {maximumLength} characters.", parameterName);
        }
        return normalized;
    }

    private static string? NormalizeOptionalText(string? value, int maximumLength, string parameterName)
    {
        string? normalized = value?.Trim();
        if (normalized?.Length > maximumLength)
        {
            throw new ArgumentException($"Value cannot exceed {maximumLength} characters.", parameterName);
        }
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }
}
