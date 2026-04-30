import { test, expect } from '../../../fixtures';
import { javaProviderClient } from '../../../helpers/java-provider-client';

test.describe('Agentic E07 — cost + audit emission', () => {
  test('successful tool invoke increments audit + cost counters via diag snapshot', async ({
    request,
  }) => {
    test.setTimeout(45_000);

    const javaUp = await javaProviderClient.health(request);
    test.skip(!javaUp, 'Java provider not running on :8090');

    const diagBefore = await javaProviderClient.diagSnapshot(request);
    if (!diagBefore.ok) {
      test.skip(true, 'Java listener has no /diag/snapshot — start with diagnostics() builder option');
    }

    const beforeAudit = readCounter(diagBefore.body, 'auditToolCallCount');
    const beforeCost = readCounter(diagBefore.body, 'costToolCount');

    const idem = 'e2e-cost-audit-' + Date.now();
    const res = await javaProviderClient.invokeTool(request, {
      mcpGatewayId: 'g-1',
      toolRef: 'banking-customers/search_customer',
      version: '1.0',
      payload: { customerId: 'C-1' },
      idempotencyKey: idem,
      effect: 'READ',
    });

    expect(res.status).toBe(200);
    const body = res.body as { outcome: string; latencyMs: number };
    expect(body.outcome).toMatch(/SUCCESS|IDEMPOTENT_REPLAY/);
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);

    const diagAfter = await javaProviderClient.diagSnapshot(request);
    expect(diagAfter.ok).toBe(true);

    const afterAudit = readCounter(diagAfter.body, 'auditToolCallCount');
    const afterCost = readCounter(diagAfter.body, 'costToolCount');
    expect(afterAudit).toBeGreaterThan(beforeAudit);
    expect(afterCost).toBeGreaterThan(beforeCost);
  });
});

function readCounter(body: Record<string, unknown> | null, key: string): number {
  if (!body) return 0;
  const v = body[key];
  if (typeof v === 'number') return v;
  return 0;
}
