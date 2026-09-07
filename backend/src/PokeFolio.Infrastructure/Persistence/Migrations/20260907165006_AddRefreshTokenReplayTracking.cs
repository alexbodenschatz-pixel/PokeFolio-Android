using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PokeFolio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRefreshTokenReplayTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "consumed_refresh_tokens",
                schema: "identity",
                columns: table => new
                {
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    device_session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_family_id = table.Column<Guid>(type: "uuid", nullable: false),
                    consumed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_consumed_refresh_tokens", x => x.token_hash);
                    table.ForeignKey(
                        name: "FK_consumed_refresh_tokens_devices_user_id_device_session_id",
                        columns: x => new { x.user_id, x.device_session_id },
                        principalSchema: "identity",
                        principalTable: "devices",
                        principalColumns: new[] { "user_id", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_consumed_refresh_tokens_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_consumed_refresh_tokens_expires_at",
                schema: "identity",
                table: "consumed_refresh_tokens",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "IX_consumed_refresh_tokens_user_id_device_session_id",
                schema: "identity",
                table: "consumed_refresh_tokens",
                columns: new[] { "user_id", "device_session_id" });

            migrationBuilder.CreateIndex(
                name: "IX_consumed_refresh_tokens_user_id_token_family_id",
                schema: "identity",
                table: "consumed_refresh_tokens",
                columns: new[] { "user_id", "token_family_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "consumed_refresh_tokens",
                schema: "identity");
        }
    }
}
