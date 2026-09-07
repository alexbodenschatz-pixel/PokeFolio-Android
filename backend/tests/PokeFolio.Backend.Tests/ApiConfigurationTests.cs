using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class ApiConfigurationTests
{
    private static readonly byte[] SigningKey = Enumerable.Range(1, 32)
        .Select(value => (byte)value)
        .ToArray();

    [TestMethod]
    public async Task HostOverridesAreAppliedBeforeAuthConfigurationIsValidated()
    {
        using var factory = new TestApiFactory();
        using HttpClient client = factory.CreateClient();

        using HttpResponseMessage response = await client.GetAsync("/health/live");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

        using HttpResponseMessage challenge = await client.PostAsync(
            "/api/v1/auth/logout",
            content: null);
        Assert.AreEqual(HttpStatusCode.Unauthorized, challenge.StatusCode);
        Assert.AreEqual(
            "application/problem+json",
            challenge.Content.Headers.ContentType?.MediaType);
    }

    private sealed class TestApiFactory : WebApplicationFactory<global::Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureLogging(logging => logging.ClearProviders());
            builder.ConfigureAppConfiguration((_, configuration) =>
            {
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:PokeFolio"] =
                        "Host=localhost;Database=not_used;Username=not_used",
                    ["Auth:Issuer"] = "pokefolio-configuration-tests",
                    ["Auth:Audience"] = "pokefolio-configuration-test-clients",
                    ["Auth:SigningKey"] = Convert.ToBase64String(SigningKey),
                    ["Auth:SigningKeyId"] = "configuration-test-key",
                    ["Auth:AccessTokenMinutes"] = "10",
                    ["Auth:RefreshTokenDays"] = "30"
                });
            });
        }
    }
}
