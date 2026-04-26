/**
 * Shared helpers for command-layer browser/API Playwright specs.
 *
 * All specs that exercise the consultazione flow (useCommandLayer:true)
 * share these functions. The pattern mirrors estinzione-chat.local.spec.ts.
 */
import * as fs from 'fs'
import * as path from 'path'
import { APIRequestContext, Browser, Page } from '@playwright/test'

export const AP_API = process.env.AP_API_URL ?? 'http://localhost:3000/api'
export const CHAT_BASE_URL = process.env.CHAT_BASE_URL ?? 'http://localhost:4200'
export const CONSULTAZIONE_FIXTURE_PATH = path.resolve(
    __dirname,
    '../../../fixtures/flow-templates/consultazione-cliente.json',
)
export const ESTINZIONE_FIXTURE_PATH = path.resolve(
    __dirname,
    '../../../fixtures/flow-templates/estinzione.json',
)
const MCP_GATEWAY_NAME = 'Agentic Engine Banking (local)'

// ─── auth ───────────────────────────────────────────────────────────────────

export async function signIn(request: APIRequestContext): Promise<{ token: string; projectId: string }> {
    const email = process.env.E2E_EMAIL ?? 'dev@ap.com'
    const password = process.env.E2E_PASSWORD ?? '12345678'
    const res = await request.post(`${AP_API}/v1/authentication/sign-in`, {
        headers: { 'content-type': 'application/json' },
        data: { email, password },
    })
    if (res.status() !== 200) throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`)
    return res.json() as Promise<{ token: string; projectId: string }>
}

// ─── MCP gateway ──────────────────────────────────────────────────────────

export async function ensureMcpGateway(
    request: APIRequestContext,
    token: string,
    overrideUrl?: string,
): Promise<string> {
    const url = overrideUrl ?? 'http://localhost:8000/mcp'
    const name = overrideUrl ? `Mock MCP (${url})` : MCP_GATEWAY_NAME
    const listRes = await request.get(`${AP_API}/v1/mcp-gateways`, { headers: { Authorization: `Bearer ${token}` } })
    const body = (await listRes.json()) as McpGateway[] | { data?: McpGateway[] }
    const rows = Array.isArray(body) ? body : (body.data ?? [])
    const existing = rows.find((g) => g.url === url)
    if (existing) return existing.id
    const create = await request.post(`${AP_API}/v1/mcp-gateways`, {
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        data: { name, url, auth: { type: 'NONE' } },
    })
    const created = (await create.json()) as { id: string }
    return created.id
}

// ─── flow import / publish ──────────────────────────────────────────────────

export async function getPieceVersion(
    request: APIRequestContext,
    token: string,
    pieceName: string,
): Promise<string> {
    const res = await request.get(`${AP_API}/v1/pieces/${encodeURIComponent(pieceName)}`, {
        headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as { version: string }
    return body.version
}

export async function importAndPublishFlow(
    request: APIRequestContext,
    token: string,
    projectId: string,
    fixturePath: string,
    flowName: string,
    extra?: { useMockMcpPort?: number },
): Promise<string> {
    const gatewayUrl = extra?.useMockMcpPort
        ? `http://localhost:${extra.useMockMcpPort}/mcp`
        : undefined
    const gatewayId = await ensureMcpGateway(request, token, gatewayUrl)
    const pieceVersion = await getPieceVersion(request, token, '@activepieces/piece-forms')

    const template = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as TemplateDoc
    const resolved = resolvePlaceholders(template, {
        __AUTO_MCP_GATEWAY__: gatewayId,
        __AUTO_PIECE_VERSION__: pieceVersion,
    })
    const flowTpl = resolved.flows[0]

    const createRes = await request.post(`${AP_API}/v1/flows`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { displayName: flowName, projectId },
    })
    const { id: flowId } = (await createRes.json()) as { id: string }

    const now = new Date().toISOString()
    const triggerWithDates = injectLastUpdatedDate(flowTpl.trigger as Record<string, unknown>, now)
    await request.post(`${AP_API}/v1/flows/${flowId}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
            type: 'IMPORT_FLOW',
            request: {
                displayName: flowName,
                trigger: triggerWithDates,
                schemaVersion: flowTpl.schemaVersion ?? '20',
                notes: null,
            },
        },
    })
    await request.post(`${AP_API}/v1/flows/${flowId}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { type: 'LOCK_AND_PUBLISH', request: {} },
    })
    return flowId
}

export async function deleteFlow(request: APIRequestContext, token: string, flowId: string): Promise<void> {
    await request.delete(`${AP_API}/v1/flows/${flowId}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined)
}

// ─── browser chat helpers ────────────────────────────────────────────────────

export async function openChatPage(browser: Browser, flowId: string): Promise<Page> {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${CHAT_BASE_URL}/chats/${flowId}`)
    await page.waitForLoadState('networkidle', { timeout: 30_000 })
    return page
}

export async function sendChatMessage(page: Page, text: string): Promise<void> {
    const ta = page.locator('textarea[placeholder="Type your message here..."]')
    await ta.waitFor({ state: 'visible', timeout: 30_000 })
    await ta.click()
    await ta.fill(text)
    await ta.press('Enter')
}

/**
 * Wait until the bot has produced `expectedCount` non-empty bubbles and
 * return the text of the last one.
 */
export async function waitForBotBubble(
    page: Page,
    expectedCount: number,
    timeoutMs = 120_000,
): Promise<string> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const bubbles = await page
            .locator('div.self-start')
            .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.trim()))
        const nonEmpty = bubbles.filter((t) => t.length > 0)
        if (nonEmpty.length >= expectedCount) return nonEmpty[expectedCount - 1]
        await new Promise((r) => setTimeout(r, 1_500))
    }
    throw new Error(`timed out waiting for bot bubble #${expectedCount} (${timeoutMs}ms)`)
}

// ─── internal helpers ────────────────────────────────────────────────────────

function resolvePlaceholders<T>(node: T, reps: Record<string, string>): T {
    if (typeof node === 'string') return (reps[node] ?? node) as unknown as T
    if (Array.isArray(node)) return node.map((x) => resolvePlaceholders(x, reps)) as unknown as T
    if (node && typeof node === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = resolvePlaceholders(v, reps)
        return out as unknown as T
    }
    return node
}

function injectLastUpdatedDate(node: Record<string, unknown>, now: string): Record<string, unknown> {
    const out: Record<string, unknown> = { ...node }
    if ('type' in out && 'name' in out && 'displayName' in out && !('lastUpdatedDate' in out)) out.lastUpdatedDate = now
    if (out.nextAction && typeof out.nextAction === 'object')
        out.nextAction = injectLastUpdatedDate(out.nextAction as Record<string, unknown>, now)
    return out
}

type McpGateway = { id: string; name: string; url: string }
type TemplateDoc = {
    flows: Array<{ displayName: string; schemaVersion?: string; trigger: Record<string, unknown> }>
}
