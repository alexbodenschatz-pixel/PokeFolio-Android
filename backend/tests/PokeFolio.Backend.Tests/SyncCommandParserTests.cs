using System.Text.Json;
using PokeFolio.Api.Sync;

namespace PokeFolio.Backend.Tests;

[TestClass]
public sealed class SyncCommandParserTests
{
    private static readonly JsonSerializerOptions SerializerOptions =
        new(JsonSerializerDefaults.Web);

    [TestMethod]
    public void ParserRecognizesEverySupportedOfflineOperation()
    {
        using JsonDocument document = JsonDocument.Parse(
            """
            {
              "operations": [
                {
                  "operationId": "10000000-0000-0000-0000-000000000001",
                  "kind": "holding.create",
                  "holding": {
                    "id": "20000000-0000-0000-0000-000000000001",
                    "cardId": "30000000-0000-0000-0000-000000000001",
                    "language": "de",
                    "variant": "normal",
                    "condition": "near-mint",
                    "quantity": 1
                  }
                },
                {
                  "operationId": "10000000-0000-0000-0000-000000000002",
                  "kind": "holding.quantityDelta",
                  "holdingId": "20000000-0000-0000-0000-000000000001",
                  "delta": 1
                },
                {
                  "operationId": "10000000-0000-0000-0000-000000000003",
                  "kind": "holding.update",
                  "holdingId": "20000000-0000-0000-0000-000000000001",
                  "baseVersion": 2,
                  "changes": { "notes": null }
                },
                {
                  "operationId": "10000000-0000-0000-0000-000000000004",
                  "kind": "holding.delete",
                  "holdingId": "20000000-0000-0000-0000-000000000001",
                  "baseVersion": 3
                }
              ]
            }
            """);

        bool parsed = SyncCommandParser.TryParse(
            document.RootElement,
            out IReadOnlyList<SyncOperationCommand> operations,
            out IReadOnlyDictionary<string, string[]> errors);

        Assert.IsTrue(
            parsed,
            string.Join("; ", errors.SelectMany(error => error.Value)));
        Assert.HasCount(0, errors);
        Assert.HasCount(4, operations);
        Assert.IsInstanceOfType<SyncHoldingCreateOperationCommand>(operations[0]);
        Assert.IsInstanceOfType<SyncQuantityDeltaOperationCommand>(operations[1]);
        Assert.IsInstanceOfType<SyncHoldingUpdateOperationCommand>(operations[2]);
        Assert.IsInstanceOfType<SyncHoldingDeleteOperationCommand>(operations[3]);
    }

    [TestMethod]
    public void ParserRejectsUnknownKindsAndUnmappedProperties()
    {
        using JsonDocument unknownKind = JsonDocument.Parse(
            """
            {"operations":[{"operationId":"10000000-0000-0000-0000-000000000001","kind":"holding.rename"}]}
            """);
        Assert.IsFalse(SyncCommandParser.TryParse(
            unknownKind.RootElement,
            out _,
            out IReadOnlyDictionary<string, string[]> unknownErrors));
        Assert.IsTrue(unknownErrors.ContainsKey("body"));

        using JsonDocument extraProperty = JsonDocument.Parse(
            """
            {"operations":[{"operationId":"10000000-0000-0000-0000-000000000001","kind":"holding.delete","holdingId":"20000000-0000-0000-0000-000000000001","baseVersion":1,"userId":"30000000-0000-0000-0000-000000000001"}]}
            """);
        Assert.IsFalse(SyncCommandParser.TryParse(
            extraProperty.RootElement,
            out _,
            out IReadOnlyDictionary<string, string[]> propertyErrors));
        Assert.IsTrue(propertyErrors.ContainsKey("body"));
    }

    [TestMethod]
    public void ParserRejectsDuplicatePropertiesAndEmptyBatches()
    {
        using JsonDocument duplicate = JsonDocument.Parse(
            """{"operations":[],"operations":[]}""");
        Assert.IsFalse(SyncCommandParser.TryParse(
            duplicate.RootElement,
            out _,
            out IReadOnlyDictionary<string, string[]> duplicateErrors));
        Assert.IsTrue(duplicateErrors.ContainsKey("body"));

        using JsonDocument empty = JsonDocument.Parse("""{"operations":[]}""");
        Assert.IsFalse(SyncCommandParser.TryParse(
            empty.RootElement,
            out _,
            out IReadOnlyDictionary<string, string[]> emptyErrors));
        Assert.IsTrue(emptyErrors.ContainsKey("operations"));
    }

    [TestMethod]
    public void SerializerWritesTheDiscriminatorUsedByOfflineClients()
    {
        var batch = new SyncOperationBatchCommand(
            new SyncOperationCommand?[]
            {
                new SyncQuantityDeltaOperationCommand(
                    Guid.NewGuid(),
                    Guid.NewGuid(),
                    1)
            });

        JsonElement wire = JsonSerializer.SerializeToElement(
            batch,
            SerializerOptions);

        Assert.AreEqual(
            "holding.quantityDelta",
            wire.GetProperty("operations")[0].GetProperty("kind").GetString());
        Assert.IsTrue(SyncCommandParser.TryParse(wire, out var parsed, out var errors));
        Assert.HasCount(0, errors);
        Assert.IsInstanceOfType<SyncQuantityDeltaOperationCommand>(parsed[0]);
    }
}
