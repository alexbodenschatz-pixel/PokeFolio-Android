using System.Text.Json;

namespace PokeFolio.Desktop.Bridge;

public sealed class WebView2CallbackDispatcher(Func<string, Task> executeScript) : IJavaScriptCallbackDispatcher
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public Task SendAsync(string callbackName, object payload)
    {
        if (string.IsNullOrWhiteSpace(callbackName)
            || callbackName.Any(character => !char.IsLetterOrDigit(character) && character != '_'))
        {
            throw new ArgumentException("Invalid JavaScript callback name.", nameof(callbackName));
        }

        var payloadJson = JsonSerializer.Serialize(payload, JsonOptions);
        var quotedPayload = JsonSerializer.Serialize(payloadJson, JsonOptions);
        return executeScript($"window.{callbackName} && window.{callbackName}({quotedPayload});");
    }
}
