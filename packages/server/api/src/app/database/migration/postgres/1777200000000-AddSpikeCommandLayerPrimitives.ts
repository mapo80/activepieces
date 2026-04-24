import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddSpikeCommandLayerPrimitives1777200000000 implements Migration {
    name = 'AddSpikeCommandLayerPrimitives1777200000000'
    breaking = false
    release = '0.83.0-spike'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "spike_turn_log" (
                "turnId" character varying(64) NOT NULL,
                "sessionId" character varying(256) NOT NULL,
                "flowRunId" character varying(64) NOT NULL,
                "status" character varying(16) NOT NULL,
                "workerId" character varying(64),
                "leaseToken" uuid,
                "lockedUntil" TIMESTAMP WITH TIME ZONE,
                "acceptedCommands" jsonb,
                "rejectedCommands" jsonb,
                "result" jsonb,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "committedAt" TIMESTAMP WITH TIME ZONE,
                "failedReason" text,
                CONSTRAINT "pk_spike_turn_log" PRIMARY KEY ("turnId"),
                CONSTRAINT "chk_spike_turn_log_status" CHECK ("status" IN (
                    'in-progress','prepared','finalized','compensated','failed'
                ))
            )
        `)
        await queryRunner.query('CREATE INDEX "idx_spike_turn_log_session_id" ON "spike_turn_log" ("sessionId")')
        await queryRunner.query('CREATE INDEX "idx_spike_turn_log_status" ON "spike_turn_log" ("status")')
        await queryRunner.query(`
            CREATE INDEX "idx_spike_turn_log_lease_expiry" ON "spike_turn_log" ("lockedUntil")
            WHERE "status" IN ('in-progress','prepared')
        `)

        await queryRunner.query(`
            CREATE TABLE "spike_session_sequence" (
                "sessionId" character varying(256) NOT NULL,
                "nextSequence" bigint NOT NULL,
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "pk_spike_session_sequence" PRIMARY KEY ("sessionId")
            )
        `)

        await queryRunner.query(`
            CREATE TABLE "spike_outbox" (
                "outboxEventId" uuid NOT NULL,
                "turnId" character varying(64) NOT NULL,
                "sessionId" character varying(256) NOT NULL,
                "flowRunId" character varying(64) NOT NULL,
                "sessionSequence" bigint NOT NULL,
                "eventType" character varying(64) NOT NULL,
                "eventStatus" character varying(16) NOT NULL DEFAULT 'pending',
                "payload" jsonb NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "publishedAt" TIMESTAMP WITH TIME ZONE,
                "attempts" integer NOT NULL DEFAULT 0,
                "nextRetryAt" TIMESTAMP WITH TIME ZONE,
                "failedAt" TIMESTAMP WITH TIME ZONE,
                "claimedBy" character varying(64),
                "claimedUntil" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "pk_spike_outbox" PRIMARY KEY ("outboxEventId"),
                CONSTRAINT "uq_spike_outbox_session_sequence" UNIQUE ("sessionId", "sessionSequence"),
                CONSTRAINT "chk_spike_outbox_event_status" CHECK ("eventStatus" IN (
                    'pending','publishable','void'
                ))
            )
        `)
        await queryRunner.query(`
            CREATE INDEX "idx_spike_outbox_publishable"
            ON "spike_outbox" ("sessionId", "sessionSequence")
            WHERE "eventStatus" = 'publishable' AND "publishedAt" IS NULL
        `)
        await queryRunner.query('CREATE INDEX "idx_spike_outbox_turn_id" ON "spike_outbox" ("turnId")')
        await queryRunner.query(`
            CREATE INDEX "idx_spike_outbox_retry"
            ON "spike_outbox" ("nextRetryAt")
            WHERE "eventStatus" = 'publishable' AND "publishedAt" IS NULL AND "failedAt" IS NULL
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX IF EXISTS "idx_spike_outbox_retry"')
        await queryRunner.query('DROP INDEX IF EXISTS "idx_spike_outbox_turn_id"')
        await queryRunner.query('DROP INDEX IF EXISTS "idx_spike_outbox_publishable"')
        await queryRunner.query('DROP TABLE IF EXISTS "spike_outbox"')
        await queryRunner.query('DROP TABLE IF EXISTS "spike_session_sequence"')
        await queryRunner.query('DROP INDEX IF EXISTS "idx_spike_turn_log_lease_expiry"')
        await queryRunner.query('DROP INDEX IF EXISTS "idx_spike_turn_log_status"')
        await queryRunner.query('DROP INDEX IF EXISTS "idx_spike_turn_log_session_id"')
        await queryRunner.query('DROP TABLE IF EXISTS "spike_turn_log"')
    }
}
