import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/index', () => ({
  platformToolGatewayAuth: { type: 'NONE' },
}));

import { toolCallAction } from '../src/lib/actions/tool-call';

describe('@platform/tool-gateway · tool-call action', () => {
  it('emits a deterministic invocation envelope shaped for the Java provider', async () => {
    const result = await toolCallAction.run({
      auth: undefined,
      propsValue: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-customers/search_customer',
        version: '1.0',
        payload: { customerId: 'C-1' },
        idempotencyKeyPrefix: 'step:s1',
        effect: 'READ',
      },
    } as Parameters<typeof toolCallAction.run>[0]);

    expect(result.action).toBe('tool.call');
    expect(result.mcpGatewayId).toBe('g-1');
    expect(result.toolRef).toBe('banking-customers/search_customer');
    expect(result.version).toBe('1.0');
    expect(result.payload).toEqual({ customerId: 'C-1' });
    expect(result.idempotencyKeyPrefix).toBe('step:s1');
    expect(result.effect).toBe('READ');
    expect(typeof result.issuedAt).toBe('string');
  });

  it('defaults version to "1.0" and idempotencyKeyPrefix to null when omitted', async () => {
    const result = await toolCallAction.run({
      auth: undefined,
      propsValue: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking/x',
        payload: {},
        effect: 'PURE',
      },
    } as Parameters<typeof toolCallAction.run>[0]);

    expect(result.version).toBe('1.0');
    expect(result.idempotencyKeyPrefix).toBeNull();
  });
});
