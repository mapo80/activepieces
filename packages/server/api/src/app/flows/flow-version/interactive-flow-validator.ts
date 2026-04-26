import {
    InteractiveFlowActionSettings,
    InteractiveFlowNode,
    InteractiveFlowNodeType,
    isNil,
} from '@activepieces/shared'

const KNOWN_COMPONENT_IDS: ReadonlySet<string> = new Set([
    'TextInput',
    'DataTable',
    'DatePickerCard',
    'ConfirmCard',
    'ClientCard',
    'DocumentCard',
])

const COMMAND_LAYER_SUPPORTED_DB_TYPES: ReadonlySet<string> = new Set(['POSTGRES', 'PGLITE'])

export function validateInteractiveFlow(
    rawSettings: unknown,
    options?: InteractiveFlowValidationOptions,
): InteractiveFlowValidationResult {
    const parsed = InteractiveFlowActionSettings.safeParse(rawSettings)
    if (!parsed.success) {
        return {
            valid: false,
            errors: parsed.error.issues.map((issue) => ({
                code: 'INVALID_SCHEMA',
                path: issue.path.join('.'),
                message: issue.message,
            })),
        }
    }

    const settings = parsed.data
    const errors: InteractiveFlowValidationError[] = []

    errors.push(...checkDuplicateStateFields(settings.stateFields))
    errors.push(...checkDuplicateNodeIds(settings.nodes))
    errors.push(...checkStateInputExistence(settings.stateFields, settings.nodes))
    errors.push(...checkDuplicateOutputs(settings.nodes))
    errors.push(...checkUnreachableInputs(settings.stateFields, settings.nodes))
    errors.push(...checkBranchTargets(settings.nodes))
    errors.push(...checkComponentWhitelist(settings.nodes))
    errors.push(...checkCycles(settings.nodes))
    errors.push(...checkPostgresRequired(options?.dbType))

    return { valid: errors.length === 0, errors }
}

function checkDuplicateStateFields(stateFields: readonly { name: string }[]): InteractiveFlowValidationError[] {
    const seen = new Set<string>()
    const errors: InteractiveFlowValidationError[] = []
    for (const field of stateFields) {
        if (seen.has(field.name)) {
            errors.push({
                code: 'DUPLICATE_STATE_FIELD',
                path: `stateFields.${field.name}`,
                message: `State field "${field.name}" is declared more than once`,
            })
        }
        seen.add(field.name)
    }
    return errors
}

function checkDuplicateNodeIds(nodes: readonly InteractiveFlowNode[]): InteractiveFlowValidationError[] {
    const seen = new Set<string>()
    const errors: InteractiveFlowValidationError[] = []
    for (const node of nodes) {
        if (seen.has(node.id)) {
            errors.push({
                code: 'DUPLICATE_NODE_ID',
                path: `nodes.${node.id}`,
                message: `Node id "${node.id}" is used more than once`,
            })
        }
        seen.add(node.id)
    }
    return errors
}

function checkStateInputExistence(
    stateFields: readonly { name: string }[],
    nodes: readonly InteractiveFlowNode[],
): InteractiveFlowValidationError[] {
    const declared = new Set(stateFields.map(f => f.name))
    const errors: InteractiveFlowValidationError[] = []
    for (const node of nodes) {
        for (const field of node.stateInputs) {
            if (!declared.has(field)) {
                errors.push({
                    code: 'MISSING_STATE_FIELD',
                    path: `nodes.${node.id}.stateInputs`,
                    message: `Node "${node.id}" references state field "${field}" which is not declared in stateFields`,
                })
            }
        }
        for (const field of node.stateOutputs) {
            if (!declared.has(field)) {
                errors.push({
                    code: 'MISSING_STATE_FIELD',
                    path: `nodes.${node.id}.stateOutputs`,
                    message: `Node "${node.id}" writes to state field "${field}" which is not declared in stateFields`,
                })
            }
        }
    }
    return errors
}

function checkDuplicateOutputs(nodes: readonly InteractiveFlowNode[]): InteractiveFlowValidationError[] {
    const producers = new Map<string, string[]>()
    for (const node of nodes) {
        if (node.nodeType === InteractiveFlowNodeType.BRANCH) continue
        for (const field of node.stateOutputs) {
            const list = producers.get(field) ?? []
            list.push(node.id)
            producers.set(field, list)
        }
    }
    const errors: InteractiveFlowValidationError[] = []
    for (const [field, producerIds] of producers.entries()) {
        if (producerIds.length > 1) {
            errors.push({
                code: 'DUPLICATE_OUTPUT',
                path: `stateFields.${field}`,
                message: `State field "${field}" is written by multiple nodes: ${producerIds.join(', ')}`,
            })
        }
    }
    return errors
}

function checkUnreachableInputs(
    stateFields: readonly { name: string, extractable?: boolean }[],
    nodes: readonly InteractiveFlowNode[],
): InteractiveFlowValidationError[] {
    const declared = new Set(stateFields.map(f => f.name))
    // A field is "written" if either a node declares it as an output OR
    // it is marked extractable:true (the runtime field-extractor writes it
    // whenever the user's message contains a matching value). Without this
    // branch the validator rejects legitimate flows where e.g. `customerName`
    // is extractable and consumed by a tool node — the very first node in
    // most conversational flows.
    const writable = new Set<string>()
    for (const field of stateFields) {
        if (field.extractable === true) writable.add(field.name)
    }
    for (const node of nodes) {
        if (node.nodeType === InteractiveFlowNodeType.BRANCH) continue
        for (const field of node.stateOutputs) {
            writable.add(field)
        }
    }
    const errors: InteractiveFlowValidationError[] = []
    for (const node of nodes) {
        for (const field of node.stateInputs) {
            if (!declared.has(field)) continue
            if (!writable.has(field)) {
                errors.push({
                    code: 'ORPHAN_INPUT',
                    path: `nodes.${node.id}.stateInputs`,
                    message: `Node "${node.id}" requires "${field}" but no node or field extractor writes it`,
                })
            }
        }
    }
    return errors
}

function checkBranchTargets(nodes: readonly InteractiveFlowNode[]): InteractiveFlowValidationError[] {
    const nodeIds = new Set(nodes.map(n => n.id))
    const errors: InteractiveFlowValidationError[] = []
    for (const node of nodes) {
        if (node.nodeType !== InteractiveFlowNodeType.BRANCH) continue
        for (const branch of node.branches) {
            for (const target of branch.targetNodeIds) {
                if (!nodeIds.has(target)) {
                    errors.push({
                        code: 'UNKNOWN_BRANCH_TARGET',
                        path: `nodes.${node.id}.branches.${branch.id}.targetNodeIds`,
                        message: `Branch "${branch.id}" of node "${node.id}" points to non-existent node "${target}"`,
                    })
                }
            }
        }
    }
    return errors
}

function checkComponentWhitelist(nodes: readonly InteractiveFlowNode[]): InteractiveFlowValidationError[] {
    const errors: InteractiveFlowValidationError[] = []
    for (const node of nodes) {
        if (node.nodeType !== InteractiveFlowNodeType.USER_INPUT && node.nodeType !== InteractiveFlowNodeType.CONFIRM) continue
        if (isNil(node.render)) continue
        if (!KNOWN_COMPONENT_IDS.has(node.render.component)) {
            errors.push({
                code: 'UNKNOWN_COMPONENT',
                path: `nodes.${node.id}.render.component`,
                message: `Node "${node.id}" uses unknown component "${node.render.component}"`,
            })
        }
    }
    return errors
}

function checkCycles(nodes: readonly InteractiveFlowNode[]): InteractiveFlowValidationError[] {
    // Build a dependency graph: edge from A → B if A writes something that B reads
    const outputsByNode = new Map<string, Set<string>>()
    const inputsByNode = new Map<string, Set<string>>()
    for (const node of nodes) {
        outputsByNode.set(node.id, new Set(node.stateOutputs))
        inputsByNode.set(node.id, new Set(node.stateInputs))
    }
    const adjacency = new Map<string, Set<string>>()
    for (const node of nodes) {
        adjacency.set(node.id, new Set())
    }
    for (const a of nodes) {
        for (const b of nodes) {
            if (a.id === b.id) continue
            const aOut = outputsByNode.get(a.id) ?? new Set<string>()
            const bIn = inputsByNode.get(b.id) ?? new Set<string>()
            for (const f of aOut) {
                if (bIn.has(f)) {
                    const neighbors = adjacency.get(a.id)
                    if (neighbors) {
                        neighbors.add(b.id)
                    }
                    break
                }
            }
        }
    }

    const WHITE = 0
    const GRAY = 1
    const BLACK = 2
    const color = new Map<string, number>()
    for (const node of nodes) color.set(node.id, WHITE)
    const cyclicNodes = new Set<string>()

    const visit = (nodeId: string): void => {
        color.set(nodeId, GRAY)
        for (const next of adjacency.get(nodeId) ?? []) {
            const c = color.get(next) ?? WHITE
            if (c === GRAY) {
                cyclicNodes.add(nodeId)
                cyclicNodes.add(next)
            }
            else if (c === WHITE) {
                visit(next)
            }
        }
        color.set(nodeId, BLACK)
    }
    for (const node of nodes) {
        if ((color.get(node.id) ?? WHITE) === WHITE) {
            visit(node.id)
        }
    }

    if (cyclicNodes.size === 0) return []
    return [{
        code: 'CYCLE',
        path: 'nodes',
        message: `Cycle detected in dependency graph among nodes: ${Array.from(cyclicNodes).sort().join(', ')}`,
    }]
}

function checkPostgresRequired(
    dbType: string | undefined,
): InteractiveFlowValidationError[] {
    if (isNil(dbType)) return []
    if (COMMAND_LAYER_SUPPORTED_DB_TYPES.has(dbType)) return []
    return [{
        code: 'INTERACTIVE_FLOW_REQUIRES_POSTGRES',
        message: 'validation.interactiveFlow.requiresPostgres',
    }]
}

export type InteractiveFlowValidationError = {
    code: 'INVALID_SCHEMA' | 'DUPLICATE_OUTPUT' | 'ORPHAN_INPUT' | 'UNREACHABLE_OUTPUT' | 'CYCLE' | 'UNKNOWN_BRANCH_TARGET' | 'UNKNOWN_COMPONENT' | 'MISSING_STATE_FIELD' | 'DUPLICATE_NODE_ID' | 'DUPLICATE_STATE_FIELD' | 'INTERACTIVE_FLOW_REQUIRES_POSTGRES'
    path?: string
    message: string
}

export type InteractiveFlowValidationResult = {
    valid: boolean
    errors: InteractiveFlowValidationError[]
}

export type InteractiveFlowValidationOptions = {
    dbType?: string
}
