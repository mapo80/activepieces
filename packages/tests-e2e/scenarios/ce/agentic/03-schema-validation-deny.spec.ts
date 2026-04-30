import { test, expect } from '../../../fixtures';
import { javaProviderClient } from '../../../helpers/java-provider-client';

test.describe('Agentic E07 — schema validation deny', () => {
  test('payload violates inputSchema → ToolSchemaInvalidException mapped', async ({ request }) => {
    test.setTimeout(30_000);

    const javaUp = await javaProviderClient.health(request);
    test.skip(!javaUp, 'Java provider not running on :8090');

    const { status, body } = await javaProviderClient.invokeTool(request, {
      mcpGatewayId: 'g-1',
      toolRef: 'banking-customers/search_customer',
      version: '1.0',
      payload: { wrongField: 123 },
      idempotencyKey: 'e2e-schema-' + Date.now(),
      effect: 'READ',
    });

    expect([400, 422, 500]).toContain(status);
    expect(JSON.stringify(body)).toMatch(/schema|invalid|required/i);
  });
});
