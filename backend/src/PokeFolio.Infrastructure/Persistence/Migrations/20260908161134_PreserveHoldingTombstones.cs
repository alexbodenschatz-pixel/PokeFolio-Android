using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PokeFolio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PreserveHoldingTombstones : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_holdings_user_id_card_id_variant_id_language_variant_condit~",
                schema: "collection",
                table: "holdings");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "deleted_at",
                schema: "collection",
                table: "holdings",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_holdings_user_id_card_id_variant_id_language_variant_condit~",
                schema: "collection",
                table: "holdings",
                columns: new[] { "user_id", "card_id", "variant_id", "language", "variant", "condition" },
                unique: true,
                filter: "deleted_at IS NULL")
                .Annotation("Npgsql:NullsDistinct", false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "PreserveHoldingTombstones cannot be rolled back safely because removing deleted_at " +
                "would resurrect deleted holdings and can collapse distinct replacement identities.");
        }
    }
}
