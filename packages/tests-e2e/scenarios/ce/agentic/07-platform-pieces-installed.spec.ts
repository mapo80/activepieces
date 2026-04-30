import { test, expect } from '../../../fixtures';

test.describe('Agentic E07 — platform pieces installed', () => {
  test('@platform/chat, @platform/workflow, @platform/tool-gateway resolvable', async ({
    request,
  }) => {
    test.setTimeout(30_000);

    const piecesRes = await request.get('/api/v1/pieces');
    expect(piecesRes.status()).toBe(200);
    const pieces = (await piecesRes.json()) as Array<{ displayName: string }>;

    const names = pieces.map((p) => p.displayName);
    expect(names).toEqual(
      expect.arrayContaining([
        '@platform/chat',
        '@platform/workflow',
        '@platform/tool-gateway',
      ]),
    );
  });
});
