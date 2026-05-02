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
    expect(result.customerId).toBe('C-1');
    expect(result.items).toHaveLength(1);
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
    expect(result.result).toBe('ok');
  });

  it('returns deterministic account-closure submit evidence for AP-real E2E tests', async () => {
    const result = await toolCallAction.run({
      auth: undefined,
      propsValue: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-operations/submit_closure',
        payload: {
          request: {
            relationshipId: 'R-123',
            closureEffectiveDate: '2026-05-10',
            closureReasonLabel: 'richiesta cliente',
          },
        },
        effect: 'IRREVERSIBLE',
      },
    } as Parameters<typeof toolCallAction.run>[0]);

    expect(result.submissionRef).toBe('ES-2026-0001');
    expect(result.submissionStatus).toBe('INVIATA');
    expect(result.request).toEqual({
      relationshipId: 'R-123',
      closureEffectiveDate: '2026-05-10',
      closureReasonLabel: 'richiesta cliente',
    });
    expect(result.request).not.toHaveProperty('closureReasonCode');
  });

  it('returns deterministic closure reason catalog as spoken labels', async () => {
    const result = await toolCallAction.run({
      auth: undefined,
      propsValue: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-operations/list_closure_reasons',
        payload: {},
        effect: 'READ',
      },
    } as Parameters<typeof toolCallAction.run>[0]);

    expect(result.reasons).toEqual([
      { code: 'REQ_CLIENTE', label: 'richiesta cliente' },
      { code: 'DECESSO', label: 'decesso intestatario' },
      { code: 'TRASFERIMENTO', label: 'trasferimento ad altra banca' },
    ]);
  });
});
