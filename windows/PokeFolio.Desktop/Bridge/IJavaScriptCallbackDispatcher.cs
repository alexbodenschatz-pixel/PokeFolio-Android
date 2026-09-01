namespace PokeFolio.Desktop.Bridge;

public interface IJavaScriptCallbackDispatcher
{
    Task SendAsync(string callbackName, object payload);
}
