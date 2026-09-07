using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using PokeFolio.Domain.Abstractions;
using PokeFolio.Domain.Collection;
using PokeFolio.Infrastructure.Catalog;
using PokeFolio.Infrastructure.Identity;
using PokeFolio.Infrastructure.Sync;

namespace PokeFolio.Infrastructure.Persistence;

public sealed class PokeFolioDbContext(
    DbContextOptions<PokeFolioDbContext> options,
    IUserContext userContext)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public Guid? CurrentUserId => userContext.UserId;

    public DbSet<CatalogCard> Cards => Set<CatalogCard>();
    public DbSet<CollectionHolding> CollectionHoldings => Set<CollectionHolding>();
    public DbSet<DeviceSession> DeviceSessions => Set<DeviceSession>();
    public DbSet<ProcessedSyncOperation> ProcessedSyncOperations => Set<ProcessedSyncOperation>();
    public DbSet<UserChange> UserChanges => Set<UserChange>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        ConfigureIdentity(builder);
        ConfigureCatalog(builder);
        ConfigureCollection(builder);
        ConfigureSync(builder);
    }

    private void ConfigureIdentity(ModelBuilder builder)
    {
        builder.Entity<ApplicationUser>(entity =>
        {
            entity.ToTable("users", "identity");
            entity.Property(user => user.CreatedAt).HasColumnName("created_at");
            entity.Property(user => user.UpdatedAt).HasColumnName("updated_at");
        });
        builder.Entity<IdentityRole<Guid>>().ToTable("roles", "identity");
        builder.Entity<IdentityUserRole<Guid>>().ToTable("user_roles", "identity");
        builder.Entity<IdentityUserClaim<Guid>>().ToTable("user_claims", "identity");
        builder.Entity<IdentityUserLogin<Guid>>().ToTable("user_logins", "identity");
        builder.Entity<IdentityUserToken<Guid>>().ToTable("user_tokens", "identity");
        builder.Entity<IdentityRoleClaim<Guid>>().ToTable("role_claims", "identity");

        builder.Entity<DeviceSession>(entity =>
        {
            entity.ToTable("devices", "identity");
            entity.HasKey(device => device.Id);
            entity.Property(device => device.UserId).HasColumnName("user_id");
            entity.Property(device => device.TokenFamilyId).HasColumnName("token_family_id");
            entity.Property(device => device.RefreshTokenHash)
                .HasColumnName("refresh_token_hash")
                .HasMaxLength(128)
                .IsRequired();
            entity.Property(device => device.DeviceName).HasColumnName("device_name").HasMaxLength(120);
            entity.Property(device => device.Platform).HasColumnName("platform").HasMaxLength(24);
            entity.Property(device => device.CreatedAt).HasColumnName("created_at");
            entity.Property(device => device.LastSeenAt).HasColumnName("last_seen_at");
            entity.Property(device => device.ExpiresAt).HasColumnName("expires_at");
            entity.Property(device => device.RevokedAt).HasColumnName("revoked_at");
            entity.HasAlternateKey(device => new { device.UserId, device.Id });
            entity.HasIndex(device => device.RefreshTokenHash).IsUnique();
            entity.HasIndex(device => new { device.UserId, device.TokenFamilyId });
            entity.HasOne(device => device.User)
                .WithMany()
                .HasForeignKey(device => device.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(device =>
                CurrentUserId.HasValue && (Guid?)device.UserId == CurrentUserId);
        });
    }

    private static void ConfigureCatalog(ModelBuilder builder)
    {
        builder.Entity<CatalogCard>(entity =>
        {
            entity.ToTable("cards", "catalog");
            entity.HasKey(card => card.Id);
            entity.Property(card => card.Tcg).HasColumnName("tcg").HasMaxLength(32);
            entity.Property(card => card.Provider).HasColumnName("provider").HasMaxLength(48);
            entity.Property(card => card.ProviderCardId).HasColumnName("provider_card_id").HasMaxLength(160);
            entity.Property(card => card.Name).HasColumnName("name").HasMaxLength(240);
            entity.Property(card => card.SetCode).HasColumnName("set_code").HasMaxLength(64);
            entity.Property(card => card.Number).HasColumnName("number").HasMaxLength(64);
            entity.Property(card => card.CreatedAt).HasColumnName("created_at");
            entity.Property(card => card.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(card => new { card.Provider, card.ProviderCardId }).IsUnique();
            entity.HasIndex(card => new { card.Tcg, card.SetCode, card.Number });
        });
    }

    private void ConfigureCollection(ModelBuilder builder)
    {
        builder.Entity<CollectionHolding>(entity =>
        {
            entity.ToTable("holdings", "collection");
            entity.HasKey(holding => holding.Id);
            entity.Property(holding => holding.Id).HasColumnName("id");
            entity.Property(holding => holding.UserId).HasColumnName("user_id");
            entity.Property(holding => holding.CardId).HasColumnName("card_id");
            entity.Property(holding => holding.VariantId).HasColumnName("variant_id");
            entity.Property(holding => holding.Language).HasColumnName("language").HasMaxLength(16);
            entity.Property(holding => holding.Variant).HasColumnName("variant").HasMaxLength(80);
            entity.Property(holding => holding.Condition).HasColumnName("condition").HasMaxLength(40);
            entity.Property(holding => holding.Quantity).HasColumnName("quantity");
            entity.Property(holding => holding.Notes).HasColumnName("notes").HasMaxLength(10_000);
            entity.Property(holding => holding.Version)
                .HasColumnName("version")
                .IsConcurrencyToken();
            entity.Property(holding => holding.CreatedAt).HasColumnName("created_at");
            entity.Property(holding => holding.UpdatedAt).HasColumnName("updated_at");
            entity.ToTable(table => table.HasCheckConstraint(
                "ck_holdings_quantity_nonnegative",
                "quantity >= 0"));
            entity.HasIndex(holding => holding.UserId);
            entity.HasIndex(holding => new
            {
                holding.UserId,
                holding.CardId,
                holding.VariantId,
                holding.Language,
                holding.Variant,
                holding.Condition
            })
                .IsUnique()
                .AreNullsDistinct(false);
            entity.HasOne<CatalogCard>()
                .WithMany()
                .HasForeignKey(holding => holding.CardId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(holding => holding.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(holding =>
                CurrentUserId.HasValue && (Guid?)holding.UserId == CurrentUserId);
        });
    }

    private void ConfigureSync(ModelBuilder builder)
    {
        builder.Entity<ProcessedSyncOperation>(entity =>
        {
            entity.ToTable("processed_operations", "sync");
            entity.HasKey(operation => operation.Id);
            entity.Property(operation => operation.Id).HasColumnName("id").UseIdentityByDefaultColumn();
            entity.Property(operation => operation.UserId).HasColumnName("user_id");
            entity.Property(operation => operation.DeviceSessionId).HasColumnName("device_session_id");
            entity.Property(operation => operation.OperationId).HasColumnName("operation_id");
            entity.Property(operation => operation.Status).HasColumnName("status").HasMaxLength(24);
            entity.Property(operation => operation.ResponseJson).HasColumnName("response_json").HasColumnType("jsonb");
            entity.Property(operation => operation.ProcessedAt).HasColumnName("processed_at");
            entity.HasIndex(operation => new { operation.UserId, operation.OperationId }).IsUnique();
            entity.HasOne(operation => operation.User)
                .WithMany()
                .HasForeignKey(operation => operation.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(operation => operation.DeviceSession)
                .WithMany()
                .HasForeignKey(operation => new { operation.UserId, operation.DeviceSessionId })
                .HasPrincipalKey(device => new { device.UserId, device.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(operation =>
                CurrentUserId.HasValue && (Guid?)operation.UserId == CurrentUserId);
        });

        builder.Entity<UserChange>(entity =>
        {
            entity.ToTable("changes", "sync");
            entity.HasKey(change => change.Sequence);
            entity.Property(change => change.Sequence).HasColumnName("sequence").UseIdentityByDefaultColumn();
            entity.Property(change => change.UserId).HasColumnName("user_id");
            entity.Property(change => change.EntityType).HasColumnName("entity_type").HasMaxLength(80);
            entity.Property(change => change.EntityId).HasColumnName("entity_id");
            entity.Property(change => change.Action).HasColumnName("action").HasMaxLength(16);
            entity.Property(change => change.Version).HasColumnName("version");
            entity.Property(change => change.PayloadJson).HasColumnName("payload_json").HasColumnType("jsonb");
            entity.Property(change => change.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(change => new { change.UserId, change.Sequence }).IsUnique();
            entity.HasOne(change => change.User)
                .WithMany()
                .HasForeignKey(change => change.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(change =>
                CurrentUserId.HasValue && (Guid?)change.UserId == CurrentUserId);
        });
    }
}
