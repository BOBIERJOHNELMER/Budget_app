const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');

const DEFAULT_PORT = 8002;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 75_000;
const PROVIDERS = {
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    keyName: 'OPENROUTER_API_KEY'
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    keyName: 'GROQ_API_KEY'
  }
};
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'https://localhost'
];
const rateLimitBuckets = new Map();

function isAuthorized(request, environment) {
  const expectedToken = environment.AI_PROXY_ACCESS_TOKEN;
  if (!expectedToken) return true;
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '');
  if (!match) return false;
  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function loadLocalEnvironment() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) return;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function validateChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request must be a JSON object.';
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, body.provider)) return 'Choose a supported AI provider.';
  if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 160) return 'Model name is required and must be at most 160 characters.';
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 12) return 'Messages must contain between 1 and 12 entries.';
  const validMessages = body.messages.every((message) => (
    message
    && typeof message === 'object'
    && ['system', 'user', 'assistant'].includes(message.role)
    && typeof message.content === 'string'
    && message.content.length <= 40_000
  ));
  if (!validMessages) return 'Each message must have a supported role and text content under 40,000 characters.';
  return '';
}

function isRateLimited(address) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(address);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateLimitBuckets.set(address, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

function createAiProxyServer({
  environment = process.env,
  fetchImpl = fetch
} = {}) {
  const allowedOrigins = new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...String(environment.AI_PROXY_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  ]);
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: 'This app origin is not allowed by the AI proxy.' });
      return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (!isAuthorized(request, environment)) {
      sendJson(response, 401, { error: 'The AI proxy access token is missing or invalid.' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/providers') {
      sendJson(response, 200, {
        providers: {
          openrouter: Boolean(environment.OPENROUTER_API_KEY),
          groq: Boolean(environment.GROQ_API_KEY)
        }
      });
      return;
    }

    if (request.method !== 'POST' || url.pathname !== '/api/chat/completions') {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    if (isRateLimited(request.socket.remoteAddress || 'unknown')) {
      sendJson(response, 429, { error: 'AI proxy rate limit reached. Wait a minute and try again.' });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) sendJson(response, error.status || 400, { error: error.message || 'Unable to read request.' });
      return;
    }
    const validationError = validateChatRequest(body);
    if (validationError) {
      sendJson(response, 400, { error: validationError });
      return;
    }

    const provider = PROVIDERS[body.provider];
    const apiKey = environment[provider.keyName];
    if (!apiKey) {
      sendJson(response, 503, { error: `The ${body.provider} API key is not configured on the AI proxy server.` });
      return;
    }

    const clientDisconnect = new AbortController();
    request.once('aborted', () => clientDisconnect.abort());
    response.once('close', () => {
      if (!response.writableEnded) clientDisconnect.abort();
    });

    try {
      const upstream = await fetchImpl(provider.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(body.provider === 'openrouter' ? { 'X-Title': 'SalaryWise' } : {})
        },
        body: JSON.stringify({
          model: body.model,
          messages: body.messages,
          temperature: 0.3
        }),
        signal: AbortSignal.any([AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), clientDisconnect.signal])
      });
      const responseText = await upstream.text();
      if (!upstream.ok) {
        let providerMessage = '';
        try {
          const providerBody = JSON.parse(responseText);
          providerMessage = providerBody.error?.message || providerBody.error?.metadata?.raw || '';
        } catch {
          providerMessage = responseText;
        }
        const detail = typeof providerMessage === 'string' ? providerMessage.trim().slice(0, 300) : '';
        sendJson(response, upstream.status, {
          error: detail
            ? `${body.provider} rejected the request: ${detail}`
            : `${body.provider} request failed with status ${upstream.status}. Check the key and model ID.`
        });
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(responseText);
    } catch (error) {
      if (clientDisconnect.signal.aborted || response.destroyed) return;
      const status = error.name === 'TimeoutError' ? 504 : 502;
      sendJson(response, status, { error: status === 504 ? 'The AI provider request timed out.' : 'Unable to reach the AI provider.' });
    }
  });
}

if (require.main === module) {
  loadLocalEnvironment();
  const host = process.env.AI_PROXY_HOST || DEFAULT_HOST;
  const port = Number(process.env.PORT || process.env.AI_PROXY_PORT || DEFAULT_PORT);
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !process.env.AI_PROXY_ACCESS_TOKEN) {
    throw new Error('Refusing to expose the AI proxy without AI_PROXY_ACCESS_TOKEN. Configure a strong token before binding beyond loopback.');
  }
  const server = createAiProxyServer();
  server.listen(port, host, () => {
    console.log(`SalaryWise AI proxy listening on http://${host}:${port}`);
    if (!process.env.OPENROUTER_API_KEY && !process.env.GROQ_API_KEY) {
      console.warn('No provider keys configured. Add rotated keys to the project .env file.');
    }
  });
}

module.exports = { createAiProxyServer, loadLocalEnvironment, validateChatRequest };
