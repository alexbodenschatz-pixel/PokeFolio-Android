using System.Text.RegularExpressions;

namespace PokeFolio.Desktop.Recognition;

public sealed partial class CardIdentifierParser
{
    public IdentifierResult Parse(string text, string profile)
    {
        var source = (text ?? "").Replace('\uFF0F', '/');
        var normalizedProfile = NormalizeProfile(profile, source);
        var pokemon = PokemonNumber().Match(source);
        if (!pokemon.Success) pokemon = PokemonNumberWithoutSlash().Match(source);
        var yugiohPasscode = YuGiOhPasscode().Match(source);
        var yugiohSet = YuGiOhSetCode().Match(source);
        var onePiece = OnePieceCode().Match(source);
        var collector = pokemon.Success
            ? NormalizeCollector(pokemon.Groups[1].Value, pokemon.Groups[2].Value)
            : "";
        var cardCode = onePiece.Success ? NormalizeOnePiece(onePiece.Value) : "";
        var passcode = yugiohPasscode.Success ? yugiohPasscode.Groups[1].Value : "";
        var setCode = yugiohSet.Success
            ? Regex.Replace(yugiohSet.Value, "\\s+", "").ToUpperInvariant()
            : "";
        var value = normalizedProfile switch
        {
            "yugioh" => passcode.Length > 0 ? passcode : setCode,
            "onepiece" => cardCode,
            _ => collector
        };
        var confidence = value.Length == 0 ? 0 : normalizedProfile switch
        {
            "yugioh" when passcode.Length == 8 => 0.98,
            "onepiece" => 0.98,
            "pokemon" when collector.Contains('/') => 0.96,
            _ => 0.82
        };
        return new IdentifierResult(normalizedProfile, value, collector, setCode, passcode,
            cardCode, DetectScript(source), confidence, confidence >= 0.94);
    }

    public static string DetectScript(string text)
    {
        if (Regex.IsMatch(text ?? "", "[\\u3040-\\u30ff]")) return "Japanese";
        if (Regex.IsMatch(text ?? "", "[\\uac00-\\ud7af]")) return "Hangul";
        if (Regex.IsMatch(text ?? "", "[\\u3400-\\u9fff]")) return "Chinese";
        return "Latin";
    }

    private static string NormalizeProfile(string profile, string text)
    {
        var normalized = profile?.Trim().ToLowerInvariant();
        if (normalized is "pokemon" or "yugioh" or "onepiece") return normalized;
        if (OnePieceCode().IsMatch(text)) return "onepiece";
        if (YuGiOhPasscode().IsMatch(text) || YuGiOhSetCode().IsMatch(text)) return "yugioh";
        return "pokemon";
    }

    private static string NormalizeCollector(string number, string total)
    {
        static string Token(string value) => Regex.Replace(value.ToUpperInvariant().Replace('|', '1'), "[^A-Z0-9]", "")
            .Replace('O', '0').Replace('I', '1').Replace('L', '1')
            .Replace('S', '5').Replace('B', '8');
        return Token(number) + "/" + Token(total);
    }

    private static string NormalizeOnePiece(string value) =>
        Regex.Replace(value.ToUpperInvariant(), "\\s+", "").Replace("--", "-");

    [GeneratedRegex(@"(?i)\b([A-Z]{0,4}\s*-?\s*[0-9OIL|SB]{1,4}[A-Z]?)\s*[/\\]\s*([A-Z]{0,4}\s*-?\s*[0-9OIL|SB]{1,4})\b")]
    private static partial Regex PokemonNumber();

    // Only 3-4 character tokens are accepted without a slash. This recovers OCR such as
    // "198 193" but deliberately rejects isolated HP/damage pairs such as "90 120".
    [GeneratedRegex(@"(?i)\b([0-9OILSB]{3,4})\s+([0-9OILSB]{3,4})\b")]
    private static partial Regex PokemonNumberWithoutSlash();

    [GeneratedRegex(@"(?:^|\D)(\d{8})(?!\d)")]
    private static partial Regex YuGiOhPasscode();

    [GeneratedRegex(@"(?i)\b[A-Z0-9]{2,8}-(?:(?:DE|EN|FR|EU|IT|PT|SP|GE|AE)[A-Z]?)?[A-Z]?\d{2,4}\b")]
    private static partial Regex YuGiOhSetCode();

    [GeneratedRegex(@"(?i)\b(?:(?:OP|ST|EB|PRB|EX|DON)\s*-?\s*\d{1,2}\s*-\s*\d{3}|P\s*-\s*\d{3})\b")]
    private static partial Regex OnePieceCode();
}
