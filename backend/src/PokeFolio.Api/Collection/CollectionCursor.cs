using Microsoft.AspNetCore.WebUtilities;

namespace PokeFolio.Api.Collection;

internal static class CollectionCursor
{
    public static string Encode(Guid id) => WebEncoders.Base64UrlEncode(id.ToByteArray());

    public static bool TryDecode(string? value, out Guid? id)
    {
        id = null;
        if (value is null) return true;
        if (value.Length is < 1 or > 512) return false;

        try
        {
            byte[] bytes = WebEncoders.Base64UrlDecode(value);
            if (bytes.Length != 16) return false;
            Guid parsed = new(bytes);
            if (parsed == Guid.Empty) return false;
            id = parsed;
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
