#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */
/**
 * ap-import-flow — crea un flow Activepieces da un JSON `Template`
 * in un colpo solo, usando l'operazione nativa `IMPORT_FLOW`.
 *
 * Uso:
 *   npx tsx scripts/ap-import-flow.ts \
 *     --template fixtures/flow-templates/estinzione.json \
 *     --name "Estinzione CLI test" \
 *     --publish
 *
 * Il JSON usa il formato `Template` di AP
 * (packages/shared/src/lib/management/template/template.ts):
 *
 *   { name, description, type: "FLOW",
 *     flows: [{ displayName, schemaVersion, trigger: { ..., nextAction: {...} } }] }
 *
 * Alcuni campi del template possono avere placeholder che lo script
 * risolve a runtime (così il file JSON resta portable):
 *
 *   - `__AUTO_MCP_GATEWAY__`  →  id dell'MCP gateway (lookup per nome
 *                                via `--mcp-gateway <name>`, oppure il
 *                                primo disponibile).
 *   - `__AUTO_PIECE_VERSION__` →  versione piece risolta via
 *                                `/v1/pieces/:name`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type Args = {
  template: string;
  name?: string;
  publish: boolean;
  mcpGateway?: string;
  provider: string;
  api: string;
  email: string;
  password: string;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    template: '',
    publish: false,
    provider: 'custom',
    api: process.env.AP_API_URL ?? 'http://localhost:4200/api',
    email: process.env.E2E_EMAIL ?? 'dev@ap.com',
    password: process.env.E2E_PASSWORD ?? '12345678',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--template':
      case '-t':
        out.template = next();
        break;
      case '--name':
      case '-n':
        out.name = next();
        break;
      case '--publish':
      case '-p':
        out.publish = true;
        break;
      case '--mcp-gateway':
        out.mcpGateway = next();
        break;
      case '--provider':
        out.provider = next();
        break;
      case '--api':
        out.api = next();
        break;
      case '--email':
        out.email = next();
        break;
      case '--password':
        out.password = next();
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out;
}

function usage(): string {
  return `Usage:
  npx tsx scripts/ap-import-flow.ts --template <path> [options]

Options:
  -t, --template <path>    Flow template JSON (required)
  -n, --name <string>      Override displayName
  -p, --publish            Lock & publish after import (default: draft)
      --mcp-gateway <name> Resolve __AUTO_MCP_GATEWAY__ against this gateway
      --provider <name>    AI provider value (default: "custom")
      --api <url>          AP API base URL (default: http://localhost:4200/api)
      --email <email>      Sign-in email (default: $E2E_EMAIL or dev@ap.com)
      --password <pw>      Sign-in password (default: $E2E_PASSWORD)
  -h, --help               Show this help
`;
}

type SignInResponse = { token: string; projectId: string };
type McpGateway = { id: string; name: string };
type FlowResponse = { id: string; version?: { id: string } };
type PieceSummary = { name: string; version: string };

async function httpJson<T>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}\n${text}`);
  }
  return text.length === 0 ? (undefined as T) : (JSON.parse(text) as T);
}

async function signIn(args: Args): Promise<SignInResponse> {
  return httpJson<SignInResponse>(`${args.api}/v1/authentication/sign-in`, {
    method: 'POST',
    body: { email: args.email, password: args.password },
  });
}

async function resolveMcpGatewayId(
  args: Args,
  token: string,
  gatewayName?: string,
): Promise<string> {
  const gateways = await httpJson<McpGateway[]>(`${args.api}/v1/mcp-gateways`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!Array.isArray(gateways) || gateways.length === 0) {
    throw new Error('No MCP gateways configured. Create one first.');
  }
  if (gatewayName) {
    const match = gateways.find((g) => g.name === gatewayName);
    if (!match) {
      throw new Error(
        `MCP gateway named "${gatewayName}" not found. Available: ${gateways
          .map((g) => g.name)
          .join(', ')}`,
      );
    }
    return match.id;
  }
  return gateways[0].id;
}

async function resolvePieceVersion(
  args: Args,
  token: string,
  pieceName: string,
): Promise<string> {
  const piece = await httpJson<PieceSummary>(
    `${args.api}/v1/pieces/${encodeURIComponent(pieceName)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return piece.version;
}

type TemplateDoc = {
  name: string;
  description?: string;
  type?: string;
  flows: Array<{
    displayName: string;
    schemaVersion?: string;
    trigger: Record<string, unknown>;
    notes?: unknown[];
  }>;
};

function substitutePlaceholders(
  node: unknown,
  replacements: Record<string, string>,
): unknown {
  if (typeof node === 'string') {
    return replacements[node] ?? node;
  }
  if (Array.isArray(node)) {
    return node.map((x) => substitutePlaceholders(x, replacements));
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = substitutePlaceholders(v, replacements);
    }
    return out;
  }
  return node;
}

function injectLastUpdatedDate(
  node: Record<string, unknown>,
  now: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node };
  if (
    'type' in out &&
    'name' in out &&
    'displayName' in out &&
    !('lastUpdatedDate' in out)
  ) {
    out.lastUpdatedDate = now;
  }
  if (out.nextAction && typeof out.nextAction === 'object') {
    out.nextAction = injectLastUpdatedDate(
      out.nextAction as Record<string, unknown>,
      now,
    );
  }
  if (Array.isArray(out.children)) {
    out.children = (out.children as unknown[]).map((c) =>
      c && typeof c === 'object'
        ? injectLastUpdatedDate(c as Record<string, unknown>, now)
        : c,
    );
  }
  if (
    out.firstLoopAction &&
    typeof out.firstLoopAction === 'object'
  ) {
    out.firstLoopAction = injectLastUpdatedDate(
      out.firstLoopAction as Record<string, unknown>,
      now,
    );
  }
  return out;
}

function extractPieceName(trigger: Record<string, unknown>): string | undefined {
  const settings = trigger.settings as Record<string, unknown> | undefined;
  const name = settings?.pieceName;
  return typeof name === 'string' ? name : undefined;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.template) {
    console.log(usage());
    if (args.help) return;
    process.exit(2);
  }

  const templatePath = path.resolve(args.template);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  const template = JSON.parse(
    fs.readFileSync(templatePath, 'utf8'),
  ) as TemplateDoc;
  if (!template.flows?.[0]?.trigger) {
    throw new Error('Invalid template: expected `flows[0].trigger`');
  }

  console.log(`[ap-import-flow] template: ${templatePath}`);
  console.log(`[ap-import-flow] api:      ${args.api}`);

  const { token, projectId } = await signIn(args);
  console.log(`[ap-import-flow] signed in, projectId=${projectId}`);

  // Resolve placeholders
  const replacements: Record<string, string> = {};
  const rawJson = JSON.stringify(template);
  if (rawJson.includes('__AUTO_MCP_GATEWAY__')) {
    const id = await resolveMcpGatewayId(args, token, args.mcpGateway);
    replacements['__AUTO_MCP_GATEWAY__'] = id;
    console.log(`[ap-import-flow] mcpGatewayId: ${id}`);
  }
  if (rawJson.includes('__AUTO_PIECE_VERSION__')) {
    const pieceName = extractPieceName(template.flows[0].trigger);
    if (!pieceName) {
      throw new Error(
        'Template uses __AUTO_PIECE_VERSION__ but trigger.settings.pieceName is not set',
      );
    }
    const version = await resolvePieceVersion(args, token, pieceName);
    replacements['__AUTO_PIECE_VERSION__'] = version;
    console.log(`[ap-import-flow] ${pieceName} version: ${version}`);
  }
  const resolvedTemplate = substitutePlaceholders(
    template,
    replacements,
  ) as TemplateDoc;

  const flowTemplate = resolvedTemplate.flows[0];
  const displayName = args.name ?? flowTemplate.displayName;

  // 1) Create empty flow
  const created = await httpJson<FlowResponse>(`${args.api}/v1/flows`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { displayName, projectId },
  });
  console.log(`[ap-import-flow] created flow ${created.id}`);

  // 2) Import the full graph in one shot (FlowOperationType.IMPORT_FLOW).
  // AP's Zod schema requires `lastUpdatedDate` on trigger + every
  // action. We inject `now` so the fixture can omit it.
  const now = new Date().toISOString();
  const triggerWithDates = injectLastUpdatedDate(
    flowTemplate.trigger as Record<string, unknown>,
    now,
  );
  await httpJson(`${args.api}/v1/flows/${created.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      type: 'IMPORT_FLOW',
      request: {
        displayName,
        trigger: triggerWithDates,
        schemaVersion: flowTemplate.schemaVersion ?? '20',
        notes: flowTemplate.notes ?? null,
      },
    },
  });
  console.log(`[ap-import-flow] imported graph`);

  // 3) Optionally publish
  if (args.publish) {
    await httpJson(`${args.api}/v1/flows/${created.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { type: 'LOCK_AND_PUBLISH', request: {} },
    });
    console.log(`[ap-import-flow] published`);
  }

  const webhookBase = `${args.api}/v1/webhooks/${created.id}`;
  console.log('');
  console.log(JSON.stringify({
    flowId: created.id,
    displayName,
    published: args.publish,
    webhookUrl: webhookBase,
    webhookSyncUrl: `${webhookBase}/sync`,
    resumeUrl: `${args.api}/v1/flow-runs/<runId>/requests/interactive_flow`,
  }, null, 2));
}

run().catch((err) => {
  console.error('[ap-import-flow] FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
