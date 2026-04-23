import type { InteractiveFlowStateField } from './interactive-flow-action'

/**
 * Contract: which state fields the LLM field-extractor is allowed to
 * populate at the current turn.
 *
 * The contract is a property of the field itself (extractable +
 * extractionScope) plus the per-node opt-ins. It intentionally does NOT
 * consult the current conversation state — re-extraction of already
 * populated fields is handled at a different layer (prompt injection of
 * <LOCKED_FIELDS> in the extractor prompt), not via eligibility gating.
 * Keeping this function state-free makes it reusable across the runtime
 * extractor, the Copilot validator, UI hints and audit tooling.
 *
 * Rules:
 *   1. Any field in `currentNode.stateOutputs` is eligible — a node may
 *      pre-fill its own outputs when the user volunteers the answer
 *      ahead of being asked.
 *   2. Any field in `currentNode.allowedExtraFields` is eligible — an
 *      escape hatch for authored, per-node opt-ins.
 *   3. Every `identityFields` entry is eligible globally — user identity
 *      markers can arrive on any turn.
 *   4. Any field declared `extractable: true` whose `extractionScope` is
 *      not `'node-local'` is eligible globally. `extractionScope:
 *      'node-local'` scopes the field to the node that lists it in
 *      `stateOutputs` (the canonical case is the CONFIRM node's
 *      `confirmed` trigger).
 */
export function computeFieldEligibility(ctx: FieldEligibilityContext): Set<string> {
    const eligible = new Set<string>()
    for (const out of ctx.currentNode?.stateOutputs ?? []) eligible.add(out)
    for (const extra of ctx.currentNode?.allowedExtraFields ?? []) eligible.add(extra)
    for (const id of ctx.identityFields ?? []) eligible.add(id)
    for (const field of ctx.stateFields) {
        if (field.extractable === true && field.extractionScope !== 'node-local') {
            eligible.add(field.name)
        }
    }
    return eligible
}

export type FieldEligibilityContext = {
    readonly currentNode?: {
        readonly stateOutputs?: readonly string[]
        readonly allowedExtraFields?: readonly string[]
    }
    readonly identityFields?: readonly string[]
    readonly stateFields: readonly Pick<
    InteractiveFlowStateField,
    'name' | 'extractable' | 'extractionScope'
    >[]
}
