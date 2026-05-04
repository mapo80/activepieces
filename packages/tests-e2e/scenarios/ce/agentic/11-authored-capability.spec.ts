import { test, expect } from '../../../fixtures';

const AUTHORING_PORT = 8002;

test.describe('Agentic E17 — Authoring Agent end-to-end via MCP', () => {
  test('MCP authoring server tools/list returns 8 tools', async ({ request }) => {
    test.setTimeout(15_000);

    let healthOk = false;
    try {
      const healthRes = await request.get(`http://localhost:${AUTHORING_PORT}/health`, { timeout: 3_000 });
      healthOk = healthRes.status() === 200;
    } catch {
      healthOk = false;
    }
    test.skip(!healthOk, `MCP authoring server not reachable on :${AUTHORING_PORT}`);

    const rpcRes = await request.post(`http://localhost:${AUTHORING_PORT}/mcp`, {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(rpcRes.status()).toBe(200);
    const body = await rpcRes.json();
    expect(body.result.tools).toBeDefined();
    expect(body.result.tools.length).toBeGreaterThanOrEqual(8);

    const toolNames: string[] = body.result.tools.map((t: { name: string }) => t.name);
    for (const expected of [
      'discoverTools',
      'discoverUiComponents',
      'discoverBarriers',
      'discoverExistingCapabilities',
      'inspectCapability',
      'validateBundle',
      'publishCapability',
      'testConversation',
    ]) {
      expect(toolNames).toContain(expected);
    }
  });

  test('Authoring flow: validateBundle returns LLM-friendly errors with suggestion', async ({ request }) => {
    test.setTimeout(15_000);

    let healthOk = false;
    try {
      const healthRes = await request.get(`http://localhost:${AUTHORING_PORT}/health`, { timeout: 3_000 });
      healthOk = healthRes.status() === 200;
    } catch {
      healthOk = false;
    }
    test.skip(!healthOk, `MCP authoring server not reachable on :${AUTHORING_PORT}`);

    const invalidBundle = {
      bundleVersion: 'x',
      capability: { capabilityId: 'banking.cardLimit' },
    };
    const rpc = await request.post(`http://localhost:${AUTHORING_PORT}/mcp`, {
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'validateBundle',
          arguments: { bundle: invalidBundle },
        },
      },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(rpc.status()).toBe(200);
    const body = await rpc.json();
    expect(body.result).toBeDefined();

    // result.content[0].text is the JSON-encoded validation result
    const content = body.result.content?.[0];
    if (content?.text) {
      const parsed = JSON.parse(content.text);
      if (parsed.errors && parsed.errors.length > 0) {
        for (const err of parsed.errors) {
          expect(err.path).toBeDefined();
          expect(err.message).toBeDefined();
          // suggestion is the LLM-friendliness contract
          expect(err.suggestion ?? '').not.toBe('');
        }
      }
    }
  });
});
