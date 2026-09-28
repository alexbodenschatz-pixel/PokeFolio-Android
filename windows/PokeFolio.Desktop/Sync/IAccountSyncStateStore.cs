namespace PokeFolio.Desktop.Sync;

public interface IAccountSyncStateStore
{
    string? Load(Guid userId);

    void Save(Guid userId, string snapshotJson);
}
