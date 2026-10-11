const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createAiProxyServer } = require('./ai-proxy.js');

const REQUESTED_OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
let server;
let baseUrl;
let forwardedRequest;

before(async () => {
  server = createAiProxyServer({
    environment: {
      OPENROUTER_API_KEY: 'test-openrouter-key',
      GROQ_API_KEY: ''
    },
    fetchImpl: async (url, options) => {
      forwardedRequest = { url, options };
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"message":"test response","actions":[]}' } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('reports configured providers without exposing keys', async () => {
  const response = await fetch(`${baseUrl}/api/providers`, {
    headers: { Origin: 'http://localhost:8000' }
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.providers, { openrouter: true, groq: false });
  assert.equal(JSON.stringify(result).includes('test-openrouter-key'), false);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8000');
});

test('provides a non-sensitive health endpoint without requiring a token', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('allows the Cordova Android origin and authorization preflight', async () => {
  const response = await fetch(`${baseUrl}/api/providers`, {
    headers: { Origin: 'https://localhost' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://localhost');

  const preflight = await fetch(`${baseUrl}/api/chat/completions`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://localhost',
      'Access-Control-Request-Headers': 'authorization,content-type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/i);
});

test('forwards requests only to the fixed provider endpoint using the proxy key', async () => {
  const response = await fetch(`${baseUrl}/api/chat/completions`, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:8000',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      provider: 'openrouter',
      model: REQUESTED_OPENROUTER_MODEL,
      messages: [{ role: 'user', content: 'test' }]
    })
  });
  assert.equal(response.status, 200);
  assert.equal(forwardedRequest.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(forwardedRequest.options.headers.Authorization, 'Bearer test-openrouter-key');
  assert.equal(JSON.parse(forwardedRequest.options.body).model, REQUESTED_OPENROUTER_MODEL);
  assert.equal((await response.json()).choices[0].message.content, '{"message":"test response","actions":[]}');
});

test('rejects unconfigured providers without calling upstream', async () => {
  forwardedRequest = undefined;
  const response = await fetch(`${baseUrl}/api/chat/completions`, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:8000',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      provider: 'groq',
      model: 'test/model',
      messages: [{ role: 'user', content: 'test' }]
    })
  });
  assert.equal(response.status, 503);
  assert.equal(forwardedRequest, undefined);
});

test('reports the upstream model error so unavailable models are diagnosable', async () => {
  const errorServer = createAiProxyServer({
    environment: { OPENROUTER_API_KEY: 'test-openrouter-key' },
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: 'The requested model is not available.' }
    }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  });
  await new Promise((resolve) => errorServer.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${errorServer.address().port}/api/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openrouter',
        model: REQUESTED_OPENROUTER_MODEL,
        messages: [{ role: 'user', content: 'test' }]
      })
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'openrouter rejected the request: The requested model is not available.');
  } finally {
    await new Promise((resolve, reject) => errorServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('requires the configured proxy access token without exposing it', async () => {
  const tokenServer = createAiProxyServer({
    environment: {
      OPENROUTER_API_KEY: 'test-openrouter-key',
      AI_PROXY_ACCESS_TOKEN: 'private-test-token'
    },
    fetchImpl: async () => new Response('{}', { status: 200 })
  });
  await new Promise((resolve) => tokenServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${tokenServer.address().port}/api/providers`;
  try {
    const unauthorized = await fetch(url);
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error, 'The AI proxy access token is missing or invalid.');

    const authorized = await fetch(url, {
      headers: { Authorization: 'Bearer private-test-token' }
    });
    assert.equal(authorized.status, 200);
    assert.equal(JSON.stringify(await authorized.json()).includes('private-test-token'), false);
  } finally {
    await new Promise((resolve, reject) => tokenServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('rejects untrusted origins and malformed provider requests', async () => {
  const badOrigin = await fetch(`${baseUrl}/api/providers`, {
    headers: { Origin: 'https://untrusted.example' }
  });
  assert.equal(badOrigin.status, 403);

  const badRequest = await fetch(`${baseUrl}/api/chat/completions`, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:8000',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      provider: 'https://attacker.example',
      model: 'test/model',
      messages: [{ role: 'user', content: 'test' }]
    })
  });
  assert.equal(badRequest.status, 400);
});

test('allows explicitly configured HTTPS web origins', async () => {
  const configuredServer = createAiProxyServer({
    environment: { AI_PROXY_ALLOWED_ORIGINS: 'https://budget.example' }
  });
  await new Promise((resolve) => configuredServer.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${configuredServer.address().port}/api/providers`, {
      headers: { Origin: 'https://budget.example' }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://budget.example');
  } finally {
    await new Promise((resolve, reject) => configuredServer.close((error) => error ? reject(error) : resolve()));
  }
});
