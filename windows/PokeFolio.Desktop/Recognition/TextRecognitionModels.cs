using PokeFolio.Desktop.Vision;

namespace PokeFolio.Desktop.Recognition;

public sealed record RecognizedTextLine(
    string Text,
    double X,
    double Y,
    double Width,
    double Height,
    double Confidence = 0.76);

public sealed record TextRecognitionResult(
    bool Available,
    string Text,
    IReadOnlyList<RecognizedTextLine> Lines,
    string Language,
    long ElapsedMilliseconds,
    string? Warning = null);

public interface ITextRecognitionService
{
    Task<TextRecognitionResult> RecognizeAsync(
        OpenCvSharp.Mat image,
        string language,
        CardRegionKind region,
        CancellationToken cancellationToken = default);
}

public sealed record OcrPass(
    string Variant,
    string Region,
    int Width,
    int Height,
    string Text,
    IReadOnlyList<RecognizedTextLine> Lines,
    long ElapsedMilliseconds);

public sealed record IdentifierResult(
    string Profile,
    string Value,
    string CollectorNumber,
    string SetCode,
    string Passcode,
    string CardCode,
    string Script,
    double Confidence,
    bool IsExact);

public sealed record OrientationProbe(int Rotation, double Score, string Text, IdentifierResult Identifier);

public sealed class OrientedCard : IDisposable
{
    public OrientedCard(OpenCvSharp.Mat image, int rotation, double score, double secondScore,
        bool confident, IReadOnlyList<OrientationProbe> probes)
    {
        Image = image;
        Rotation = rotation;
        Score = score;
        SecondScore = secondScore;
        Confident = confident;
        Probes = probes;
    }

    public OpenCvSharp.Mat Image { get; }
    public int Rotation { get; }
    public double Score { get; }
    public double SecondScore { get; }
    public bool Confident { get; }
    public IReadOnlyList<OrientationProbe> Probes { get; }
    public double Margin => Math.Max(0, Score - SecondScore);

    public void Dispose() => Image.Dispose();
}

public enum RecognitionRequestMode
{
    Full,
    PrimaryIdentifier,
    BulkFast
}

public sealed record WindowsRecognitionResult(
    bool Ok,
    string Text,
    IReadOnlyList<OcrPass> Passes,
    string Language,
    string Profile,
    string RecognitionMode,
    int Orientation,
    double OrientationScore,
    double OrientationSecondScore,
    bool OrientationConfident,
    IdentifierResult Identifier,
    long OrientationMilliseconds,
    long DetailedOcrMilliseconds,
    long TotalOcrMilliseconds,
    string? Warning = null);
