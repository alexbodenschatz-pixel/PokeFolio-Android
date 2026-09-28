using PokeFolio.Api.Sync;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class SyncCursorTests
{
    private static readonly string?[] InvalidCursors =
        [string.Empty, "not-a-cursor", "__________8", "AAAAAAAAAAA="];

    [TestMethod]
    [DataRow(0L)]
    [DataRow(1L)]
    [DataRow(42L)]
    [DataRow(long.MaxValue)]
    public void CursorRoundTripsNonnegativeSequences(long sequence)
    {
        string cursor = SyncCursor.Encode(sequence);

        Assert.HasCount(11, cursor);
        Assert.IsTrue(SyncCursor.TryDecode(cursor, out long decoded));
        Assert.AreEqual(sequence, decoded);
    }

    [TestMethod]
    public void MissingCursorStartsAtTheBeginning()
    {
        Assert.IsTrue(SyncCursor.TryDecode(null, out long sequence));
        Assert.AreEqual(0L, sequence);
    }

    [TestMethod]
    public void MalformedAndNegativeCursorsAreRejected()
    {
        foreach (string? cursor in InvalidCursors)
        {
            Assert.IsFalse(SyncCursor.TryDecode(cursor, out long sequence), cursor);
            Assert.AreEqual(0L, sequence);
        }
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => SyncCursor.Encode(-1));
    }
}
