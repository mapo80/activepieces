import { AddressInfo } from 'net';
import { describe, expect, it } from 'vitest';

import { claudeCliProxyInternal, startClaudeCliProxy } from './claude-cli-proxy';
import { startMockMcpServer } from './mock-mcp-server';

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('claude-cli-proxy internals', () => {
  it('messageToPlain coerces array content into joined text', () => {
    expect(
      claudeCliProxyInternal.messageToPlain([
        { type: 'text', text: 'hello' },
        { type: 'image', text: undefined },
        { type: 'text', text: 'world' },
      ]),
    ).toBe('hello\nworld');
  });

  it('renderPrompt appends tool schema + response format when tools are requested', () => {
    const rendered = claudeCliProxyInternal.renderPrompt({
      model: 'test',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract',
            parameters: { type: 'object', properties: { x: { type: 'string' } } },
          },
        },
      ],
    });
    expect(rendered).toContain('[system] sys');
    expect(rendered).toContain('[user] hi');
    expect(rendered).toContain('Tool extract');
    expect(rendered).toContain('strict JSON format');
  });

  it('tryParseToolCall strips markdown fences and extracts tool+arguments', () => {
    expect(
      claudeCliProxyInternal.tryParseToolCall(
        '```json\n{"tool":"extract","arguments":{"ndg":"42"}}\n```',
      ),
    ).toEqual({ name: 'extract', arguments: '{"ndg":"42"}' });
    expect(claudeCliProxyInternal.tryParseToolCall('not json')).toBeNull();
  });
});

describe('claude-cli-proxy server', () => {
  it('returns an OpenAI-shape tool_calls response when the responder emits valid tool JSON', async () => {
    const proxy = await startClaudeCliProxy({
      port: 0,
      modelHint: 'custom-cli',
      staticResponder: async (body) => {
        expect(body.tools?.[0].function.name).toBe('extract');
        return '{"tool":"extract","arguments":{"ndg":"42","clientName":"Polito"}}';
      },
    });
    const port = (proxy.server.address() as AddressInfo).port;
    const res = await postJson(`http://127.0.0.1:${port}/v1/chat/completions`, {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'extract from: rapporto di Polito ndg 42' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extract',
            parameters: { type: 'object' },
          },
        },
      ],
      tool_choice: 'required',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.choices[0].message.tool_calls[0].function.name).toBe('extract');
    expect(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments)).toEqual({
      ndg: '42',
      clientName: 'Polito',
    });
    await proxy.close();
  });

  it('returns a plain assistant message when no tool JSON is detected', async () => {
    const proxy = await startClaudeCliProxy({
      port: 0,
      staticResponder: async () => 'Qual è il NDG del cliente?',
    });
    const port = (proxy.server.address() as AddressInfo).port;
    const res = await postJson(`http://127.0.0.1:${port}/v1/chat/completions`, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'ask' }],
    });
    const body = await res.json();
    expect(body.choices[0].finish_reason).toBe('stop');
    expect(body.choices[0].message.content).toBe('Qual è il NDG del cliente?');
    await proxy.close();
  });

  it('replies 502 when the underlying responder throws', async () => {
    const proxy = await startClaudeCliProxy({
      port: 0,
      staticResponder: async () => {
        throw new Error('claude not found');
      },
    });
    const port = (proxy.server.address() as AddressInfo).port;
    const res = await postJson(`http://127.0.0.1:${port}/v1/chat/completions`, {
      model: 'x',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.message).toBe('claude not found');
    await proxy.close();
  });
});

describe('mock MCP server', () => {
  it('serves tools/list and executes tools/call', async () => {
    const mcp = await startMockMcpServer({
      port: 0,
      tools: [
        {
          name: 'search_customer',
          inputSchema: { type: 'object', properties: { ndg: { type: 'string' } } },
          execute: ({ ndg }) => ({ ndg, found: true, name: 'Polito' }),
        },
      ],
    });
    const port = (mcp.server.address() as AddressInfo).port;
    const listRes = await postJson(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    const list = await listRes.json();
    expect(list.result.tools[0].name).toBe('search_customer');

    const callRes = await postJson(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'search_customer', arguments: { ndg: '42' } },
    });
    const callBody = await callRes.json();
    const parsed = JSON.parse(callBody.result.content[0].text);
    expect(parsed).toEqual({ ndg: '42', found: true, name: 'Polito' });

    await mcp.close();
  });

  it('returns an error for unknown tools', async () => {
    const mcp = await startMockMcpServer({ port: 0, tools: [] });
    const port = (mcp.server.address() as AddressInfo).port;
    const res = await postJson(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
    });
    const body = await res.json();
    expect(body.error.message).toContain('Unknown tool');
    await mcp.close();
  });
});
