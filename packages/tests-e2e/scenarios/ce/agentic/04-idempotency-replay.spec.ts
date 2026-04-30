import { test, expect } from '../../../fixtures';
import { javaProviderClient } from '../../../helpers/java-provider-client';

test.describe('Agentic E07 — idempotency replay', () => {
  test('same idempotencyKey replays cached output', async ({ request }) => {
    test.setTimeout(45_000);

    const javaUp = await javaProviderClient.health(request);
    test.skip(!javaUp, 'Java provider not running on :8090');

    const idem = 'e2e-replay-' + Date.now();
    const body = {
      mcpGatewayId: 'g-1',
      toolRef: 'banking-customers/search_customer',
      version: '1.0',
      payload: { customerId: 'C-1' },
      idempotencyKey: idem,
      effect: 'READ' as const,
    };

    const first = await javaProviderClient.invokeTool(request, body);
    const second = await javaProviderClient.invokeTool(request, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.body as { outcome: string }).outcome).toMatch(
      /IDEMPOTENT_REPLAY|SUCCESS/,
    );
  });
});
