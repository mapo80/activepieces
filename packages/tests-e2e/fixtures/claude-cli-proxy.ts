/**
 * OpenAI-compatible HTTP shim that forwards prompts to the `claude` CLI.
 *
 * Minimal chat-completions compatibility: accepts POST /v1/chat/completions
 * with {model, messages, tools?, tool_choice?} and returns either a plain
 * assistant message or a single tool_calls response, matching OpenAI shape.
 *
 * Used by Playwright E2E specs that want to exercise the real field-extractor
 * and question-generator endpoints end-to-end without depending on a paid
 * provider. The AP platform must have an AI Provider configured as CUSTOM
 * (OpenAI-compatible) with baseUrl pointing at this shim.
 */

import { spawn } from 'child_process';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { URL } from 'url';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string }>;
};

type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
};

type ChatCompletionResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: 'stop' | 'tool_calls';
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

function messageToPlain(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((c): c is { type: string; text: string } => typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

function renderPrompt(body: ChatCompletionRequest): string {
  const parts: string[] = [];
  for (const msg of body.messages) {
    const text = messageToPlain(msg.content);
    parts.push(`[${msg.role}] ${text}`);
  }
  if (body.tools && body.tools.length > 0) {
    parts.push('');
    parts.push(
      'Respond in this strict JSON format (no markdown fences): {"tool":"<name>","arguments":{...}}',
    );
    for (const tool of body.tools) {
      parts.push(
        `Tool ${tool.function.name}: schema=${JSON.stringify(tool.function.parameters)}`,
      );
    }
  }
  return parts.join('\n');
}

function runClaude({ prompt, claudeBin }: { prompt: string; claudeBin: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, ['-p', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function tryParseToolCall(raw: string): { name: string; arguments: string } | null {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { tool?: string; arguments?: unknown };
    if (typeof parsed.tool === 'string' && parsed.arguments && typeof parsed.arguments === 'object') {
      return { name: parsed.tool, arguments: JSON.stringify(parsed.arguments) };
    }
  } catch {
    // fall through
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

export type StartProxyOptions = {
  port: number;
  claudeBin?: string;
  modelHint?: string;
  staticResponder?: (body: ChatCompletionRequest) => Promise<string>;
};

export type ClaudeCliProxy = {
  server: Server;
  close: () => Promise<void>;
};

export async function startClaudeCliProxy({ port, claudeBin, modelHint, staticResponder }: StartProxyOptions): Promise<ClaudeCliProxy> {
  const bin = claudeBin ?? process.env.CLAUDE_CLI_BIN ?? 'claude';

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await handleCompletion(req, res, { bin, modelHint, staticResponder });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  return {
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function handleCompletion(req: IncomingMessage, res: ServerResponse, ctx: { bin: string; modelHint?: string; staticResponder?: StartProxyOptions['staticResponder'] }): Promise<void> {
  const raw = await readBody(req);
  let body: ChatCompletionRequest;
  try {
    body = JSON.parse(raw) as ChatCompletionRequest;
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
    return;
  }

  let assistantRaw: string;
  try {
    assistantRaw = ctx.staticResponder
      ? await ctx.staticResponder(body)
      : await runClaude({ prompt: renderPrompt(body), claudeBin: ctx.bin });
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: (err as Error).message } }));
    return;
  }

  const toolCall = body.tools && body.tools.length > 0 ? tryParseToolCall(assistantRaw) : null;

  const now = Math.floor(Date.now() / 1000);
  const out: ChatCompletionResponse = toolCall
    ? {
        id: `chatcmpl_${now}`,
        object: 'chat.completion',
        created: now,
        model: ctx.modelHint ?? body.model,
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `call_${now}`,
                  type: 'function',
                  function: { name: toolCall.name, arguments: toolCall.arguments },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }
    : {
        id: `chatcmpl_${now}`,
        object: 'chat.completion',
        created: now,
        model: ctx.modelHint ?? body.model,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: assistantRaw },
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(out));
}

export const claudeCliProxyInternal = {
  renderPrompt,
  tryParseToolCall,
  messageToPlain,
};
