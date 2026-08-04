import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {dirname, extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

import {createCodingAgent} from '@axiom-agent/coding-agent';
import {AgentHarness, Session} from '@axiom-agent/core';
import {OpenAICompatibleChatModel} from '@axiom-agent/openai-compatible';
import {JsonlSessionStore} from '@axiom-agent/session-jsonl';
import {JsonlRunTrace} from '@axiom-agent/trace-jsonl';

import {isAllowedOrigin, isJsonContentType} from './server-guards.mjs';

const appDirectory = dirname(fileURLToPath(import.meta.url));
const sidecarMode = process.env.AXIOM_SIDECAR === '1';
const port = positiveInteger(process.env.AXIOM_GUI_PORT ?? '4174', 'port');
const runs = new Map();

function allowedOrigins() {
  const defaults = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://localhost:1420',
    'http://tauri.localhost',
    'https://tauri.localhost',
    'tauri://localhost',
  ];
  const extra = (process.env.AXIOM_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return [...defaults, ...extra];
}

function repositoryRoot() {
  if (process.env.AXIOM_WORKSPACE) return process.env.AXIOM_WORKSPACE;
  if (sidecarMode) return process.cwd();
  return resolve(appDirectory, '..', '..');
}

function stateDirectory() {
  if (process.env.AXIOM_STATE_DIR) return process.env.AXIOM_STATE_DIR;
  return resolve(repositoryRoot(), '.axiom-agent', 'gui');
}

const distDirectory = sidecarMode ? undefined : resolve(appDirectory, 'dist');

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const origin = request.headers.origin;
    const allowed = isAllowedOrigin(origin, allowedOrigins());

    if (origin && allowed) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'Content-Type',
        'access-control-max-age': '86400',
        ...(origin && allowed ? {'access-control-allow-origin': origin, vary: 'Origin'} : {}),
      });
      return response.end();
    }

    if (request.method === 'POST' && !allowed) {
      return json(response, 403, {error: 'Cross-origin write requests are not allowed.'});
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(response, 200, {
        ready: Boolean(process.env.TOKENRHYTHM_API_KEY),
        model: process.env.TOKENRHYTHM_MODEL ?? 'deepseek-v4-flash',
        defaultWorkspace: process.env.AXIOM_GUI_WORKSPACE ?? repositoryRoot(),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/runs') {
      if (!isJsonContentType(request.headers['content-type'])) {
        return json(response, 415, {error: 'Content-Type must be application/json.'});
      }
      return await startRun(request, response);
    }
    const cancelMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/cancel$/);
    if (request.method === 'POST' && cancelMatch) {
      const controller = runs.get(cancelMatch[1]);
      if (!controller) return json(response, 404, {error: 'Run is not active.'});
      controller.abort(new Error('Stopped by user.'));
      return json(response, 202, {stopped: true});
    }
    if (request.method === 'GET' && !sidecarMode) return await serveStatic(url.pathname, response);
    return json(response, 404, {error: 'Not found.'});
  } catch (error) {
    return json(response, 500, {error: errorMessage(error)});
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Coding Agent GUI server -> http://127.0.0.1:${port} (sidecar=${sidecarMode})`);
});

async function startRun(request, response) {
  const apiKey = process.env.TOKENRHYTHM_API_KEY;
  if (!apiKey) return json(response, 503, {error: 'TOKENRHYTHM_API_KEY is not configured.'});
  const input = await readJson(request);
  const workspace = resolve(requiredString(input, 'workspace'));
  if (!(await stat(workspace)).isDirectory()) throw new Error('workspace must be a directory.');
  const task = requiredString(input, 'task');
  const sessionId = optionalSessionId(input.sessionId) ?? `gui-${Date.now()}`;
  const runId = randomUUID();
  const controller = new AbortController();
  const model = new OpenAICompatibleChatModel({
    apiKey,
    baseUrl: process.env.TOKENRHYTHM_BASE_URL ?? 'https://tokenrhythm.studio/v1',
    model: process.env.TOKENRHYTHM_MODEL ?? 'deepseek-v4-flash',
  });
  const agent = await createCodingAgent({
    workspace,
    allowedCommands: [process.execPath],
    rgCommand: process.env.AXIOM_RG_COMMAND ?? 'rg',
    model,
  });
  const session = new Session({
    id: sessionId,
    store: new JsonlSessionStore({directory: resolve(stateDirectory(), 'sessions')}),
  });
  const trace = new JsonlRunTrace({directory: resolve(stateDirectory(), 'traces'), runId});
  const harness = new AgentHarness({agent, session, maxTurns: 20});

  runs.set(runId, controller);
  response.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-content-type-options': 'nosniff',
  });
  response.on('close', () => {
    if (!response.writableEnded) controller.abort(new Error('Client disconnected.'));
  });
  writeLine(response, {type: 'run_created', runId, traceRunId: trace.runId, sessionId, workspace});

  try {
    for await (const event of harness.run(task, {signal: controller.signal})) {
      await trace.record(event);
      writeLine(response, {type: 'agent_event', event: serializableEvent(event)});
    }
    writeLine(response, {type: 'complete', runId});
  } catch (error) {
    writeLine(response, {type: 'transport_error', error: errorMessage(error)});
  } finally {
    runs.delete(runId);
    response.end();
  }
}

async function serveStatic(pathname, response) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = resolve(distDirectory, relative);
  if (file !== distDirectory && !file.startsWith(`${distDirectory}${sep}`)) {
    return json(response, 403, {error: 'Invalid path.'});
  }
  try {
    const details = await stat(file);
    if (!details.isFile()) throw new Error('Not a file.');
  } catch {
    return json(response, 404, {error: 'Frontend asset not found. Run the build first.'});
  }
  response.writeHead(200, {
    'content-type': mimeType(file),
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(response);
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error('Request body is too large.');
  }
  const value = JSON.parse(body || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required.');
  return value;
}

function serializableEvent(event) {
  if (event.type !== 'run_error') return event;
  return {...event, error: {name: event.error.name, message: event.error.message}};
}

function requiredString(record, name) {
  const value = record[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalSessionId(value) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw new Error('sessionId must use 1-80 letters, digits, dots, underscores, or hyphens.');
  }
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`${name} is invalid.`);
  return parsed;
}

function writeLine(response, value) {
  if (!response.destroyed) response.write(`${JSON.stringify(value)}\n`);
}

function json(response, status, value) {
  if (response.headersSent) return response.end();
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  response.end(JSON.stringify(value));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : 'Unknown error.';
}

function mimeType(file) {
  return ({'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'}[extname(file)] ?? 'application/octet-stream');
}
