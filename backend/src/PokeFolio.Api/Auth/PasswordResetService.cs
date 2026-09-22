using System.Diagnostics;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PokeFolio.Infrastructure.Identity;
using PokeFolio.Infrastructure.Persistence;

namespace PokeFolio.Api.Auth;

public sealed class PasswordResetService(
    PokeFolioDbContext database,
    UserManager<ApplicationUser> userManager,
    PasswordResetTokenService tokenService,
    IPasswordResetNotifier notifier,
    PasswordResetOptions options,
    LoginTimingProtector timingProtector,
    TimeProvider timeProvider,
    ILogger<PasswordResetService> logger)
{
    private static readonly Action<ILogger, Guid, Exception?> LogDeliveryFailure =
        LoggerMessage.Define<Guid>(
            LogLevel.Error,
            new EventId(1001, "PasswordResetDeliveryFailed"),
            "Password reset delivery failed for account {UserId}; token invalidated.");

    public async Task<AuthCommandResult> RequestAsync(
        PasswordResetRequestCommand command,
        CancellationToken cancellationToken)
    {
        long started = Stopwatch.GetTimestamp();
        try
        {
            IReadOnlyDictionary<string, string[]> errors = AuthCommandValidator.Validate(command);
            if (errors.Count > 0) return ValidationFailed(errors);
            if (!notifier.IsAvailable)
            {
                return AuthCommandResult.Failed(new AuthFailure(
                    StatusCodes.Status503ServiceUnavailable,
                    "password_reset_unavailable",
                    "Password reset is temporarily unavailable."));
            }

            timingProtector.ConsumeEquivalentPasswordWork(
                "PokeFolio password reset timing work 1!");
            string email = AuthCommandValidator.NormalizeEmail(command.Email!);
            ApplicationUser? user = await userManager.FindByEmailAsync(email);
            if (user is null) return AuthCommandResult.Success();

            DateTimeOffset now = timeProvider.GetUtcNow();
            await database.PasswordResetTokens
                .IgnoreQueryFilters()
                .Where(token =>
                    token.UserId == user.Id &&
                    token.ConsumedAt == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(token => token.ConsumedAt, now),
                    cancellationToken);

            PasswordResetTokenMaterial material = tokenService.Create();
            var persisted = new PasswordResetToken
            {
                TokenHash = material.Hash,
                UserId = user.Id,
                CreatedAt = now,
                ExpiresAt = material.ExpiresAt
            };
            database.PasswordResetTokens.Add(persisted);
            await database.SaveChangesAsync(cancellationToken);

            try
            {
                await notifier.SendAsync(
                    new PasswordResetNotification(
                        email,
                        material.Plaintext,
                        material.ExpiresAt),
                    cancellationToken);
            }
            catch (Exception error) when (!cancellationToken.IsCancellationRequested)
            {
                database.PasswordResetTokens.Remove(persisted);
                await database.SaveChangesAsync(cancellationToken);
                LogDeliveryFailure(logger, user.Id, error);
            }

            return AuthCommandResult.Success();
        }
        finally
        {
            TimeSpan minimum = TimeSpan.FromMilliseconds(options.MinimumResponseMilliseconds);
            TimeSpan remaining = minimum - Stopwatch.GetElapsedTime(started);
            if (remaining > TimeSpan.Zero)
            {
                await Task.Delay(remaining, timeProvider, cancellationToken);
            }
        }
    }

    public async Task<AuthCommandResult> ConfirmAsync(
        PasswordResetConfirmCommand command,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<string, string[]> errors = AuthCommandValidator.Validate(command);
        if (errors.Count > 0) return ValidationFailed(errors);

        string tokenHash = PasswordResetTokenService.Hash(command.Token!);
        string normalizedEmail = userManager.NormalizeEmail(
            AuthCommandValidator.NormalizeEmail(command.Email!));
        DateTimeOffset now = timeProvider.GetUtcNow();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);

        PasswordResetToken? reset = await database.PasswordResetTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(token =>
                token.TokenHash == tokenHash &&
                token.ConsumedAt == null &&
                token.ExpiresAt > now,
                cancellationToken);
        if (reset is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return InvalidToken();
        }

        ApplicationUser? user = await userManager.FindByIdAsync(reset.UserId.ToString());
        if (user is null ||
            !string.Equals(user.NormalizedEmail, normalizedEmail, StringComparison.Ordinal))
        {
            await transaction.RollbackAsync(cancellationToken);
            return InvalidToken();
        }

        int claimed = await database.PasswordResetTokens
            .IgnoreQueryFilters()
            .Where(token =>
                token.TokenHash == tokenHash &&
                token.UserId == user.Id &&
                token.ConsumedAt == null &&
                token.ExpiresAt > now)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(token => token.ConsumedAt, now),
                cancellationToken);
        if (claimed != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return InvalidToken();
        }

        var passwordErrors = new List<IdentityError>();
        foreach (IPasswordValidator<ApplicationUser> validator in userManager.PasswordValidators)
        {
            IdentityResult validation = await validator.ValidateAsync(
                userManager,
                user,
                command.NewPassword!);
            if (!validation.Succeeded) passwordErrors.AddRange(validation.Errors);
        }
        if (passwordErrors.Count > 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return PasswordPolicyFailed(passwordErrors);
        }

        user.PasswordHash = userManager.PasswordHasher.HashPassword(user, command.NewPassword!);
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        user.UpdatedAt = now;
        IdentityResult updated = await userManager.UpdateAsync(user);
        if (!updated.Succeeded)
        {
            await transaction.RollbackAsync(cancellationToken);
            return PasswordPolicyFailed(updated.Errors);
        }

        await database.DeviceSessions
            .IgnoreQueryFilters()
            .Where(device => device.UserId == user.Id && device.RevokedAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(device => device.RevokedAt, now),
                cancellationToken);
        await database.PasswordResetTokens
            .IgnoreQueryFilters()
            .Where(token => token.UserId == user.Id && token.ConsumedAt == null)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(token => token.ConsumedAt, now),
                cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return AuthCommandResult.Success();
    }

    private static AuthCommandResult InvalidToken() => AuthCommandResult.Failed(new AuthFailure(
        StatusCodes.Status400BadRequest,
        "invalid_password_reset",
        "Password reset token is invalid or expired."));

    private static AuthCommandResult PasswordPolicyFailed(IEnumerable<IdentityError> errors) =>
        AuthCommandResult.Failed(new AuthFailure(
            StatusCodes.Status400BadRequest,
            "password_reset_failed",
            "Password does not satisfy the account password policy.",
            new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                ["newPassword"] = errors
                    .Select(error => error.Description)
                    .Distinct(StringComparer.Ordinal)
                    .ToArray()
            }));

    private static AuthCommandResult ValidationFailed(
        IReadOnlyDictionary<string, string[]> errors) =>
        AuthCommandResult.Failed(new AuthFailure(
            StatusCodes.Status400BadRequest,
            "validation_failed",
            "One or more fields are invalid.",
            errors));
}
