import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddCopilotEnabledToPlatformPlan1777100000000 implements Migration {
    name = 'AddCopilotEnabledToPlatformPlan1777100000000'
    breaking = false
    release = '0.82.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "platform_plan" ADD COLUMN IF NOT EXISTS "copilotEnabled" boolean')
        await queryRunner.query('UPDATE "platform_plan" SET "copilotEnabled" = false')
        await queryRunner.query('ALTER TABLE "platform_plan" ALTER COLUMN "copilotEnabled" SET NOT NULL')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "platform_plan" DROP COLUMN "copilotEnabled"')
    }
}
