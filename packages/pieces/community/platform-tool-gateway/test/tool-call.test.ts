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

  it('returns deterministic mortgage rate simulation with computed monthly payment and ltv', async () => {
    const result = await toolCallAction.run({
      auth: undefined,
      propsValue: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-mortgages/simulate_rate',
        payload: { loanAmount: 150000, propertyValue: 200000, loanDurationMonths: 240 },
        effect: 'READ',
      },
    } as Parameters<typeof toolCallAction.run>[0]);

    expect(result.estimatedRate).toBe(0.029);
    expect(result.loanDurationMonths).toBe(240);
    expect(result.loanAmount).toBe(150000);
    expect(result.propertyValue).toBe(200000);
    expect(result.ltv).toBe(0.75);
    expect(typeof result.monthlyPayment).toBe('number');
    expect(result.monthlyPayment).toBeGreaterThan(0);
  });

  it('returns ltvValid=true when loan-to-property ratio is within 0.80', async () => {
    const result = await toolCallAction.run({
      auth: undefined,
      propsValue: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-mortgages/validate_ltv',
        payload: { loanAmount: 150000, propertyValue: 200000, monthlyIncome: 3000 },
        effect: 'READ',
      },
    } as Parameters<typeof toolCallAction.run>[0]);

    expect(result.ltv).toBe(0.75);
    expect(result.ltvValid).toBe(true);
    expect(result.denyReason).toBe('');
  });

  it('returns ltvValid=false with denyReason when ratio exceeds 0.80', async () => {
    const result = await toolCallAction.run({
      auth: undefined,
      propsValue: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-mortgages/validate_ltv',
        payload: { loanAmount: 95000, propertyValue: 100000, monthlyIncome: 2500 },
        effect: 'READ',
      },
    } as Parameters<typeof toolCallAction.run>[0]);

    expect(result.ltvValid).toBe(false);
    expect(result.denyReason).toBe('ltv-exceeded-0.80');
  });

  it('returns deterministic mortgage submit application evidence preserving request payload', async () => {
    const submitRequest = {
      customerId: 'C-001',
      propertyValue: 200000,
      loanAmount: 150000,
      loanDurationMonths: 240,
      monthlyIncome: 3000,
    };
    const result = await toolCallAction.run({
      auth: undefined,
      propsValue: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-mortgages/submit_application',
        payload: { request: submitRequest },
        effect: 'IRREVERSIBLE',
      },
    } as Parameters<typeof toolCallAction.run>[0]);

    expect(result.applicationId).toBe('MM-2026-0001');
    expect(result.submissionStatus).toBe('INVIATA');
    expect(result.request).toEqual(submitRequest);
  });

  it('returns deterministic property valuation when given propertyId', async () => {
    const result = await toolCallAction.run({
      auth: undefined,
      propsValue: {
        mcpGatewayId: 'g-1',
        toolRef: 'banking-properties/get_valuation',
        payload: { propertyId: 'P-100' },
        effect: 'READ',
      },
    } as Parameters<typeof toolCallAction.run>[0]);

    expect(result.propertyId).toBe('P-100');
    expect(result.estimatedValue).toBe(200000);
    expect(result.currency).toBe('EUR');
  });
});
