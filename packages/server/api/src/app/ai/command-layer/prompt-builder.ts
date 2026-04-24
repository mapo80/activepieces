import { InfoIntent, InteractiveFlowStateField, PendingInteraction } from '@activepieces/shared'

function redactState(state: Record<string, unknown>, stateFields: InteractiveFlowStateField[]): Record<string, unknown> {
    const sensitiveByName = new Set(stateFields.filter(f => f.sensitive === true).map(f => f.name))
    const output: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(state)) {
        if (sensitiveByName.has(k)) {
            output[k] = '<redacted>'
        }
        else if (typeof v === 'string' && v.length > 200) {
            output[k] = `${v.slice(0, 200)}...`
        }
        else {
            output[k] = v
        }
    }
    return output
}

function buildAllowedFields({ stateFields, catalogReadiness }: { stateFields: InteractiveFlowStateField[], catalogReadiness: Record<string, boolean> }): string[] {
    return stateFields
        .filter((f) => {
            if (f.extractable !== true) return false
            if (f.enumFrom && catalogReadiness[f.enumFrom] === false) return false
            return true
        })
        .map(f => f.name)
}

function buildSystemPrompt({ input }: { input: BuildPromptInput }): string {
    const {
        flowLabel,
        flowDescription,
        state,
        stateFields,
        currentNodeHint,
        pendingInteraction,
        infoIntents,
        catalogReadiness,
        locale,
        systemPromptAddendum,
    } = input

    const allowedFields = buildAllowedFields({ stateFields, catalogReadiness })
    const redacted = redactState(state, stateFields)
    const pendingSummary = pendingInteraction ? `${pendingInteraction.type}` : 'none'
    const label = flowLabel ?? 'Interactive Flow'

    return [
        'You are a banking assistant interpreter. Produce a structured list of commands, not prose.',
        '',
        '<context>',
        `  Flow: ${label}`,
        flowDescription ? `  Description: ${flowDescription}` : '',
        `  Locale: ${locale ?? 'it'}`,
        `  Current state (redacted): ${JSON.stringify(redacted)}`,
        `  Current node: ${currentNodeHint?.displayName ?? currentNodeHint?.nodeId ?? 'pre-flow'}`,
        `  Active pending: ${pendingSummary}`,
        '</context>',
        '',
        '<allowed_commands>',
        '  SET_FIELDS, ASK_FIELD, ANSWER_META, ANSWER_INFO, REQUEST_CANCEL, RESOLVE_PENDING, REPROMPT',
        '</allowed_commands>',
        '',
        '<allowed_fields_for_extraction>',
        `  ${allowedFields.join(', ')}`,
        '</allowed_fields_for_extraction>',
        '',
        '<allowed_info_intents>',
        ...infoIntents.map(i => `  ${i.id}: ${i.description}`),
        '</allowed_info_intents>',
        '',
        '<guidance>',
        '  Prefer extracting missing fields first.',
        '  Use ANSWER_INFO only with a registered infoIntent id.',
        '  If unsure, emit REPROMPT.',
        '</guidance>',
        '',
        '<do_not>',
        '  - invent field names or values not in allowed_fields',
        '  - use infoIntent ids not in allowed_info_intents',
        '  - include PII values in ANSWER_META.message',
        '</do_not>',
        systemPromptAddendum ? '' : '',
        systemPromptAddendum ? systemPromptAddendum : '',
    ].filter(Boolean).join('\n')
}

export const promptBuilder = {
    build: buildSystemPrompt,
    buildAllowedFields,
}

export type BuildPromptInput = {
    flowLabel?: string
    flowDescription?: string
    state: Record<string, unknown>
    stateFields: InteractiveFlowStateField[]
    currentNodeHint: { nodeId: string, nodeType: 'USER_INPUT' | 'CONFIRM', displayName?: string } | null
    pendingInteraction: PendingInteraction | null
    infoIntents: InfoIntent[]
    catalogReadiness: Record<string, boolean>
    locale?: string
    systemPromptAddendum?: string
}
