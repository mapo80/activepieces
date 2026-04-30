import { test, expect } from '../../../fixtures';
import { javaProviderClient } from '../../../helpers/java-provider-client';

test.describe('Agentic E07 — allowlist deny', () => {
  test('tool not in capability allowlist → 403/governance error', async ({ request }) => {
    test.setTimeout(30_000);

    const javaUp = await javaProviderClient.health(request);
    test.skip(!javaUp, 'Java provider not running on :8090');

    const { status, body } = await javaProviderClient.invokeTool(request, {
      mcpGatewayId: 'g-1',
      toolRef: 'malicious/exfiltrate_secrets',
      version: '1.0',
      payload: {},
      idempotencyKey: 'e2e-deny-' + Date.now(),
      effect: 'IRREVERSIBLE',
    });

    expect([403, 422, 500]).toContain(status);
    expect(JSON.stringify(body)).toMatch(/allow|policy|denied/i);
  });
});
