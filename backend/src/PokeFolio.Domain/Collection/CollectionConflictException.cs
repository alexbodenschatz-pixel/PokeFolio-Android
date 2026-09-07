namespace PokeFolio.Domain.Collection;

public sealed class CollectionConflictException(string message) : InvalidOperationException(message);
