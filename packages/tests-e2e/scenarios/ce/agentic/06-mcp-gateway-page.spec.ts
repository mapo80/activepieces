import { test, expect } from '../../../fixtures';

test.describe('Agentic E07 — MCP Gateway backend wiring', () => {
  test('GET /api/v1/mcp-gateways returns 200 with array body for platform admin', async ({
    request,
  }) => {
    test.setTimeout(30_000);

    const signInRes = await request.post('/api/v1/authentication/sign-in', {
      data: {
        email: process.env.E2E_EMAIL ?? 'dev@ap.com',
        password: process.env.E2E_PASSWORD ?? '12345678',
      },
    });
    expect(signInRes.status()).toBe(200);
    const { token } = (await signInRes.json()) as { token: string };
    expect(token).toBeTruthy();

    const listRes = await request.get('/api/v1/mcp-gateways', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status()).toBe(200);
    const body = await listRes.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
