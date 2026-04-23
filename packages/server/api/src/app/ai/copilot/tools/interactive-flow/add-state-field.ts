import {
    FlowActionType,
    FlowOperationRequest,
    FlowOperationType,
    flowStructureUtil,
    InteractiveFlowAction,
    InteractiveFlowStateField,
    isNil,
} from '@activepieces/shared'
import { z } from 'zod'
import { CopilotContext, CopilotTool } from '../../scope-registry'

const Parameters = z.object({
    name: z.string().min(1).describe('The unique machine name of the state field (camelCase). Example: "customerName", "closureDate".'),
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']).describe('Data type of the field.'),
    extractable: z.boolean().describe('Whether the value can be extracted from user text. True for fields the operator provides by typing, false for fields produced by upstream tools.'),
    description: z.string().min(1).describe('Business-language description of what this field represents. Used by the AI extractor and surfaced to operators on validation errors.'),
    labelIt: z.string().optional().describe('Italian human-friendly label used in user-facing messages (e.g. "rapporto", "motivazione"). Highly recommended.'),
    labelEn: z.string().optional().describe('English human-friendly label.'),
    enumFrom: z.string().optional().describe('Name of another state field that holds a catalog array. When set, values are validated against this catalog.'),
    enumValueField: z.string().optional().describe('Key within catalog items used for matching (e.g. "code", "ndg").'),
    pattern: z.string().optional().describe('Regex the value must match (used for tentative acceptance before the catalog is loaded).'),
    parser: z.enum(['ndg', 'rapportoId', 'absolute-date', 'reason-code-cued', 'confirmation-keyword', 'ner-name']).optional().describe('Pre-parser identifier for structured extraction.'),
    extractionScope: z.enum(['global', 'node-local']).optional().describe('If "node-local", the value is only accepted when the user is paused at a node declaring this output. Default is "global".'),
})

type Args = z.infer<typeof Parameters>

function buildField(args: Args): InteractiveFlowStateField {
    const field: InteractiveFlowStateField = {
        name: args.name,
        type: args.type,
        extractable: args.extractable,
        description: args.description,
    }
    if (args.labelIt || args.labelEn) {
        field.label = {
            it: args.labelIt ?? args.name,
            en: args.labelEn ?? args.name,
        }
    }
    if (args.enumFrom) field.enumFrom = args.enumFrom
    if (args.enumValueField) field.enumValueField = args.enumValueField
    if (args.pattern) field.pattern = args.pattern
    if (args.parser) field.parser = args.parser
    if (args.extractionScope) field.extractionScope = args.extractionScope
    return field
}

export const addStateFieldTool: CopilotTool = {
    description: 'Adds a new state field to the INTERACTIVE_FLOW action. State fields are the data the flow collects (from user or from tool outputs) and validates. Always specify a description and a localized label.',
    parameters: Parameters,
    isMutation: true,
    execute: async (rawArgs, ctx: CopilotContext): Promise<{ op: FlowOperationRequest }> => {
        const args = Parameters.parse(rawArgs)
        const steps = flowStructureUtil.getAllSteps(ctx.flowVersion.trigger)
        const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
        if (isNil(ifStep)) {
            throw new Error('No INTERACTIVE_FLOW action present. Insert one first via insert_interactive_flow_action.')
        }
        const settings = ifStep.settings
        const existing = (settings.stateFields ?? []).some((f) => f.name === args.name)
        if (existing) {
            throw new Error(`State field "${args.name}" already exists. Use update_state_field to modify it instead.`)
        }
        const newField = buildField(args)
        const updatedSettings = {
            ...settings,
            stateFields: [...(settings.stateFields ?? []), newField],
        }
        return {
            op: {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    ...ifStep,
                    settings: updatedSettings,
                },
            } as FlowOperationRequest,
        }
    },
}

export const addStateField = {
    buildField,
}
