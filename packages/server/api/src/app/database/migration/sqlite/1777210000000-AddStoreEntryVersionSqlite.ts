import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddStoreEntryVersionSqlite1777210000000 implements MigrationInterface {
    name = 'AddStoreEntryVersionSqlite1777210000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "store-entry" ADD COLUMN "version" bigint NOT NULL DEFAULT 0
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "store-entry" DROP COLUMN "version"')
    }
}
