using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using PokeFolio.Infrastructure.Identity;

namespace PokeFolio.Api.Auth;

public sealed class LoginTimingProtector
{
    private const string DummyPassword = "PokeFolio dummy password 2026!";
    private readonly ApplicationUser dummyUser = new() { Id = Guid.NewGuid() };
    private readonly PasswordHasher<ApplicationUser> passwordHasher;
    private readonly string dummyHash;

    public LoginTimingProtector(IOptions<PasswordHasherOptions> options)
    {
        passwordHasher = new PasswordHasher<ApplicationUser>(options);
        dummyHash = passwordHasher.HashPassword(dummyUser, DummyPassword);
    }

    public void ConsumeEquivalentPasswordWork(string suppliedPassword) =>
        _ = passwordHasher.VerifyHashedPassword(dummyUser, dummyHash, suppliedPassword);
}
