/**
 * k6 load test for INTERACTIVE_FLOW.
 *
 * Exercises a single pause/resume turn to measure:
 *   - extractor latency (p50/p95)
 *   - resume endpoint latency
 *   - error rate
 *
 * Run:
 *   AP_BASE_URL=https://flow.example.com \
 *   AP_API_TOKEN=<engine_token> \
 *   AP_FLOW_RUN_ID=<seeded run id> \
 *   k6 run packages/tests-e2e/fixtures/load-test-interactive-flow.js
 *
 * Not executed in CI: requires a live AP instance with a seeded paused
 * run plus a live AI Provider. See plan §"Load test" for context.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.AP_BASE_URL;
const TOKEN = __ENV.AP_API_TOKEN;
const FLOW_RUN_ID = __ENV.AP_FLOW_RUN_ID;
const RESUME_SIG = __ENV.AP_RESUME_SIG;

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<4000'],
  },
};

const extractorLatency = new Trend('interactive_flow_extractor_ms');
const resumeLatency = new Trend('interactive_flow_resume_ms');
const turnErrors = new Counter('interactive_flow_turn_errors');

export default function run() {
  const extractRes = http.post(
    `${BASE_URL}/api/v1/engine/interactive-flow-ai/field-extract`,
    JSON.stringify({
      provider: 'openai',
      model: 'gpt-4o-mini',
      message: 'estingui rapporto di Polito al 01/02/2025',
      locale: 'it',
      stateFields: [
        { name: 'clientName', type: 'string', extractable: true },
        { name: 'closureDate', type: 'date', extractable: true },
      ],
    }),
    {
      headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      tags: { endpoint: 'field-extract' },
    },
  );
  extractorLatency.add(extractRes.timings.duration);
  const extractOk = check(extractRes, {
    'extract 200': (r) => r.status === 200,
    'has extractedFields': (r) => {
      try {
        const body = r.json();
        return body && typeof body === 'object' && 'extractedFields' in body;
      } catch {
        return false;
      }
    },
  });
  if (!extractOk) turnErrors.add(1);

  const resumeRes = http.post(
    `${BASE_URL}/api/v1/flow-runs/${FLOW_RUN_ID}/resume?sig=${RESUME_SIG}`,
    JSON.stringify({ body: { message: 'confermo' }, headers: {}, queryParams: {} }),
    {
      headers: { 'content-type': 'application/json' },
      tags: { endpoint: 'resume' },
    },
  );
  resumeLatency.add(resumeRes.timings.duration);
  const resumeOk = check(resumeRes, {
    'resume 2xx': (r) => r.status >= 200 && r.status < 300,
  });
  if (!resumeOk) turnErrors.add(1);

  sleep(1);
}
