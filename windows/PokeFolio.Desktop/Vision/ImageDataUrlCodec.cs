using System.Drawing.Imaging;
using OpenCvSharp;

namespace PokeFolio.Desktop.Vision;

public sealed class DecodedSourceImage : IDisposable
{
    public DecodedSourceImage(Mat pixels, int originalExifOrientation, bool sourceExifApplied)
    {
        Pixels = pixels;
        OriginalExifOrientation = originalExifOrientation;
        SourceExifApplied = sourceExifApplied;
    }

    public Mat Pixels { get; }
    public int OriginalExifOrientation { get; }
    public bool SourceExifApplied { get; }

    public void Dispose() => Pixels.Dispose();
}

/// <summary>
/// Decodes upload data and applies source EXIF exactly once. The returned Mat has no orientation
/// metadata; all later rotations are card-layout decisions, never camera metadata decisions.
/// </summary>
public sealed class ImageDataUrlCodec
{
    private const int MaximumEncodedBytes = 32 * 1024 * 1024;
    private const int ExifOrientationId = 0x0112;

    public DecodedSourceImage Decode(string dataUrl)
    {
        if (string.IsNullOrWhiteSpace(dataUrl)) throw new InvalidDataException("Das Kartenbild ist leer.");
        var comma = dataUrl.IndexOf(',');
        var encoded = comma >= 0 ? dataUrl[(comma + 1)..] : dataUrl;
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(encoded);
        }
        catch (FormatException error)
        {
            throw new InvalidDataException("Das Kartenbild ist nicht korrekt Base64-kodiert.", error);
        }
        if (bytes.Length is 0 or > MaximumEncodedBytes)
        {
            throw new InvalidDataException("Das Kartenbild ist leer oder größer als 32 MB.");
        }

        try
        {
            using var input = new MemoryStream(bytes, writable: false);
            using var source = Image.FromStream(input, useEmbeddedColorManagement: false, validateImageData: true);
            var orientation = ReadExifOrientation(source);
            ApplyExifOrientation(source, orientation);
            using var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format24bppRgb);
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.Clear(Color.Black);
                graphics.DrawImage(source, 0, 0, source.Width, source.Height);
            }
            using var normalized = new MemoryStream();
            bitmap.Save(normalized, ImageFormat.Png);
            var pixels = Cv2.ImDecode(normalized.ToArray(), ImreadModes.Color);
            if (pixels.Empty()) throw new InvalidDataException("Das Kartenbild konnte nicht dekodiert werden.");
            return new DecodedSourceImage(pixels, orientation, orientation != 1);
        }
        catch (ArgumentException)
        {
            // WebP and some HEIF codecs are available through OpenCV but not GDI+. These formats
            // commonly contain already-oriented pixels; OpenCV is told not to apply metadata.
            var pixels = Cv2.ImDecode(bytes, ImreadModes.Color | ImreadModes.IgnoreOrientation);
            if (pixels.Empty()) throw new InvalidDataException("Das Bildformat wird lokal nicht unterstützt.");
            return new DecodedSourceImage(pixels, 1, false);
        }
    }

    public string EncodeJpeg(Mat image, int quality = 91)
    {
        if (image.Empty()) throw new ArgumentException("Das normalisierte Kartenbild ist leer.", nameof(image));
        Cv2.ImEncode(".jpg", image, out var bytes,
            [(int)ImwriteFlags.JpegQuality, Math.Clamp(quality, 60, 98)]);
        return "data:image/jpeg;base64," + Convert.ToBase64String(bytes);
    }

    private static int ReadExifOrientation(Image image)
    {
        try
        {
            if (!image.PropertyIdList.Contains(ExifOrientationId)) return 1;
            var property = image.GetPropertyItem(ExifOrientationId);
            var value = property?.Value;
            return value is { Length: >= 2 }
                ? Math.Clamp((int)BitConverter.ToUInt16(value, 0), 1, 8)
                : 1;
        }
        catch (ArgumentException)
        {
            return 1;
        }
    }

    private static void ApplyExifOrientation(Image image, int orientation)
    {
        var transform = orientation switch
        {
            2 => RotateFlipType.RotateNoneFlipX,
            3 => RotateFlipType.Rotate180FlipNone,
            4 => RotateFlipType.Rotate180FlipX,
            5 => RotateFlipType.Rotate90FlipX,
            6 => RotateFlipType.Rotate90FlipNone,
            7 => RotateFlipType.Rotate270FlipX,
            8 => RotateFlipType.Rotate270FlipNone,
            _ => RotateFlipType.RotateNoneFlipNone
        };
        if (transform != RotateFlipType.RotateNoneFlipNone) image.RotateFlip(transform);
    }
}
