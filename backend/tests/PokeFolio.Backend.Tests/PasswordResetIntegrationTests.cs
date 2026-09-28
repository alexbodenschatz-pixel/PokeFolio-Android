using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using PokeFolio.Api.Auth;
using PokeFolio.Infrastructure.Identity;
using PokeFolio.Infrastructure.Persistence;

namespace PokeFolio.Backend.Tests;

public sealed partial class PostgreSqlIsolationTests
{
    [TestMethod]
    [TestCategory("PostgreSQL")]
    [TestCategory("Security")]
    public async Task PasswordResetIsNeutralSingleUseAndRevokesEveryDevice()
    {
        string? serverConnectionString = Environment.GetEnvironmentVariable("POKEFOLIO_TEST_POSTGRES");
        if (string.IsNullOrWhiteSpace(serverConnectionString))
        {
            Assert.Inconclusive(
                "Set POKEFOLIO_TEST_POSTGRES to run the password reset integration test.");
            return;
        }

        string databaseName = $"pokefolio_test_{Guid.NewGuid():N}";
        string testConnectionString = await CreateDatabaseAsync(serverConnectionString, databaseName);

        try
        {
            await using (PokeFolioDbContext migrationContext =
                CreateContext(testConnectionString, null))
            {
                await migrationContext.Database.MigrateAsync();
            }

            var notifier = new CapturingPasswordResetNotifier();
            using var factory = new PokeFolioApiFactory(testConnectionString, notifier);
            using HttpClient android = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false
            });
            using HttpClient windows = factory.CreateClient();
            using HttpClient anonymous = factory.CreateClient();

            AuthSessionResponse androidSession = await RegisterAsync(
                android,
                "reset-owner@example.test",
                "Android Reset");
            using HttpResponseMessage windowsLoginResponse = await windows.PostAsJsonAsync(
                "/api/v1/auth/login",
                new LoginCommand(
                    "reset-owner@example.test",
                    "A secure PokeFolio password 1!",
                    "Windows Reset",
                    "windows"));
            Assert.AreEqual(HttpStatusCode.OK, windowsLoginResponse.StatusCode);
            AuthSessionResponse? windowsSession = await windowsLoginResponse.Content
                .ReadFromJsonAsync<AuthSessionResponse>();
            Assert.IsNotNull(windowsSession);

            using (HttpResponseMessage unknown = await anonymous.PostAsJsonAsync(
                       "/api/v1/auth/password/reset/request",
                       new PasswordResetRequestCommand("unknown@example.test")))
            {
                Assert.AreEqual(HttpStatusCode.Accepted, unknown.StatusCode);
                Assert.AreEqual(0, notifier.Notifications.Count);
            }
            using (HttpResponseMessage requested = await anonymous.PostAsJsonAsync(
                       "/api/v1/auth/password/reset/request",
                       new PasswordResetRequestCommand(" reset-owner@example.test ")))
            {
                Assert.AreEqual(HttpStatusCode.Accepted, requested.StatusCode);
            }

            PasswordResetNotification notification = notifier.Notifications.Single();
            Assert.AreEqual("reset-owner@example.test", notification.Email);
            Assert.AreEqual(43, notification.Token.Length);
            await using (PokeFolioDbContext tokenCheck = CreateContext(testConnectionString, null))
            {
                PasswordResetToken stored = await tokenCheck.PasswordResetTokens
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .SingleAsync();
                Assert.AreEqual(
                    PasswordResetTokenService.Hash(notification.Token),
                    stored.TokenHash);
                Assert.AreNotEqual(notification.Token, stored.TokenHash);
                Assert.IsNull(stored.ConsumedAt);
            }

            using (HttpResponseMessage weakPassword = await anonymous.PostAsJsonAsync(
                       "/api/v1/auth/password/reset/confirm",
                       new PasswordResetConfirmCommand(
                           notification.Email,
                           notification.Token,
                           "only lowercase password")))
            {
                Assert.AreEqual(HttpStatusCode.BadRequest, weakPassword.StatusCode);
            }
            using (HttpResponseMessage wrongToken = await anonymous.PostAsJsonAsync(
                       "/api/v1/auth/password/reset/confirm",
                       new PasswordResetConfirmCommand(
                           notification.Email,
                           new string('x', 43),
                           "A recovered PokeFolio password 2!")))
            {
                Assert.AreEqual(HttpStatusCode.BadRequest, wrongToken.StatusCode);
            }
            using (HttpResponseMessage confirmed = await anonymous.PostAsJsonAsync(
                       "/api/v1/auth/password/reset/confirm",
                       new PasswordResetConfirmCommand(
                           notification.Email,
                           notification.Token,
                           "A recovered PokeFolio password 2!")))
            {
                Assert.AreEqual(HttpStatusCode.NoContent, confirmed.StatusCode);
            }
            using (HttpResponseMessage replayed = await anonymous.PostAsJsonAsync(
                       "/api/v1/auth/password/reset/confirm",
                       new PasswordResetConfirmCommand(
                           notification.Email,
                           notification.Token,
                           "Another secure PokeFolio password 3!")))
            {
                Assert.AreEqual(HttpStatusCode.BadRequest, replayed.StatusCode);
            }

            android.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", androidSession.AccessToken);
            windows.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", windowsSession.AccessToken);
            using (HttpResponseMessage revokedAndroid = await android.GetAsync("/api/v1/devices"))
            {
                Assert.AreEqual(HttpStatusCode.Unauthorized, revokedAndroid.StatusCode);
            }
            using (HttpResponseMessage revokedWindows = await windows.GetAsync("/api/v1/devices"))
            {
                Assert.AreEqual(HttpStatusCode.Unauthorized, revokedWindows.StatusCode);
            }
            using (HttpResponseMessage revokedRefresh = await anonymous.PostAsJsonAsync(
                       "/api/v1/auth/refresh",
                       new RefreshCommand(androidSession.RefreshToken)))
            {
                Assert.AreEqual(HttpStatusCode.Unauthorized, revokedRefresh.StatusCode);
            }
            using (HttpResponseMessage oldPassword = await anonymous.PostAsJsonAsync(
                       "/api/v1/auth/login",
                       new LoginCommand(
                           notification.Email,
                           "A secure PokeFolio password 1!",
                           "Old Password",
                           "android")))
            {
                Assert.AreEqual(HttpStatusCode.Unauthorized, oldPassword.StatusCode);
            }
            using (HttpResponseMessage newPassword = await anonymous.PostAsJsonAsync(
                       "/api/v1/auth/login",
                       new LoginCommand(
                           notification.Email,
                           "A recovered PokeFolio password 2!",
                           "Recovered Device",
                           "android")))
            {
                Assert.AreEqual(HttpStatusCode.OK, newPassword.StatusCode);
            }

            await using PokeFolioDbContext verify = CreateContext(testConnectionString, null);
            PasswordResetToken persisted = await verify.PasswordResetTokens
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleAsync();
            Assert.IsNotNull(persisted.ConsumedAt);
            DeviceSession[] devices = await verify.DeviceSessions
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(device => device.UserId == androidSession.UserId)
                .OrderBy(device => device.CreatedAt)
                .ToArrayAsync();
            Assert.HasCount(3, devices);
            Assert.IsNotNull(devices.Single(device => device.Id == androidSession.Device.Id).RevokedAt);
            Assert.IsNotNull(devices.Single(device => device.Id == windowsSession.Device.Id).RevokedAt);
            Assert.AreEqual(1, devices.Count(device => device.RevokedAt == null));
        }
        finally
        {
            await DropDatabaseAsync(serverConnectionString, databaseName);
        }
    }

    private sealed class CapturingPasswordResetNotifier : IPasswordResetNotifier
    {
        public bool IsAvailable => true;
        public List<PasswordResetNotification> Notifications { get; } = [];

        public Task SendAsync(
            PasswordResetNotification notification,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Notifications.Add(notification);
            return Task.CompletedTask;
        }
    }
}
