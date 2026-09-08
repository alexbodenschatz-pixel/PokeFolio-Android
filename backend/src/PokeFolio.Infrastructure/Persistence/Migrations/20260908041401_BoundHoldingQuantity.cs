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

            migrationBuilder.AddCheckConstraint(
                name: "ck_holdings_quantity_range",
                schema: "collection",
                table: "holdings",
                sql: "quantity >= 0 AND quantity <= 1000000");
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
