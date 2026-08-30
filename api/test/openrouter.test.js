import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import openrouter from '../coach/adapters/openrouter.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const reply = (body, status = 200) => new Response(
  typeof body === 'string' ? body : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } }
);

const invoke = (overrides = {}) => openrouter.invoke({
  prompt: 'System rules\n---\n\n## Payload\n\n```json\n{"hello":"world"}\n```',
  jobDir: '/tmp/unused',
  env: { OPENROUTER_API_KEY: 'sk-or-test' },
  model: 'openai/test-model',
  timeoutMs: 1000,
  ...overrides
});

test('OpenRouter sends a sufficient completion budget and separates rules from payload', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return reply({ choices: [{ message: { content: '{"coach_contract":1,"ok":true}' }, finish_reason: 'stop' }] });
  };

  const result = await invoke();
  assert.equal(result.code, 0);
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(request.body.model, 'openai/test-model');
  assert.equal(request.body.max_completion_tokens, 16384);
  assert.equal(Object.hasOwn(request.body, 'max_tokens'), false);
  assert.equal(request.body.messages[0].role, 'system');
  assert.equal(request.body.messages[0].content, 'System rules');
  assert.equal(request.body.messages[1].role, 'user');
  assert.equal(request.body.messages[1].content, '{"hello":"world"}');
  assert.equal(request.init.headers['X-Title'], 'openGym Coach');
});

test('OpenRouter accepts text-part arrays returned by compatible providers', async () => {
  globalThis.fetch = async () => reply({
    choices: [{ message: { content: [{ type: 'text', text: '{"ok":' }, { type: 'text', text: 'true}' }] }, finish_reason: 'stop' }]
  });
  const result = await invoke();
  assert.equal(result.code, 0);
  assert.equal(result.text, '{"ok":true}');
});

test('OpenRouter reports a truncated completion instead of paying for a futile repair', async () => {
  globalThis.fetch = async () => reply({
    choices: [{ message: { content: '{"coach_contract":1' }, finish_reason: 'length' }]
  });
  const result = await invoke();
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'model stopped early: length');
  assert.equal(result.spawnError, false);
});

test('OpenRouter reports an empty successful response as a provider failure', async () => {
  globalThis.fetch = async () => reply({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
  const result = await invoke();
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'OpenRouter returned an empty assistant message');
});

test('OpenRouter surfaces the provider message from an API error envelope', async () => {
  globalThis.fetch = async () => reply({ error: { code: 402, message: 'Insufficient credits' } }, 402);
  const result = await invoke();
  assert.equal(result.code, 402);
  assert.equal(result.stderr, 'OpenRouter API returned 402: Insufficient credits');
});
