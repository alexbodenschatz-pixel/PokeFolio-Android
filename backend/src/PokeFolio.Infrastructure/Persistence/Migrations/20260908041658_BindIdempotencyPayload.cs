using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PokeFolio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class BindIdempotencyPayload : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "operation_kind",
                schema: "sync",
                table: "processed_operations",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "request_hash",
                schema: "sync",
                table: "processed_operations",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "operation_kind",
                schema: "sync",
                table: "processed_operations");

            migrationBuilder.DropColumn(
                name: "request_hash",
                schema: "sync",
                table: "processed_operations");
        }
    }
}
