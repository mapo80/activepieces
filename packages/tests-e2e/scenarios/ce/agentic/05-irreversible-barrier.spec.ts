import { test, expect } from '../../../fixtures';
import { javaProviderClient } from '../../../helpers/java-provider-client';

test.describe('Agentic E07 — IRREVERSIBLE barrier', () => {
  test('IRREVERSIBLE without PRE_SUBMIT_CONFIRMATION barrier → BarrierNotReached', async ({
    request,
  }) => {
    test.setTimeout(30_000);

    const javaUp = await javaProviderClient.health(request);
    test.skip(!javaUp, 'Java provider not running on :8090');

    const { status, body } = await javaProviderClient.invokeTool(request, {
      mcpGatewayId: 'g-1',
      toolRef: 'banking-operations/submit_closure',
      version: '1.0',
      payload: { customerId: 'C-1', accountId: 'A-1', reason: 'test' },
      idempotencyKey: 'e2e-irreversible-' + Date.now(),
      effect: 'IRREVERSIBLE',
      runContext: { barriersReached: [] },
    });

    expect([400, 403, 409, 500]).toContain(status);
    expect(JSON.stringify(body)).toMatch(/barrier|confirmation/i);
  });
});
