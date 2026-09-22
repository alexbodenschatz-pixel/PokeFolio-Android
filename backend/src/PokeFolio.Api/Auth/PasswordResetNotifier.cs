using System.Net;
using System.Net.Mail;
using System.Text;

namespace PokeFolio.Api.Auth;

public sealed record PasswordResetNotification(
    string Email,
    string Token,
    DateTimeOffset ExpiresAt);

public interface IPasswordResetNotifier
{
    bool IsAvailable { get; }

    Task SendAsync(
        PasswordResetNotification notification,
        CancellationToken cancellationToken);
}

public sealed class SmtpPasswordResetNotifier(PasswordResetOptions options)
    : IPasswordResetNotifier
{
    public bool IsAvailable => options.DeliveryConfigured;

    public async Task SendAsync(
        PasswordResetNotification notification,
        CancellationToken cancellationToken)
    {
        if (!IsAvailable)
        {
            throw new InvalidOperationException("Password reset delivery is not configured.");
        }

        string resetLink = options.CreateResetLink(notification.Email, notification.Token);
        using var message = new MailMessage
        {
            From = new MailAddress(options.FromAddress, options.FromName, Encoding.UTF8),
            Subject = "PokeFolio password reset",
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = false,
            Body = $"""
                A password reset was requested for your PokeFolio account.

                Open this one-time link to choose a new password:
                {resetLink}

                The link expires at {notification.ExpiresAt:O}. If you did not request this,
                you can ignore this message. Your password has not been changed.
                """
        };
        message.To.Add(new MailAddress(notification.Email));

        using var client = new SmtpClient(options.SmtpHost, options.SmtpPort)
        {
            DeliveryMethod = SmtpDeliveryMethod.Network,
            EnableSsl = options.SmtpEnableSsl,
            UseDefaultCredentials = false
        };
        if (!string.IsNullOrWhiteSpace(options.SmtpUsername))
        {
            client.Credentials = new NetworkCredential(
                options.SmtpUsername,
                options.SmtpPassword);
        }

        await client.SendMailAsync(message, cancellationToken);
    }
}
