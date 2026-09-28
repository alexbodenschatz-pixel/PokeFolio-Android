namespace PokeFolio.Desktop.Security;

public sealed record RefreshTokenCredential(Guid DeviceId, string RefreshToken);

public interface IRefreshTokenStore
{
    RefreshTokenCredential? Load();

    void Save(RefreshTokenCredential credential);

    void Delete();
}
