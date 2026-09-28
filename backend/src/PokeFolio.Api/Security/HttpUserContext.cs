using PokeFolio.Domain.Abstractions;

namespace PokeFolio.Api.Security;

public sealed class HttpUserContext(IHttpContextAccessor accessor) : IUserContext
{
    public Guid? UserId => PrincipalIdentity.GetUserId(accessor.HttpContext?.User);
}
