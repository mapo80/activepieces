/**
 * Spike script v8.1 — valida il nuovo pipeline extractor sui 14 stress test case
 * usando l'LLM configurato (claude-cli via http://localhost:8787/v1).
 *
 * Invocazione:
 *   AP_API_URL=http://localhost:3000/api \
 *     npx tsx packages/server/api/scripts/spike-v8-extractor.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const AP_API = process.env.AP_API_URL ?? 'http://localhost:3000/api'
const E2E_EMAIL = process.env.E2E_EMAIL ?? 'dev@ap.com'
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? '12345678'

type StressCase = {
    id: number
    name: string
    userMessage: string
    priorState: Record<string, unknown>
    currentNode: {
        nodeId: string
        nodeType?: 'USER_INPUT' | 'CONFIRM' | 'TOOL' | 'BRANCH'
        stateOutputs?: string[]
        displayName?: string
        prompt?: string
        nextMissingField?: string
    }
    pendingInteraction?: unknown
    expect: {
        acceptedFieldsHave?: Record<string, unknown>
        acceptedFieldsNotHave?: string[]
        metaAnswerPresent?: boolean
        turnAffirmed?: boolean
        clarifyReasonPresent?: boolean
    }
}

const CLOSURE_REASONS = [
    { codice: '01', descr: "Trasferimento all'estero" },
    { codice: '02', descr: 'Trasloco' },
    { codice: '03', descr: 'Decesso titolare' },
    { codice: '04', descr: 'Insoddisfazione servizio' },
    { codice: '05', descr: 'Altre motivazioni' },
]

const STRESS_CASES: StressCase[] = [
    {
        id: 1,
        name: 'empty greeting "ciao" → no extraction',
        userMessage: 'ciao',
        priorState: {},
        currentNode: { nodeId: 'pick_ndg', nodeType: 'USER_INPUT', stateOutputs: ['ndg'] },
        expect: { acceptedFieldsNotHave: ['customerName', 'ndg', 'closureReasonCode'] },
    },
    {
        id: 2,
        name: 'first-turn customer extraction',
        userMessage: 'voglio chiudere il rapporto di bellafronte',
        priorState: {},
        currentNode: { nodeId: 'search_customer', nodeType: 'TOOL', stateOutputs: ['customerMatches'] },
        expect: { acceptedFieldsHave: { customerName: 'bellafronte' } },
    },
    {
        id: 3,
        name: '"puoi procedere" must NOT overwrite customerName',
        userMessage: 'puoi procedere',
        priorState: { customerName: 'Bellafronte', customerMatches: [{ ndg: '11255521' }] },
        currentNode: { nodeId: 'pick_ndg', nodeType: 'USER_INPUT', stateOutputs: ['ndg'] },
        expect: { acceptedFieldsNotHave: ['customerName'] },
    },
    {
        id: 4,
        name: 'plain NDG pre-parser',
        userMessage: '11255521',
        priorState: { customerName: 'Bellafronte', customerMatches: [{}] },
        currentNode: { nodeId: 'pick_ndg', nodeType: 'USER_INPUT', stateOutputs: ['ndg'] },
        expect: { acceptedFieldsHave: { ndg: '11255521' } },
    },
    {
        id: 5,
        name: '"dammi l\'elenco dei rapporti" state preserved',
        userMessage: "dammi l'elenco dei rapporti",
        priorState: { customerName: 'Bellafronte', ndg: '11255521', accounts: [{}] },
        currentNode: { nodeId: 'pick_rapporto', nodeType: 'USER_INPUT', stateOutputs: ['rapportoId'] },
        expect: { acceptedFieldsNotHave: ['customerName'] },
    },
    {
        id: 6,
        name: '"il 20 aprile 2026" → closureDate, NO closureReasonCode="20"',
        userMessage: 'voglio estinguere il conto di bellafronte il 20 aprile 2026',
        priorState: {},
        currentNode: { nodeId: 'search_customer', nodeType: 'TOOL', stateOutputs: ['customerMatches'] },
        expect: {
            acceptedFieldsHave: { customerName: 'bellafronte', closureDate: '2026-04-20' },
            acceptedFieldsNotHave: ['closureReasonCode'],
        },
    },
    {
        id: 7,
        name: '"scusa, cercavo Rossi" topic-change accept',
        userMessage: 'scusa, cercavo Rossi',
        priorState: { customerName: 'Bellafronte', customerMatches: [{}] },
        currentNode: {
            nodeId: 'pick_ndg',
            nodeType: 'USER_INPUT',
            stateOutputs: ['ndg'],
        },
        expect: { acceptedFieldsHave: { customerName: 'Rossi' } },
    },
    {
        id: 8,
        name: '"motivazione 01 trasferimento, data 2026-04-15"',
        userMessage: 'motivazione 01 trasferimento estero, data 2026-04-15',
        priorState: { closureReasons: CLOSURE_REASONS },
        currentNode: {
            nodeId: 'collect_reason',
            nodeType: 'USER_INPUT',
            stateOutputs: ['closureReasonCode', 'closureDate'],
        },
        expect: { acceptedFieldsHave: { closureReasonCode: '01', closureDate: '2026-04-15' } },
    },
    {
        id: 9,
        name: '"no capisco, ripeti" → meta-question → no extraction',
        userMessage: 'no capisco, ripeti',
        priorState: { customerName: 'Bellafronte' },
        currentNode: {
            nodeId: 'pick_ndg',
            nodeType: 'USER_INPUT',
            stateOutputs: ['ndg'],
            displayName: 'Seleziona NDG',
            prompt: 'Qual è il NDG del cliente?',
        },
        expect: { metaAnswerPresent: true, acceptedFieldsNotHave: ['customerName', 'ndg'] },
    },
    {
        id: 10,
        name: '"in effetti era Rossi" implicit correction',
        userMessage: 'in effetti era Rossi',
        priorState: { customerName: 'Bellafronte', customerMatches: [{}] },
        currentNode: { nodeId: 'pick_ndg', nodeType: 'USER_INPUT', stateOutputs: ['ndg'] },
        expect: { acceptedFieldsHave: { customerName: 'Rossi' } },
    },
    {
        id: 11,
        name: 'D2: "cosa mi avevi chiesto?" meta-question',
        userMessage: 'cosa mi avevi chiesto?',
        priorState: { customerName: 'Bellafronte' },
        currentNode: {
            nodeId: 'pick_ndg',
            nodeType: 'USER_INPUT',
            stateOutputs: ['ndg'],
            displayName: 'Seleziona NDG',
            prompt: 'Qual è il NDG del cliente?',
        },
        expect: { metaAnswerPresent: true, acceptedFieldsNotHave: ['customerName', 'ndg'] },
    },
    {
        id: 12,
        name: 'pendingInteraction pick_from_list "il secondo"',
        userMessage: 'il secondo',
        priorState: { customerName: 'Rossi' },
        currentNode: { nodeId: 'pick_ndg', nodeType: 'USER_INPUT', stateOutputs: ['ndg'] },
        pendingInteraction: {
            type: 'pick_from_list',
            field: 'ndg',
            nodeId: 'pick_ndg',
            options: [
                { ordinal: 1, label: 'ROSSI A', value: '111111' },
                { ordinal: 2, label: 'ROSSI B', value: '222222' },
                { ordinal: 3, label: 'ROSSI C', value: '333333' },
            ],
        },
        expect: { acceptedFieldsHave: { ndg: '222222' } },
    },
    {
        id: 13,
        name: 'F: multi-field correction "no aspetta, cliente Bellafronte rapporto 01-034-00392400"',
        userMessage: 'no aspetta, il cliente era Bellafronte e il rapporto 01-034-00392400',
        priorState: { customerName: 'Rossi', ndg: '22334455' },
        currentNode: {
            nodeId: 'pick_rapporto',
            nodeType: 'USER_INPUT',
            stateOutputs: ['rapportoId'],
        },
        expect: { acceptedFieldsHave: { rapportoId: '01-034-00392400' } },
    },
    {
        id: 14,
        name: 'K: implicit negation "non era quello però"',
        userMessage: 'non era quello però',
        priorState: { customerName: 'Bellafronte' },
        currentNode: { nodeId: 'pick_ndg', nodeType: 'USER_INPUT', stateOutputs: ['ndg'] },
        pendingInteraction: {
            type: 'confirm_binary',
            field: 'ndg',
            target: '11255521',
            nodeId: 'pick_ndg',
        },
        expect: { acceptedFieldsNotHave: ['ndg'] },
    },
]

async function signIn(): Promise<{ token: string }> {
    const res = await fetch(`${AP_API}/v1/authentication/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
    })
    if (!res.ok) throw new Error(`sign-in failed: ${res.status}`)
    return res.json() as Promise<{ token: string }>
}

async function getEngineToken({ token }: { token: string }): Promise<string> {
    const res = await fetch(`${AP_API}/v1/flows`, {
        headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`flows list failed: ${res.status}`)
    return token
}

async function getProviderInfo({ token }: { token: string }): Promise<{ provider: string; model: string }> {
    const res = await fetch(`${AP_API}/v1/ai-providers`, {
        headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`ai-providers failed: ${res.status}`)
    const body = await res.json() as { data?: Array<{ provider: string; baseUrl?: string }> }
    const custom = body.data?.find(p => p.provider === 'CUSTOM' || p.provider === 'OPENAI_COMPATIBLE')
    if (!custom) throw new Error('No custom provider registered in AP; register one pointing to claude-cli bridge')
    return { provider: custom.provider, model: 'claude-cli' }
}

async function runCase({ token, testCase, provider, model }: {
    token: string
    testCase: StressCase
    provider: string
    model: string
}): Promise<{ passed: boolean; response?: unknown; reason?: string }> {
    const body = {
        provider,
        model,
        message: testCase.userMessage,
        systemPrompt: 'Sei un assistente bancario per estinzione rapporti. Estrai SOLO campi chiaramente menzionati.',
        locale: 'it',
        currentState: testCase.priorState,
        currentNode: testCase.currentNode,
        pendingInteraction: testCase.pendingInteraction,
        identityFields: ['customerName'],
        flowLabel: 'estinzione rapporto',
        stateFields: loadFixtureStateFields(),
    }
    const res = await fetch(`${AP_API}/v1/engine/interactive-flow-ai/field-extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    })
    const response = await res.json() as {
        acceptedFields?: Record<string, unknown>
        metaAnswer?: string
        turnAffirmed?: boolean
        clarifyReason?: unknown
        policyDecisions?: unknown[]
        candidates?: unknown[]
    }
    if (!res.ok) return { passed: false, response, reason: `http-${res.status}` }

    const reasons: string[] = []
    const accepted = response.acceptedFields ?? {}
    if (testCase.expect.acceptedFieldsHave) {
        for (const [k, v] of Object.entries(testCase.expect.acceptedFieldsHave)) {
            const got = accepted[k]
            if (got === undefined || got === null) {
                reasons.push(`missing accepted.${k} (expected ${JSON.stringify(v)})`)
                continue
            }
            if (typeof v === 'string' && typeof got === 'string') {
                if (v.toLowerCase() !== got.toLowerCase()) {
                    reasons.push(`accepted.${k} = ${JSON.stringify(got)}, expected ${JSON.stringify(v)}`)
                }
            }
            else if (JSON.stringify(got) !== JSON.stringify(v)) {
                reasons.push(`accepted.${k} = ${JSON.stringify(got)}, expected ${JSON.stringify(v)}`)
            }
        }
    }
    if (testCase.expect.acceptedFieldsNotHave) {
        for (const k of testCase.expect.acceptedFieldsNotHave) {
            if (accepted[k] !== undefined && accepted[k] !== null) {
                reasons.push(`accepted.${k} present (${JSON.stringify(accepted[k])}), expected absent`)
            }
        }
    }
    if (testCase.expect.metaAnswerPresent === true && !response.metaAnswer) {
        reasons.push('expected metaAnswer but absent')
    }
    if (testCase.expect.metaAnswerPresent === false && response.metaAnswer) {
        reasons.push('unexpected metaAnswer present')
    }
    if (testCase.expect.clarifyReasonPresent && !response.clarifyReason) {
        reasons.push('expected clarifyReason')
    }
    return { passed: reasons.length === 0, response, reason: reasons.join('; ') }
}

function loadFixtureStateFields(): unknown[] {
    const fixturePath = path.resolve(__dirname, '../../../../fixtures/flow-templates/estinzione.json')
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
    return raw.flows[0].trigger.nextAction.settings.stateFields
}

async function main(): Promise<void> {
    console.log(`spike v8.1 — 14 stress cases against ${AP_API}`)
    const { token } = await signIn()
    await getEngineToken({ token })
    let provider: string
    let model: string
    try {
        const info = await getProviderInfo({ token })
        provider = info.provider
        model = info.model
    }
    catch (e) {
        console.log('fallback provider CUSTOM/claude-cli:', (e as Error).message)
        provider = 'CUSTOM'
        model = 'claude-cli'
    }
    console.log(`provider=${provider} model=${model}\n`)

    const results: Array<{ id: number; name: string; passed: boolean; reason?: string; response?: unknown }> = []
    for (const testCase of STRESS_CASES) {
        process.stdout.write(`#${testCase.id} ${testCase.name}… `)
        const r = await runCase({ token, testCase, provider, model })
        results.push({ id: testCase.id, name: testCase.name, passed: r.passed, reason: r.reason, response: r.response })
        console.log(r.passed ? 'PASS' : `FAIL (${r.reason})`)
    }

    const passed = results.filter(r => r.passed).length
    const total = results.length
    console.log(`\nSummary: ${passed}/${total} PASSED`)

    fs.writeFileSync('/tmp/spike-v8-report.json', JSON.stringify({
        timestamp: new Date().toISOString(),
        passed,
        total,
        results,
    }, null, 2))
    console.log(`Report saved to /tmp/spike-v8-report.json`)

    if (passed < total) process.exit(1)
}

main().catch(e => {
    console.error('spike failed:', e)
    process.exit(1)
})
