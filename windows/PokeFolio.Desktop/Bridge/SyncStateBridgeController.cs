using PokeFolio.Desktop.Backend;
using PokeFolio.Desktop.Diagnostics;
using PokeFolio.Desktop.Sync;

namespace PokeFolio.Desktop.Bridge;

internal sealed class SyncStateBridgeController
{
    private readonly IPokeFolioAccountService account;
    private readonly IAccountSyncStateStore store;

    public SyncStateBridgeController(
        IPokeFolioAccountService account,
        IAccountSyncStateStore store)
    {
        this.account = account ?? throw new ArgumentNullException(nameof(account));
        this.store = store ?? throw new ArgumentNullException(nameof(store));
    }

    public string? Load()
    {
        Guid userId = AuthenticatedUserId();
        string? snapshot = store.Load(userId);
        DesktopLog.Info("SYNC_STATE_LOAD", ("found", snapshot is not null));
        return snapshot;
    }

    public void Save(string snapshotJson)
    {
        Guid userId = AuthenticatedUserId();
        store.Save(userId, snapshotJson);
        DesktopLog.Info("SYNC_STATE_SAVE", ("characters", snapshotJson?.Length ?? 0));
    }

    private Guid AuthenticatedUserId()
    {
        PokeFolioAccountStatus status = account.GetStatus();
        if (!status.Authenticated || status.Session is null || status.Session.UserId == Guid.Empty)
        {
            throw new InvalidOperationException(
                "An authenticated account is required for account sync storage.");
        }
        return status.Session.UserId;
    }
}
