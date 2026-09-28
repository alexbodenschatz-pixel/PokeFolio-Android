using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PokeFolio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CanonicalizeChangeActions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE sync.changes
                SET action = 'upsert'
                WHERE action IN ('created', 'updated');

                UPDATE sync.changes
                SET action = 'delete'
                WHERE action = 'deleted';

                DO $pokefolio$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM sync.changes
                        WHERE action NOT IN ('upsert', 'delete')
                    ) THEN
                        RAISE EXCEPTION
                            'Unknown legacy sync.change action found; review and map it before retrying the migration.';
                    END IF;
                END
                $pokefolio$;

                ALTER TABLE sync.changes
                ADD CONSTRAINT ck_changes_action
                CHECK (action IN ('upsert', 'delete'));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_changes_action",
                schema: "sync",
                table: "changes");
        }
    }
}
