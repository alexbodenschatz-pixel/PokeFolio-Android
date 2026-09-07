namespace PokeFolio.Domain.Abstractions;

/// <summary>Provides the authenticated user for server-side ownership filters.</summary>
public interface IUserContext
{
    Guid? UserId { get; }
}
