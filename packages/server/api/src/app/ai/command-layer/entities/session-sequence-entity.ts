import { EntitySchema } from 'typeorm'

export const InteractiveFlowSessionSequenceEntity = new EntitySchema<InteractiveFlowSessionSequenceSchema>({
    name: 'interactive_flow_session_sequence',
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

export type InteractiveFlowSessionSequenceSchema = {
    sessionId: string
    nextSequence: string
    updatedAt: Date
}
