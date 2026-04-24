import { EntitySchema } from 'typeorm'

export const SpikeSessionSequenceEntity = new EntitySchema<SpikeSessionSequenceSchema>({
    name: 'spike_session_sequence',
    columns: {
        sessionId: {
            type: String,
            length: 256,
            primary: true,
        },
        nextSequence: {
            type: 'bigint',
            nullable: false,
        },
        updatedAt: {
            type: 'timestamp with time zone',
            nullable: false,
        },
    },
})

export type SpikeSessionSequenceSchema = {
    sessionId: string
    nextSequence: string
    updatedAt: Date
}
