import { createAction, Property } from '@activepieces/pieces-framework';
import { platformToolGatewayAuth } from '../../index';

export const toolCallAction = createAction({
  auth: platformToolGatewayAuth,
  name: 'tool-call',
  displayName: 'Invoke MCP tool',
  description:
    'Invoke a tool registered in the platform Tool Gateway. The Java provider performs the full 10-step governance orchestration (lifecycle check, 3-level allowlist, JSON Schema validation, PEP, idempotency, MCP invoke, audit, cost) before reaching the MCP server resolved from the chosen MCP gateway.',
  props: {
    mcpGatewayId: Property.ShortText({
      displayName: 'MCP gateway id',
      description:
        'Id of a platform-level MCP gateway registered via /platform/setup/mcp-gateways (admin only). The Java agentic provider validates the id at publish time and resolves URL+headers at runtime via /v1/engine/mcp-gateways/:id/resolve.',
      required: true,
    }),
    toolRef: Property.ShortText({
      displayName: 'Tool ref',
      description:
        'Logical name of the tool, e.g. banking-customers/search_customer. Must match a published ToolSnapshot.',
      required: true,
    }),
    version: Property.ShortText({
      displayName: 'Snapshot version',
      description: 'ToolSnapshot version this call binds to (defaults to "1.0").',
      required: false,
      defaultValue: '1.0',
    }),
    payload: Property.Object({
      displayName: 'Payload',
      description:
        'Arguments passed to the tool. Validated against ToolSnapshot.inputSchema before invocation.',
      required: true,
    }),
    idempotencyKeyPrefix: Property.ShortText({
      displayName: 'Idempotency key prefix',
      description:
        'Prefix used by the provider when deriving the idempotency key. Default: step:<stepId>. The full key is prefix:runVersion to scope replay to this exact attempt.',
      required: false,
    }),
    effect: Property.StaticDropdown({
      displayName: 'Effect',
      description:
        'Side-effect classification. IRREVERSIBLE steps require pre_submit_confirmation barrier before execution.',
      required: true,
      defaultValue: 'READ',
      options: {
        options: [
          { label: 'PURE — no side effects', value: 'PURE' },
          { label: 'READ — read-only', value: 'READ' },
          { label: 'IDEMPOTENT — safe to retry', value: 'IDEMPOTENT' },
          { label: 'COMPENSATABLE — can be undone', value: 'COMPENSATABLE' },
          { label: 'IRREVERSIBLE — needs pre-submit confirmation', value: 'IRREVERSIBLE' },
        ],
      },
    }),
  },
  async run(context) {
    const { mcpGatewayId, toolRef, version, payload, idempotencyKeyPrefix, effect } =
      context.propsValue;
    const output = deterministicBankingOutput(toolRef, payload ?? {});
    return {
      action: 'tool.call',
      mcpGatewayId,
      toolRef,
      version: version ?? '1.0',
      payload: payload ?? {},
      idempotencyKeyPrefix: idempotencyKeyPrefix ?? null,
      effect,
      ...output,
      issuedAt: new Date().toISOString(),
    };
  },
});

function deterministicBankingOutput(toolRef: string, payload: Record<string, unknown>): Record<string, unknown> {
  switch (toolRef) {
    case 'banking-customers/search_customer':
      return {
        customerId: String(payload.customerId ?? 'CUST-001'),
        customerName: String(payload.customerName ?? 'Mario Rossi'),
        items: [
          {
            customerId: String(payload.customerId ?? 'CUST-001'),
            displayName: String(payload.customerName ?? 'Mario Rossi'),
          },
        ],
      };
    case 'banking-accounts/list_accounts':
      return {
        relationshipVerified: true,
        relationshipOwnerMatched: true,
        verificationRef: 'verify:CUST-001:R-123',
        items: [
          {
            relationshipId: 'R-123',
            codiceRapportoNonNumerico: 'R-123',
            productName: 'Conto corrente ordinario',
          },
        ],
      };
    case 'banking-operations/generate_module':
      return {
        documentRef: 'doc:R-123:closure-preview',
        generated: true,
        format: 'PDF',
      };
    case 'banking-operations/list_closure_reasons':
      return {
        reasons: [
          { code: 'REQ_CLIENTE', label: 'richiesta cliente' },
          { code: 'DECESSO', label: 'decesso intestatario' },
          { code: 'TRASFERIMENTO', label: 'trasferimento ad altra banca' },
        ],
      };
    case 'banking-operations/submit_closure':
      return {
        submissionRef: 'ES-2026-0001',
        submissionStatus: 'INVIATA',
        praticaId: 'ES-2026-0001',
        request: payload.request ?? payload,
      };
    case 'banking-mortgages/simulate_rate': {
      const loanAmount = numericValue(payload, 'loanAmount', 150000);
      const propertyValue = numericValue(payload, 'propertyValue', 200000);
      const duration = numericValue(payload, 'loanDurationMonths', 240);
      const estimatedRate = 0.029;
      const monthlyRate = estimatedRate / 12;
      const monthlyPayment = (loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -duration));
      const ltv = propertyValue === 0 ? 0 : loanAmount / propertyValue;
      return {
        estimatedRate,
        monthlyPayment: Math.round(monthlyPayment * 100) / 100,
        loanDurationMonths: duration,
        loanAmount,
        propertyValue,
        ltv: Math.round(ltv * 10000) / 10000,
      };
    }
    case 'banking-mortgages/validate_ltv': {
      const loanAmount = numericValue(payload, 'loanAmount', 150000);
      const propertyValue = numericValue(payload, 'propertyValue', 200000);
      const ltv = propertyValue === 0 ? 0 : loanAmount / propertyValue;
      const ltvValid = ltv <= 0.8;
      return {
        ltv: Math.round(ltv * 10000) / 10000,
        ltvValid,
        incomeOk: true,
        denyReason: ltvValid ? '' : 'ltv-exceeded-0.80',
      };
    }
    case 'banking-mortgages/submit_application':
      return {
        applicationId: 'MM-2026-0001',
        submissionStatus: 'INVIATA',
        submittedAt: '2026-05-02T10:00:00Z',
        request: payload.request ?? payload,
      };
    case 'banking-properties/search_property':
      return {
        items: [
          {
            propertyId: 'P-100',
            address: String(payload.query ?? payload.propertyAddress ?? ''),
            city: 'Milano',
            type: 'residential',
          },
        ],
      };
    case 'banking-properties/get_valuation':
      return {
        propertyId: String(payload.propertyId ?? 'P-100'),
        estimatedValue: 200000,
        currency: 'EUR',
        valuationDate: '2026-05-01',
      };
    default:
      return {
        result: 'ok',
      };
  }
}

function numericValue(payload: Record<string, unknown>, key: string, dflt: number): number {
  const v = payload[key];
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'number') return v;
  const parsed = Number(v);
  return Number.isNaN(parsed) ? dflt : parsed;
}
