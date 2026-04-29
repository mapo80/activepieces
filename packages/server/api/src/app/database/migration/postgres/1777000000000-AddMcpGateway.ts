import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddMcpGateway1777000000000 implements MigrationInterface {
    name = 'AddMcpGateway1777000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "mcp_gateway" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "name" character varying NOT NULL,
                "url" character varying NOT NULL,
                "description" character varying,
                "auth" jsonb NOT NULL,
                CONSTRAINT "PK_mcp_gateway" PRIMARY KEY ("id")
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
