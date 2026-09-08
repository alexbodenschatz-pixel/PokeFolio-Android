using System.Buffers.Binary;
using Microsoft.AspNetCore.WebUtilities;

namespace PokeFolio.Api.Sync;

public static class SyncCursor
{
    public static string Encode(long sequence)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(sequence);
        Span<byte> bytes = stackalloc byte[sizeof(long)];
        BinaryPrimitives.WriteInt64BigEndian(bytes, sequence);
        return WebEncoders.Base64UrlEncode(bytes);
    }

    public static bool TryDecode(string? value, out long sequence)
    {
        sequence = 0;
        if (value is null) return true;
        if (value.Length != 11) return false;

        try
        {
            byte[] bytes = WebEncoders.Base64UrlDecode(value);
            if (bytes.Length != sizeof(long)) return false;
            long parsed = BinaryPrimitives.ReadInt64BigEndian(bytes);
            if (parsed < 0 || !string.Equals(value, Encode(parsed), StringComparison.Ordinal))
            {
                return false;
            }

            sequence = parsed;
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
