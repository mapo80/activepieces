import { httpClient, HttpMethod } from '@activepieces/pieces-common';
import { createAction, Property } from '@activepieces/pieces-framework';
import { createHmac } from 'node:crypto';
import { platformToolGatewayAuth } from '../../index';

export const toolCallAction = createAction({
  auth: platformToolGatewayAuth,
  name: 'tool-call',
  displayName: 'Invoke MCP tool',
  description:
    'Invoke a tool registered in the platform Tool Gateway. The Java provider performs the full 10-step governance orchestration (lifecycle check, 3-level allowlist, JSON Schema validation, PEP, idempotency, MCP invoke, audit, cost) before reaching the MCP server resolved from the chosen MCP gateway.',
  props: {
    platformCanonicalStepId: Property.ShortText({
      displayName: 'Platform canonical step id',
      description:
        'Stable canonical workflow step id used by the Java provider to translate AP runtime state back to the provider-agnostic RunState contract.',
      required: false,
    }),
    platformNextStep: Property.ShortText({
      displayName: 'Platform next step',
      description: 'Optional generated runtime jump target after this action completes.',
      required: false,
    }),
    platformTerminal: Property.Checkbox({
      displayName: 'Platform terminal step',
      description: 'When true, the generated platform runtime stops after this action.',
      required: false,
      defaultValue: false,
    }),
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
    bindingData: Property.Object({
      displayName: 'Canonical binding data',
      description:
        'Current canonical workflow data used by the Java provider to evaluate output bindings consistently across runtime providers.',
      required: false,
    }),
    outputBinding: Property.Object({
      displayName: 'Output binding',
      description:
        'Provider-agnostic output mapping from raw tool output to the canonical workflow data contract. Keys can use dotted paths such as _meta.componentProps.relationships.',
      required: false,
    }),
    errorPolicy: Property.Object({
      displayName: 'Error policy',
      description:
        'Provider-agnostic failure policy for this tool step. Example: { "onToolFailure": "ignore" } lets the workflow branch on an empty result instead of failing the run.',
      required: false,
    }),
    omitNulls: Property.Checkbox({
      displayName: 'Omit null mapped outputs',
      description:
        'When enabled, null or empty values produced by output binding are not returned.',
      required: false,
      defaultValue: false,
    }),
    inheritFromRaw: Property.Checkbox({
      displayName: 'Inherit raw tool output',
      description:
        'When enabled, raw tool outputs are returned before applying explicit output bindings.',
      required: false,
      defaultValue: false,
    }),
    platformRunId: Property.ShortText({
      displayName: 'Platform run id',
      description: 'Agentic platform run id used for audit and trace correlation.',
      required: false,
    }),
    capabilityId: Property.ShortText({
      displayName: 'Capability id',
      description: 'Capability id used for policy and audit correlation.',
      required: false,
    }),
    tenantId: Property.ShortText({
      displayName: 'Tenant id',
      description: 'Tenant id used by the Java ToolGateway policy context.',
      required: false,
    }),
    conversationId: Property.ShortText({
      displayName: 'Conversation id',
      description: 'Conversation id used by the Java provider to correlate tool trace events.',
      required: false,
    }),
    turnId: Property.ShortText({
      displayName: 'Turn id',
      description: 'Conversation turn id used by the Java provider to attach tool trace to the right message.',
      required: false,
    }),
    workflowDefinitionId: Property.ShortText({
      displayName: 'Workflow definition id',
      description: 'Canonical workflow definition id used for provider-agnostic trace attribution.',
      required: false,
    }),
    workflowDefinitionVersion: Property.ShortText({
      displayName: 'Workflow definition version',
      description: 'Canonical workflow definition version used for provider-agnostic trace attribution.',
      required: false,
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
    const {
      platformCanonicalStepId,
      platformNextStep,
      platformTerminal,
      mcpGatewayId,
      toolRef,
      version,
      payload,
      bindingData,
      outputBinding,
      errorPolicy,
      omitNulls,
      inheritFromRaw,
      platformRunId,
      capabilityId,
      tenantId,
      conversationId,
      turnId,
      workflowDefinitionId,
      workflowDefinitionVersion,
      idempotencyKeyPrefix,
      effect,
    } = context.propsValue;
    const output = await invokePlatformToolGateway({
      platformCanonicalStepId,
      mcpGatewayId,
      toolRef,
      version: version ?? '1.0',
      payload: asRecord(payload),
      bindingData: asRecord(bindingData),
      outputBinding: asRecord(outputBinding),
      errorPolicy: asRecord(errorPolicy),
      omitNulls: omitNulls === true,
      inheritFromRaw: inheritFromRaw === true,
      platformRunId,
      capabilityId,
      tenantId,
      conversationId,
      turnId,
      workflowDefinitionId,
      workflowDefinitionVersion,
      idempotencyKeyPrefix,
      effect,
      apRunId: context.run?.id ?? 'test-run',
    });
    return {
      action: 'tool.call',
      platformNextStep,
      platformTerminal: platformTerminal === true,
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

async function invokePlatformToolGateway(params: {
  platformCanonicalStepId?: string;
  mcpGatewayId: string;
  toolRef: string;
  version: string;
  payload: Record<string, unknown>;
  bindingData: Record<string, unknown>;
  outputBinding: Record<string, unknown>;
  errorPolicy: Record<string, unknown>;
  omitNulls: boolean;
  inheritFromRaw: boolean;
  platformRunId?: string;
  capabilityId?: string;
  tenantId?: string;
  conversationId?: string;
  turnId?: string;
  workflowDefinitionId?: string;
  workflowDefinitionVersion?: string;
  idempotencyKeyPrefix?: string;
  effect: string;
  apRunId: string;
}): Promise<Record<string, unknown>> {
  const providerUrl = stringOrUndefined(process.env['AP_AGENTIC_PROVIDER_URL']);
  const webhookSecret = stringOrUndefined(process.env['AP_AGENTIC_WEBHOOK_SECRET']);
  if (!providerUrl || !webhookSecret) {
    if (process.env['AP_AGENTIC_ALLOW_DETERMINISTIC_FALLBACK'] === 'true') {
      return deterministicBankingOutput(params.toolRef, params.payload);
    }
    throw new Error(
      'Agentic provider is not configured for platform-tool-gateway. Set AP_AGENTIC_PROVIDER_URL, AP_AGENTIC_WEBHOOK_SECRET and propagate them to the AP worker/sandbox.',
    );
  }

  const body = {
    platformCanonicalStepId: params.platformCanonicalStepId,
    mcpGatewayId: params.mcpGatewayId,
    toolRef: params.toolRef,
    version: params.version,
    payload: params.payload,
    bindingData: params.bindingData,
    outputBinding: params.outputBinding,
    errorPolicy: params.errorPolicy,
    omitNulls: params.omitNulls,
    inheritFromRaw: params.inheritFromRaw,
    idempotencyKey: `${params.idempotencyKeyPrefix ?? `ap:${params.toolRef}`}:${params.apRunId}`,
    effect: params.effect,
    runContext: {
      platformRunId: nonBlank(params.platformRunId, params.apRunId),
      capabilityId: nonBlank(params.capabilityId, 'unknown'),
      tenantId: nonBlank(params.tenantId, 'default'),
      conversationId: nonBlank(params.conversationId, ''),
      turnId: nonBlank(params.turnId, ''),
      workflowDefinitionId: nonBlank(params.workflowDefinitionId, ''),
      workflowDefinitionVersion: nonBlank(params.workflowDefinitionVersion, ''),
    },
  };
  const rawBody = JSON.stringify(body);
  const response = await httpClient.sendRequest<ToolInvokeResponse>({
    method: HttpMethod.POST,
    url: `${providerUrl.replace(/\/+$/, '')}/agentic/v1/tools/invoke`,
    headers: {
      'Content-Type': 'application/json',
      'X-AP-Signature': signHmac(rawBody, webhookSecret),
    },
    body: rawBody,
    timeout: 60_000,
  });
  const responseBody = response.body ?? {};
  if (responseBody.outcome === 'ERROR') {
    throw new Error(responseBody.errorMessage ?? responseBody.errorCode ?? 'ToolGateway returned ERROR');
  }
  return responseBody.outputs ?? {};
}

function signHmac(payload: string, secret: string): string {
  const mac = createHmac('sha256', secret);
  mac.update(payload, 'utf8');
  return `sha256=${mac.digest('hex')}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value).trim();
  return text.length === 0 ? undefined : text;
}

function nonBlank(value: unknown, fallback: string): string {
  const text = stringOrUndefined(value);
  return text ?? fallback;
}

type ToolInvokeResponse = {
  outcome?: 'SUCCESS' | 'ERROR' | 'IDEMPOTENT_REPLAY';
  outputs?: Record<string, unknown>;
  latencyMs?: number;
  retries?: number;
  errorCode?: string;
  errorMessage?: string;
};

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
