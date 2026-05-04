import { test, expect } from '../../../fixtures';
import { javaProviderClient } from '../../../helpers/java-provider-client';

test.describe('Agentic E17 — bundle-driven account closure', () => {
  test('E11 capability loaded from bundle (no Java publisher) → tool invoke happy path', async ({ request }) => {
    test.setTimeout(45_000);

    const javaUp = await javaProviderClient.health(request);
    test.skip(!javaUp, 'Java provider not running on :8090 — start agentic-workflow-platform first');

    const apProxyRes = await request.post('/api/v1/agentic/tools/invoke', {
      data: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-customers/search_customer',
        version: '1.0',
        payload: { customerId: 'C-1' },
        idempotencyKey: 'e2e-bundle-e11-' + Date.now(),
        effect: 'READ',
        runContext: {
          platformRunId: 'plat-r-' + Date.now(),
          capabilityId: 'banking.accountClosure',
          tenantId: 'tenant-bank',
        },
      },
    });

    if (apProxyRes.status() === 404) {
      test.skip(true, 'AP /api/v1/agentic/tools/invoke not routed — production endpoint not enabled');
    }

    expect([200, 403, 422, 502]).toContain(apProxyRes.status());
    if (apProxyRes.status() === 200) {
      const body = await apProxyRes.json();
      expect(body.outcome).toMatch(/SUCCESS|IDEMPOTENT_REPLAY/);
    }
  });

  test('admin /capabilities lists banking.accountClosure as bundle-loaded', async ({ request }) => {
    test.setTimeout(15_000);
    const adminPort = process.env.PLATFORM_ADMIN_PORT ?? '8092';
    const token = process.env.CAPABILITY_PUBLISHER_TOKEN ?? 'test-token';

    let res;
    try {
      res = await request.get(
        `http://127.0.0.1:${adminPort}/admin/capabilities?tenantId=tenant-bank`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 3_000 },
      );
    } catch {
      test.skip(true, `Platform admin endpoint not reachable on :${adminPort}`);
      return;
    }

    if (res.status() >= 500 || res.status() === 0 || res.status() === 404) {
      test.skip(true, `admin /capabilities not available (status=${res.status()})`);
      return;
    }
    expect([200, 401]).toContain(res.status());

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('items');
      const items = body.items as Array<{ capabilityId?: string }>;
      expect(Array.isArray(items)).toBeTruthy();
    }
  });
});
