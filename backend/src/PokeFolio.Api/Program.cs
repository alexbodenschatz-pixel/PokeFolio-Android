using Microsoft.EntityFrameworkCore;
using PokeFolio.Api.Security;
using PokeFolio.Domain.Abstractions;
using PokeFolio.Infrastructure.Identity;
using PokeFolio.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IUserContext, HttpUserContext>();

string connectionString = builder.Configuration.GetConnectionString("PokeFolio")
    ?? throw new InvalidOperationException(
        "ConnectionStrings:PokeFolio is required. Supply it through deployment secret configuration.");

builder.Services.AddDbContext<PokeFolioDbContext>(options =>
    options.UseNpgsql(connectionString, npgsql =>
        npgsql.MigrationsAssembly(typeof(PokeFolioDbContext).Assembly.FullName)));

builder.Services
    .AddIdentityCore<ApplicationUser>(options =>
    {
        options.Password.RequiredLength = 12;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.User.RequireUniqueEmail = true;
        options.Lockout.AllowedForNewUsers = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    })
    .AddEntityFrameworkStores<PokeFolioDbContext>();

var app = builder.Build();
app.UseExceptionHandler();

app.MapGet("/health/live", () => Results.Ok(new
{
    status = "live",
    service = "pokefolio-api",
    utc = DateTimeOffset.UtcNow
})).AllowAnonymous();

app.MapGet("/health/ready", async (PokeFolioDbContext database, CancellationToken cancellationToken) =>
    await database.Database.CanConnectAsync(cancellationToken)
        ? Results.Ok(new { status = "ready" })
        : Results.Problem(
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: "Database unavailable",
            extensions: new Dictionary<string, object?> { ["code"] = "database_unavailable" }))
    .AllowAnonymous();

app.Run();

public partial class Program;
