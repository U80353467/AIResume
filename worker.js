const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request) {
  if (!request.body) throw new RequestError(400, '请求内容不能为空');
  if (Number(request.headers.get('Content-Length')) > MAX_REQUEST_BYTES) {
    throw new RequestError(413, '请求内容过大');
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 15000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new RequestError(408, '请求读取超时');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new RequestError(413, '请求内容过大');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new RequestError(400, 'JSON 格式不正确');
    }
  } finally {
    clearTimeout(timer);
    if (size > MAX_REQUEST_BYTES) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || typeof body.model !== 'string' || !/^[\w][\w.:/-]{0,99}$/.test(body.model)
    || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100) {
    throw new RequestError(400, '模型或消息格式不正确');
  }
  const messages = body.messages.map(message => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)
      || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 20000) {
      throw new RequestError(400, '消息内容格式或长度不正确');
    }
    return { role: message.role, content: message.content };
  });
  return { model: body.model, messages, stream: true };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    const allowed = origin && (origin === new URL(request.url).origin || allowedOrigins.includes(origin));
    const headers = {
      'Vary': 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      ...(allowed ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      } : {}),
    };
    const errorResponse = (status, message) => new Response(JSON.stringify({ error: message }), {
      status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    });
    if (!allowed) return errorResponse(403, '不允许的请求来源');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return errorResponse(405, '仅支持 POST 请求');
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer [\x21-\x7e]{1,512}$/.test(authorization)) return errorResponse(401, '缺少有效的 API Key');
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return errorResponse(415, '请求必须使用 application/json');
    }
    // A platform binding survives isolate restarts. Never silently disable rate limiting.
    if (typeof env.AI_RATE_LIMITER?.limit !== 'function') return errorResponse(503, '代理限流尚未配置');
    let body;
    let upstream;
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authorization));
      const key = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      const { success } = await env.AI_RATE_LIMITER.limit({ key });
      if (!success) {
        const response = errorResponse(429, '请求过于频繁，请稍后重试');
        response.headers.set('Retry-After', '60');
        return response;
      }
      body = validateBody(await readJson(request));
      upstream = new URL(env.API_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
      if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.hash) {
        return errorResponse(503, '上游地址配置不正确');
      }
    } catch (error) {
      return errorResponse(error instanceof RequestError ? error.status : 503,
        error instanceof RequestError ? error.message : '代理配置或限流服务不可用');
    }
    const abortController = new AbortController();
    const onClientAbort = () => abortController.abort();
    request.signal.addEventListener('abort', onClientAbort, { once: true });
    if (request.signal.aborted) abortController.abort();
    const timer = setTimeout(() => abortController.abort(), 90000);
    const cleanup = () => {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onClientAbort);
    };
    try {
      const response = await fetch(upstream.href, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), redirect: 'error', signal: abortController.signal,
      });
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => {});
        cleanup();
        return errorResponse(response.ok ? 502 : response.status, '上游服务请求失败');
      }
      const reader = response.body.getReader();
      let size = 0;
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              cleanup();
              controller.close();
              return;
            }
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) throw new Error('响应内容超过限制');
            controller.enqueue(value);
          } catch {
            cleanup();
            abortController.abort();
            void reader.cancel().catch(() => {});
            controller.error(new Error('上游响应中断或超过限制'));
          }
        },
        cancel() {
          cleanup();
          abortController.abort();
          return reader.cancel();
        },
      });
      return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8' } });
    } catch {
      cleanup();
      return errorResponse(abortController.signal.aborted ? 504 : 502, '上游服务暂时不可用');
    }
  },
};
