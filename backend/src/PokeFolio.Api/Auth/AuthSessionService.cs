using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PokeFolio.Infrastructure.Identity;
using PokeFolio.Infrastructure.Persistence;

namespace PokeFolio.Api.Auth;

public sealed class AuthSessionService(
    PokeFolioDbContext database,
    UserManager<ApplicationUser> userManager,
    SignInManager<ApplicationUser> signInManager,
    AuthTokenService tokenService,
    LoginTimingProtector timingProtector,
    TimeProvider timeProvider)
{
    private static readonly AuthFailure InvalidCredentials = new(
        StatusCodes.Status401Unauthorized,
        "invalid_credentials",
        "Email or password is invalid.");

    public async Task<AuthOperationResult> RegisterAsync(
        RegisterCommand command,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<string, string[]> errors = AuthCommandValidator.Validate(command);
        if (errors.Count > 0) return ValidationFailed(errors);

        string email = AuthCommandValidator.NormalizeEmail(command.Email!);
        DateTimeOffset now = timeProvider.GetUtcNow();
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            Email = email,
            UserName = email,
            CreatedAt = now,
            UpdatedAt = now
        };
        RefreshTokenMaterial refreshToken = tokenService.CreateRefreshToken();
        DeviceSession device = CreateDeviceSession(
            user.Id,
            command.DeviceName!,
            command.Platform!,
            refreshToken,
            now);

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        IdentityResult identityResult = await userManager.CreateAsync(user, command.Password!);
        if (!identityResult.Succeeded)
        {
            await transaction.RollbackAsync(cancellationToken);
            return IdentityFailed(identityResult);
        }

        database.DeviceSessions.Add(device);
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return AuthOperationResult.Success(CreateResponse(user.Id, device, refreshToken));
    }

    public async Task<AuthOperationResult> LoginAsync(
        LoginCommand command,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<string, string[]> errors = AuthCommandValidator.Validate(command);
        if (errors.Count > 0) return ValidationFailed(errors);

        string email = AuthCommandValidator.NormalizeEmail(command.Email!);
        ApplicationUser? user = await userManager.FindByEmailAsync(email);
        if (user is null)
        {
            timingProtector.ConsumeEquivalentPasswordWork(command.Password!);
            return AuthOperationResult.Failed(InvalidCredentials);
        }

        SignInResult signIn = await signInManager.CheckPasswordSignInAsync(
            user,
            command.Password!,
            lockoutOnFailure: true);
        if (!signIn.Succeeded)
        {
            return AuthOperationResult.Failed(InvalidCredentials);
        }

        DateTimeOffset now = timeProvider.GetUtcNow();
        RefreshTokenMaterial refreshToken = tokenService.CreateRefreshToken();
        DeviceSession device = CreateDeviceSession(
            user.Id,
            command.DeviceName!,
            command.Platform!,
            refreshToken,
            now);
        database.DeviceSessions.Add(device);
        await database.SaveChangesAsync(cancellationToken);
        return AuthOperationResult.Success(CreateResponse(user.Id, device, refreshToken));
    }

    public async Task<AuthOperationResult> RefreshAsync(
        RefreshCommand command,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<string, string[]> errors = AuthCommandValidator.Validate(command);
        if (errors.Count > 0) return ValidationFailed(errors);

        string tokenHash = AuthTokenService.HashRefreshToken(command.RefreshToken!);
        DateTimeOffset now = timeProvider.GetUtcNow();
        DeviceSession? current = await database.DeviceSessions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(device => device.RefreshTokenHash == tokenHash, cancellationToken);

        if (current is null)
        {
            await RevokeReplayedTokenFamilyAsync(tokenHash, now, cancellationToken);
            return AuthOperationResult.Failed(InvalidRefreshToken());
        }
        if (current.RevokedAt.HasValue || current.ExpiresAt <= now)
        {
            await RevokeDeviceAsync(current.UserId, current.Id, now, cancellationToken);
            return AuthOperationResult.Failed(InvalidRefreshToken());
        }

        RefreshTokenMaterial replacement = tokenService.CreateRefreshToken();
        int updated;
        await using (var transaction = await database.Database.BeginTransactionAsync(cancellationToken))
        {
            updated = await database.DeviceSessions
                .IgnoreQueryFilters()
                .Where(device =>
                    device.Id == current.Id &&
                    device.UserId == current.UserId &&
                    device.TokenFamilyId == current.TokenFamilyId &&
                    device.RefreshTokenHash == tokenHash &&
                    device.RevokedAt == null &&
                    device.ExpiresAt > now)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(device => device.RefreshTokenHash, replacement.Hash)
                        .SetProperty(device => device.LastSeenAt, now)
                        .SetProperty(device => device.ExpiresAt, replacement.ExpiresAt),
                    cancellationToken);
            if (updated == 1)
            {
                database.ConsumedRefreshTokens.Add(new ConsumedRefreshToken
                {
                    TokenHash = tokenHash,
                    UserId = current.UserId,
                    DeviceSessionId = current.Id,
                    TokenFamilyId = current.TokenFamilyId,
                    ConsumedAt = now,
                    ExpiresAt = current.ExpiresAt
                });
                await database.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
            else
            {
                await transaction.RollbackAsync(cancellationToken);
            }
        }

        if (updated != 1)
        {
            await RevokeReplayedTokenFamilyAsync(tokenHash, now, cancellationToken);
            return AuthOperationResult.Failed(InvalidRefreshToken());
        }

        current.RefreshTokenHash = replacement.Hash;
        current.LastSeenAt = now;
        current.ExpiresAt = replacement.ExpiresAt;
        return AuthOperationResult.Success(CreateResponse(current.UserId, current, replacement));
    }

    public async Task RevokeCurrentDeviceAsync(
        Guid userId,
        Guid deviceSessionId,
        CancellationToken cancellationToken) =>
        await RevokeDeviceAsync(userId, deviceSessionId, timeProvider.GetUtcNow(), cancellationToken);

    public async Task<AuthCommandResult> ChangePasswordAsync(
        Guid userId,
        Guid currentDeviceSessionId,
        ChangePasswordCommand command,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<string, string[]> errors = AuthCommandValidator.Validate(command);
        if (errors.Count > 0)
        {
            return AuthCommandResult.Failed(new AuthFailure(
                StatusCodes.Status400BadRequest,
                "validation_failed",
                "One or more fields are invalid.",
                errors));
        }

        ApplicationUser? user = await userManager.FindByIdAsync(userId.ToString());
        if (user is null)
        {
            return AuthCommandResult.Failed(new AuthFailure(
                StatusCodes.Status401Unauthorized,
                "authentication_required",
                "Authentication is required."));
        }

        DateTimeOffset now = timeProvider.GetUtcNow();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        user.UpdatedAt = now;
        IdentityResult result = await userManager.ChangePasswordAsync(
            user,
            command.CurrentPassword!,
            command.NewPassword!);
        if (!result.Succeeded)
        {
            await transaction.RollbackAsync(cancellationToken);
            bool currentPasswordInvalid = result.Errors.Any(error =>
                string.Equals(error.Code, "PasswordMismatch", StringComparison.Ordinal));
            return currentPasswordInvalid
                ? AuthCommandResult.Failed(new AuthFailure(
                    StatusCodes.Status400BadRequest,
                    "invalid_current_password",
                    "Current password is invalid."))
                : AuthCommandResult.Failed(new AuthFailure(
                    StatusCodes.Status400BadRequest,
                    "password_change_failed",
                    "Password does not satisfy the account password policy.",
                    new Dictionary<string, string[]>(StringComparer.Ordinal)
                    {
                        ["newPassword"] = result.Errors
                            .Select(error => error.Description)
                            .Distinct(StringComparer.Ordinal)
                            .ToArray()
                    }));
        }

        await database.DeviceSessions
            .Where(device =>
                device.UserId == userId &&
                device.Id != currentDeviceSessionId &&
                device.RevokedAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(device => device.RevokedAt, now),
                cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return AuthCommandResult.Success();
    }

    private async Task RevokeReplayedTokenFamilyAsync(
        string tokenHash,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ConsumedRefreshToken? consumed = await database.ConsumedRefreshTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(token => token.TokenHash == tokenHash, cancellationToken);
        if (consumed is null) return;

        await database.DeviceSessions
            .IgnoreQueryFilters()
            .Where(device =>
                device.UserId == consumed.UserId &&
                device.Id == consumed.DeviceSessionId &&
                device.TokenFamilyId == consumed.TokenFamilyId &&
                device.RevokedAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(device => device.RevokedAt, now),
                cancellationToken);
    }

    private async Task RevokeDeviceAsync(
        Guid userId,
        Guid deviceSessionId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await database.DeviceSessions
            .IgnoreQueryFilters()
            .Where(device =>
                device.UserId == userId &&
                device.Id == deviceSessionId &&
                device.RevokedAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(device => device.RevokedAt, now),
                cancellationToken);
    }

    private AuthSessionResponse CreateResponse(
        Guid userId,
        DeviceSession device,
        RefreshTokenMaterial refreshToken)
    {
        AccessTokenResult accessToken = tokenService.CreateAccessToken(userId, device.Id, device.Platform);
        return new AuthSessionResponse(
            accessToken.Token,
            refreshToken.Plaintext,
            accessToken.ExpiresAt,
            new DeviceResponse(
                device.Id,
                device.DeviceName,
                device.Platform,
                device.CreatedAt,
                device.LastSeenAt,
                Current: true));
    }

    private static DeviceSession CreateDeviceSession(
        Guid userId,
        string deviceName,
        string platform,
        RefreshTokenMaterial refreshToken,
        DateTimeOffset now) => new()
    {
        Id = Guid.NewGuid(),
        UserId = userId,
        TokenFamilyId = Guid.NewGuid(),
        RefreshTokenHash = refreshToken.Hash,
        DeviceName = AuthCommandValidator.NormalizeDeviceName(deviceName),
        Platform = AuthCommandValidator.NormalizePlatform(platform),
        CreatedAt = now,
        LastSeenAt = now,
        ExpiresAt = refreshToken.ExpiresAt
    };

    private static AuthOperationResult ValidationFailed(IReadOnlyDictionary<string, string[]> errors) =>
        AuthOperationResult.Failed(new AuthFailure(
            StatusCodes.Status400BadRequest,
            "validation_failed",
            "One or more fields are invalid.",
            errors));

    private static AuthOperationResult IdentityFailed(IdentityResult result) =>
        AuthOperationResult.Failed(new AuthFailure(
            StatusCodes.Status400BadRequest,
            "registration_failed",
            "Account registration failed.",
            new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                ["account"] = result.Errors
                    .Select(error => error.Description)
                    .Distinct(StringComparer.Ordinal)
                    .ToArray()
            }));

    private static AuthFailure InvalidRefreshToken() => new(
        StatusCodes.Status401Unauthorized,
        "invalid_refresh_token",
        "Refresh token is invalid or expired.");
}
