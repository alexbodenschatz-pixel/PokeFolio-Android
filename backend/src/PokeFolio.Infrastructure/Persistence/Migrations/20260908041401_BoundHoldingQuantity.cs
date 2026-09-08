using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PokeFolio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BoundHoldingQuantity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_holdings_quantity_nonnegative",
                schema: "collection",
                table: "holdings");

            migrationBuilder.Sql(
                """
                ALTER TABLE collection.holdings
                ADD CONSTRAINT ck_holdings_quantity_range
                CHECK (quantity >= 0 AND quantity <= 1000000) NOT VALID;

                DO $pokefolio$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM collection.holdings
                        WHERE quantity > 1000000
                    ) THEN
                        ALTER TABLE collection.holdings
                        VALIDATE CONSTRAINT ck_holdings_quantity_range;
                    END IF;
                END
                $pokefolio$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_holdings_quantity_range",
                schema: "collection",
                table: "holdings");

            migrationBuilder.AddCheckConstraint(
                name: "ck_holdings_quantity_nonnegative",
                schema: "collection",
                table: "holdings",
                sql: "quantity >= 0");
        }
    }
}
