using System.Security.Claims;
using PokeFolio.Domain.Abstractions;

namespace PokeFolio.Api.Security;

public sealed class HttpUserContext(IHttpContextAccessor accessor) : IUserContext
{
    public Guid? UserId
    {
        get
        {
            string? subject = accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
            return Guid.TryParse(subject, out Guid userId) ? userId : null;
        }
    }
}
