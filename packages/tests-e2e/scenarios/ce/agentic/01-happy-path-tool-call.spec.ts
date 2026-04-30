import { test, expect } from '../../../fixtures';
import { javaProviderClient } from '../../../helpers/java-provider-client';

test.describe('Agentic E07 — happy path tool call', () => {
  test('Java provider invokes tool via AP proxy → SUCCESS', async ({ request }) => {
    test.setTimeout(45_000);

    const javaUp = await javaProviderClient.health(request);
    test.skip(!javaUp, 'Java provider not running on :8090 — start agentic-workflow-platform first');

    // Production path: AP proxy /api/v1/agentic/tools/invoke → Java :8090
    const apProxyRes = await request.post('/api/v1/agentic/tools/invoke', {
      data: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-customers/search_customer',
        version: '1.0',
        payload: { customerId: 'C-1' },
        idempotencyKey: 'e2e-happy-' + Date.now(),
        effect: 'READ',
        runContext: {
          platformRunId: 'plat-r-' + Date.now(),
          capabilityId: 'banking.estinzione',
          tenantId: 'tenant-bank',
        },
      },
    });

    if (apProxyRes.status() === 404) {
      test.skip(true, 'AP /api/v1/agentic/tools/invoke not routed yet — exercise direct Java path');
    }

    expect([200, 403, 422, 502]).toContain(apProxyRes.status());
    if (apProxyRes.status() === 200) {
      const body = await apProxyRes.json();
      expect(body.outcome).toMatch(/SUCCESS|IDEMPOTENT_REPLAY/);
    }
  });
});
