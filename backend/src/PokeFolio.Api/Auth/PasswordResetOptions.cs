using System.Net.Mail;

namespace PokeFolio.Api.Auth;

public sealed class PasswordResetOptions
{
    public const string SectionName = "PasswordReset";

    public int TokenMinutes { get; init; } = 30;
    public int MinimumResponseMilliseconds { get; init; } = 750;
    public string PublicResetUrl { get; init; } = string.Empty;
    public string SmtpHost { get; init; } = string.Empty;
    public int SmtpPort { get; init; } = 587;
    public bool SmtpEnableSsl { get; init; } = true;
    public string SmtpUsername { get; init; } = string.Empty;
    public string SmtpPassword { get; init; } = string.Empty;
    public string FromAddress { get; init; } = string.Empty;
    public string FromName { get; init; } = "PokeFolio";

    public bool DeliveryConfigured =>
        !string.IsNullOrWhiteSpace(PublicResetUrl) &&
        !string.IsNullOrWhiteSpace(SmtpHost) &&
        !string.IsNullOrWhiteSpace(FromAddress);

    public void Validate()
    {
        if (TokenMinutes is < 5 or > 120)
        {
            throw new InvalidOperationException(
                "PasswordReset:TokenMinutes must be between 5 and 120.");
        }
        if (MinimumResponseMilliseconds is < 0 or > 5000)
        {
            throw new InvalidOperationException(
                "PasswordReset:MinimumResponseMilliseconds must be between 0 and 5000.");
        }
        if (SmtpPort is < 1 or > 65535)
        {
            throw new InvalidOperationException(
                "PasswordReset:SmtpPort must be between 1 and 65535.");
        }

        bool hasAnyDeliverySetting = DeliveryConfigured ||
            !string.IsNullOrWhiteSpace(PublicResetUrl) ||
            !string.IsNullOrWhiteSpace(SmtpHost) ||
            !string.IsNullOrWhiteSpace(FromAddress) ||
            !string.IsNullOrWhiteSpace(SmtpUsername) ||
            !string.IsNullOrWhiteSpace(SmtpPassword);
        if (!hasAnyDeliverySetting) return;
        if (!DeliveryConfigured)
        {
            throw new InvalidOperationException(
                "Password reset delivery requires PublicResetUrl, SmtpHost and FromAddress.");
        }
        if (string.IsNullOrWhiteSpace(SmtpUsername) != string.IsNullOrWhiteSpace(SmtpPassword))
        {
            throw new InvalidOperationException(
                "PasswordReset SMTP username and password must be configured together.");
        }
        if (!Uri.TryCreate(PublicResetUrl, UriKind.Absolute, out Uri? resetUri) ||
            !string.Equals(resetUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(resetUri.Query) ||
            !string.IsNullOrEmpty(resetUri.Fragment))
        {
            throw new InvalidOperationException(
                "PasswordReset:PublicResetUrl must be an absolute HTTPS URL without query or fragment.");
        }

        try
        {
            _ = new MailAddress(FromAddress);
        }
        catch (FormatException error)
        {
            throw new InvalidOperationException(
                "PasswordReset:FromAddress must be a valid email address.",
                error);
        }
    }

    public string CreateResetLink(string email, string token)
    {
        if (!DeliveryConfigured)
        {
            throw new InvalidOperationException("Password reset delivery is not configured.");
        }
        return $"{PublicResetUrl}#email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(token)}";
    }
}
