type ModelPinning = {
    family: string
    version: string
    schemaHash: string
    approved: boolean
    approvedAt?: string
    approvedBy?: string
}

const DEFAULT_PINS: Record<string, ModelPinning> = {
    'claude-opus-4-7': {
        family: 'claude',
        version: 'claude-opus-4-7',
        schemaHash: 'cmd-layer-v3.3-2026-04',
        approved: true,
        approvedAt: '2026-04-25T00:00:00Z',
        approvedBy: 'engineering',
    },
    'claude-sonnet-4-6': {
        family: 'claude',
        version: 'claude-sonnet-4-6',
        schemaHash: 'cmd-layer-v3.3-2026-04',
        approved: true,
        approvedAt: '2026-04-25T00:00:00Z',
        approvedBy: 'engineering',
    },
    'claude-haiku-4-5': {
        family: 'claude',
        version: 'claude-haiku-4-5',
        schemaHash: 'cmd-layer-v3.3-2026-04',
        approved: true,
        approvedAt: '2026-04-25T00:00:00Z',
        approvedBy: 'engineering',
    },
}

const overrides = new Map<string, ModelPinning>()

function isApproved({ modelVersion }: { modelVersion: string }): boolean {
    const pin = overrides.get(modelVersion) ?? DEFAULT_PINS[modelVersion]
    return pin?.approved === true
}

function getPin({ modelVersion }: { modelVersion: string }): ModelPinning | null {
    return overrides.get(modelVersion) ?? DEFAULT_PINS[modelVersion] ?? null
}

function setOverride({ modelVersion, pin }: { modelVersion: string, pin: ModelPinning }): void {
    overrides.set(modelVersion, pin)
}

function clearOverrides(): void {
    overrides.clear()
}

function listApprovedVersions(): string[] {
    const fromDefault = Object.keys(DEFAULT_PINS).filter(k => DEFAULT_PINS[k].approved)
    const fromOverrides = Array.from(overrides.entries()).filter(([, v]) => v.approved).map(([k]) => k)
    return Array.from(new Set([...fromDefault, ...fromOverrides]))
}

export const modelPinning = {
    isApproved,
    getPin,
    setOverride,
    clearOverrides,
    listApprovedVersions,
}

export type { ModelPinning }
