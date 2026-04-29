import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddMcpGatewaySqlite1777000000000 implements MigrationInterface {
    name = 'AddMcpGatewaySqlite1777000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "mcp_gateway" (
                "id" varchar(21) PRIMARY KEY NOT NULL,
                "created" datetime NOT NULL DEFAULT (datetime('now')),
                "updated" datetime NOT NULL DEFAULT (datetime('now')),
                "platformId" varchar(21) NOT NULL,
                "name" varchar NOT NULL,
                "url" varchar NOT NULL,
                "description" varchar,
                "auth" text NOT NULL
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_mcp_gateway_platform_id" ON "mcp_gateway" ("platformId")
        `)
        await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_mcp_gateway_platform_id_name" ON "mcp_gateway" ("platformId", "name")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "idx_mcp_gateway_platform_id_name"')
        await queryRunner.query('DROP INDEX "idx_mcp_gateway_platform_id"')
        await queryRunner.query('DROP TABLE "mcp_gateway"')
    }
}
