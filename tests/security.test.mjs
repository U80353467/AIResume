import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import worker from '../worker.js';

const origin = 'https://resume.example';
const authorization = 'Bearer SECURITY_TEST_DUMMY_KEY';
const body = { model: 'qwen-turbo', messages: [{ role: 'user', content: '测试' }] };
const env = { ALLOWED_ORIGINS: origin, AI_RATE_LIMITER: { limit: async () => ({ success: true }) } };
function request(options = {}) {
  return new Request('https://proxy.example/', {
    method: 'POST', body: JSON.stringify(body), ...options,
    headers: { Origin: origin, Authorization: authorization, 'Content-Type': 'application/json', ...options.headers },
  });
}

test('proxy rejects untrusted/missing origins and does not issue wildcard CORS', async () => {
  for (const value of ['https://attacker.example', 'null', '']) {
    const response = await worker.fetch(request({ headers: { Origin: value } }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('allowed preflight succeeds without forwarding credentials', async () => {
  const response = await worker.fetch(request({ method: 'OPTIONS', body: undefined }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('proxy requires bearer authentication, JSON and a configured limiter', async () => {
  assert.equal((await worker.fetch(request({ headers: { Authorization: '' } }), env)).status, 401);
  assert.equal((await worker.fetch(request({ headers: { 'Content-Type': 'text/plain' } }), env)).status, 415);
  assert.equal((await worker.fetch(request(), { ALLOWED_ORIGINS: origin })).status, 503);
});

test('rate limit uses a credential digest and rejects over-quota calls', async () => {
  let digest;
  const response = await worker.fetch(request(), {
    ...env, AI_RATE_LIMITER: { limit: async ({ key }) => { digest = key; return { success: false }; } },
  });
  assert.match(digest, /^[a-f\d]{64}$/);
  assert.ok(!digest.includes('DUMMY'));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
});

test('invalid JSON, roles and oversized messages are rejected', async () => {
  for (const invalid of ['{', JSON.stringify({ ...body, messages: [{ role: 'tool', content: 'bad' }] }),
    JSON.stringify({ ...body, messages: [{ role: 'user', content: 'x'.repeat(20001) }] })]) {
    assert.equal((await worker.fetch(request({ body: invalid }), env)).status, 400);
  }
});

test('request byte limits apply even when Content-Length lies', async () => {
  const response = await worker.fetch(request({ body: 'x'.repeat(256 * 1024 + 1), headers: { 'Content-Length': '1' } }), env);
  assert.equal(response.status, 413);
});

test('proxy refuses insecure upstream addresses', async () => {
  const response = await worker.fetch(request(), { ...env, API_URL: 'http://upstream.example/' });
  assert.equal(response.status, 503);
});

test('valid proxy call forwards only supported fields and never follows redirects', async t => {
  let forwarded;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    forwarded = { url, options };
    return new Response('data: [DONE]\n\n');
  });
  const response = await worker.fetch(request({ body: JSON.stringify({ ...body, tools: ['untrusted'], api_url: 'https://attacker.example/' }) }), env);
  assert.equal(await response.text(), 'data: [DONE]\n\n');
  assert.equal(forwarded.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.deepEqual(JSON.parse(forwarded.options.body), { ...body, stream: true });
  assert.equal(forwarded.options.redirect, 'error');
  assert.equal(forwarded.options.headers.Authorization, authorization);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('proxy caps streamed responses and hides internal errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)));
  const oversized = await worker.fetch(request(), env);
  await assert.rejects(oversized.text());
  globalThis.fetch.mock.mockImplementation(async () => { throw new Error(authorization); });
  const failure = await worker.fetch(request(), env);
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes('DUMMY'));
});

const clientWorkerCode = ts.transpileModule(readFileSync(new URL('../src/worker/aiWorker.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
function clientWorker(fetch, timerOverride) {
  const messages = [];
  const self = { postMessage: value => messages.push(value) };
  runInNewContext(clientWorkerCode, {
    self, fetch, URL, TextEncoder, TextDecoder, AbortController,
    setTimeout: timerOverride || setTimeout, clearTimeout,
  });
  return { messages, run: data => self.onmessage({ data: { taskId: 1, messages: body.messages, model: body.model,
    userApiKey: 'SECURITY_TEST_DUMMY_KEY', API_URL: 'https://api.example/', ...data } }) };
}

test('client SSE parser preserves JSON and UTF-8 across split network chunks', async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"测试✅"}}]}\n\ndata: [DONE]\n\n');
  const client = clientWorker(async () => new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2));
    controller.close();
  } })));
  await client.run();
  assert.equal(client.messages.at(-1).isComplete, true);
  assert.equal(client.messages.at(-1).result, '测试✅');
});

test('client completes streams without DONE and reports network errors as terminal', async () => {
  const client = clientWorker(async () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}'));
  await client.run();
  assert.equal(client.messages.at(-1).result, 'ok');
  assert.equal(client.messages.at(-1).isComplete, true);
  const failure = clientWorker(async () => { throw new Error('offline'); });
  await failure.run();
  assert.equal(failure.messages.at(-1).isComplete, true);
});

test('client refuses insecure endpoints and oversized conversations before sending a key', async () => {
  let sent = false;
  const client = clientWorker(async () => { sent = true; throw new Error('should not fetch'); });
  await client.run({ API_URL: 'http://api.example/' });
  await client.run({ messages: [{ role: 'user', content: 'x'.repeat(270000) }] });
  assert.equal(sent, false);
  assert.equal(client.messages.filter(message => message.isComplete).length, 2);
});

test('client timeout aborts the request and completes the pending task', async () => {
  let timeout;
  const client = clientWorker(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }), callback => { timeout = callback; return 0; });
  const pending = client.run();
  timeout();
  await pending;
  assert.equal(client.messages.at(-1).isComplete, true);
  assert.match(client.messages.at(-1).result, /超时/);
});
