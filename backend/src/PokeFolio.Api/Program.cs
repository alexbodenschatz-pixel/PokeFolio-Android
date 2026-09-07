using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PokeFolio.Api.Auth;
using PokeFolio.Api.Collection;
using PokeFolio.Api.Devices;
using PokeFolio.Api.Security;
using PokeFolio.Domain.Abstractions;
using PokeFolio.Infrastructure.Identity;
using PokeFolio.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = context =>
        context.ProblemDetails.Extensions["correlationId"] = context.HttpContext.TraceIdentifier;
});
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IUserContext, HttpUserContext>();

builder.Services.AddSingleton(_ =>
{
    AuthTokenOptions options = builder.Configuration
        .GetSection(AuthTokenOptions.SectionName)
        .Get<AuthTokenOptions>()
        ?? throw new InvalidOperationException("Auth configuration is required.");
    options.Validate();
    return options;
});
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<AuthTokenService>();
builder.Services.AddSingleton<LoginTimingProtector>();
builder.Services.AddScoped<AuthSessionService>();
builder.Services.AddScoped<CollectionReadService>();
builder.Services.AddScoped<DeviceManagementService>();
builder.Services.AddScoped<ActiveDeviceSessionValidator>();

builder.Services.AddDbContext<PokeFolioDbContext>((services, options) =>
{
    string connectionString = services.GetRequiredService<IConfiguration>()
        .GetConnectionString("PokeFolio")
        ?? throw new InvalidOperationException(
            "ConnectionStrings:PokeFolio is required. Supply it through deployment secret configuration.");
    options.UseNpgsql(connectionString, npgsql =>
        npgsql.MigrationsAssembly(typeof(PokeFolioDbContext).Assembly.FullName));
});

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
    .AddEntityFrameworkStores<PokeFolioDbContext>()
    .AddSignInManager();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer();
builder.Services
    .AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<AuthTokenOptions, IHostEnvironment>((options, authTokenOptions, environment) =>
    {
        options.MapInboundClaims = false;
        options.SaveToken = false;
        options.IncludeErrorDetails = environment.IsDevelopment();
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ClockSkew = TimeSpan.FromSeconds(30),
            IssuerSigningKey = authTokenOptions.CreateSigningKey(),
            NameClaimType = "sub",
            RoleClaimType = "role",
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            ValidAudience = authTokenOptions.Audience,
            ValidIssuer = authTokenOptions.Issuer,
            ValidateAudience = true,
            ValidateIssuer = true,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var validator = context.HttpContext.RequestServices
                    .GetRequiredService<ActiveDeviceSessionValidator>();
                if (!await validator.IsActiveAsync(
                        context.Principal,
                        context.HttpContext.RequestAborted))
                {
                    context.Fail("Device session is not active.");
                }
            },
            OnChallenge = async context =>
            {
                context.HandleResponse();
                await ApiProblemWriter.WriteAsync(
                    context.Response,
                    StatusCodes.Status401Unauthorized,
                    "authentication_required",
                    "Authentication is required or the access token is invalid.",
                    context.HttpContext.RequestAborted);
            }
        };
    });
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build());
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await ApiProblemWriter.WriteAsync(
            context.HttpContext.Response,
            StatusCodes.Status429TooManyRequests,
            "rate_limit_exceeded",
            "Too many requests. Try again later.",
            cancellationToken);
    };
    options.AddPolicy("auth-sensitive", context => CreateAuthLimiter(context, permitLimit: 10));
    options.AddPolicy("auth-refresh", context => CreateAuthLimiter(context, permitLimit: 60));
});

var app = builder.Build();
app.UseExceptionHandler();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapCollectionEndpoints();
app.MapDeviceEndpoints();

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

static RateLimitPartition<string> CreateAuthLimiter(HttpContext context, int permitLimit)
{
    string partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    return RateLimitPartition.GetFixedWindowLimiter(
        partitionKey,
        _ => new FixedWindowRateLimiterOptions
        {
            AutoReplenishment = true,
            PermitLimit = permitLimit,
            QueueLimit = 0,
            Window = TimeSpan.FromMinutes(1)
        });
}

public partial class Program;
