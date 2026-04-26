/**
 * Minimal MCP JSON-RPC server for E2E. Supports tools/list + tools/call.
 * Pass a `tools` map at construction time; each tool provides an executor
 * that receives the tool arguments and returns any JSON-serializable value.
 */

import { createServer, IncomingMessage, Server } from 'http';

export type MockMcpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export type MockMcpMode = 'happy' | 'catalog-fail' | 'slow' | 'crash';

export type StartMockMcpOptions = {
  port: number;
  tools: MockMcpTool[];
  mode?: MockMcpMode;
  slowMs?: number;
};

export type MockMcpServer = {
  server: Server;
  close: () => Promise<void>;
  setMode: (newMode: MockMcpMode, newSlowMs?: number) => void;
};

const DEFAULT_SLOW_MS = 5_000;

export async function startMockMcpServer({ port, tools, mode = 'happy', slowMs = DEFAULT_SLOW_MS }: StartMockMcpOptions): Promise<MockMcpServer> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  // Captured by closure; setMode() mutates these so the request handler
  // sees the new value at next request.
  let currentMode: MockMcpMode = mode;
  let currentSlowMs: number = slowMs;

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }

    if (currentMode === 'crash') {
      req.socket.destroy();
      return;
    }

    if (currentMode === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, currentSlowMs));
    }

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(await readBody(req)) as JsonRpcRequest;
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      return;
    }

    if (request.method === 'tools/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: t.inputSchema,
          })),
        },
      }));
      return;
    }

    if (request.method === 'tools/call') {
      const params = (request.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const tool = params.name ? byName.get(params.name) : undefined;
      if (!tool) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: `Unknown tool: ${params.name}` },
        }));
        return;
      }
      if (currentMode === 'catalog-fail' && /list_|catalog|search/i.test(tool.name)) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32001, message: `[mock-mcp:catalog-fail] ${tool.name} unavailable` },
        }));
        return;
      }
      try {
        const result = await tool.execute(params.arguments ?? {});
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          },
        }));
      } catch (err) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32000, message: (err as Error).message },
        }));
      }
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `Unknown method: ${request.method}` },
    }));
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  return {
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setMode: (newMode: MockMcpMode, newSlowMs?: number) => {
      currentMode = newMode;
      if (newSlowMs != null) currentSlowMs = newSlowMs;
    },
  };
}
