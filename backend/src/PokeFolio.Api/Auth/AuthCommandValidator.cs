using System.ComponentModel.DataAnnotations;

namespace PokeFolio.Api.Auth;

public static class AuthCommandValidator
{
    private static readonly HashSet<string> Platforms =
        ["android", "windows", "web", "ios", "macos"];

    public static IReadOnlyDictionary<string, string[]> Validate(RegisterCommand command)
    {
        var errors = ValidateCredentials(command.Email, command.Password, minimumPasswordLength: 12);
        ValidateDevice(command.DeviceName, command.Platform, errors);
        return errors;
    }

    public static IReadOnlyDictionary<string, string[]> Validate(LoginCommand command)
    {
        var errors = ValidateCredentials(command.Email, command.Password, minimumPasswordLength: 1);
        ValidateDevice(command.DeviceName, command.Platform, errors);
        return errors;
    }

    public static IReadOnlyDictionary<string, string[]> Validate(RefreshCommand command)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        int length = command.RefreshToken?.Length ?? 0;
        if (length is < 32 or > 1024)
        {
            errors["refreshToken"] = ["Refresh token must contain 32 to 1024 characters."];
        }
        return errors;
    }

    public static string NormalizeEmail(string email) => email.Trim();
    public static string NormalizeDeviceName(string deviceName) => deviceName.Trim();
    public static string NormalizePlatform(string platform) => platform.Trim().ToLowerInvariant();

    private static Dictionary<string, string[]> ValidateCredentials(
        string? email,
        string? password,
        int minimumPasswordLength)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        string normalizedEmail = email?.Trim() ?? string.Empty;
        if (normalizedEmail.Length is < 3 or > 254 ||
            !new EmailAddressAttribute().IsValid(normalizedEmail))
        {
            errors["email"] = ["A valid email address with at most 254 characters is required."];
        }

        int passwordLength = password?.Length ?? 0;
        if (passwordLength < minimumPasswordLength || passwordLength > 128)
        {
            errors["password"] =
                [$"Password must contain {minimumPasswordLength} to 128 characters."];
        }
        return errors;
    }

    private static void ValidateDevice(
        string? deviceName,
        string? platform,
        Dictionary<string, string[]> errors)
    {
        int deviceNameLength = deviceName?.Trim().Length ?? 0;
        if (deviceNameLength is < 1 or > 120)
        {
            errors["deviceName"] = ["Device name must contain 1 to 120 characters."];
        }

        string normalizedPlatform = platform?.Trim().ToLowerInvariant() ?? string.Empty;
        if (!Platforms.Contains(normalizedPlatform))
        {
            errors["platform"] = ["Platform is not supported."];
        }
    }
}
