import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddStoreEntryVersion1777210000000 implements Migration {
    name = 'AddStoreEntryVersion1777210000000'
    breaking = false
    release = '0.83.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "store-entry" ADD COLUMN IF NOT EXISTS "version" bigint NOT NULL DEFAULT 0
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "store-entry" DROP COLUMN IF EXISTS "version"')
    }
}
