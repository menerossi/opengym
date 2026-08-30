/* OpenRouter API adapter.
 *
 * Unlike the CLI-based adapters (Claude Agent SDK, Codex CLI), this adapter
 * calls the OpenRouter REST API directly over HTTPS. It is OpenAI-compatible,
 * so the chat completions format is standard. The API key travels only through
 * the unprivileged job environment and is never exposed to any other process.
 *
 * Because there is no local binary to check, `check()` performs a lightweight
 * model-list probe to verify the credential and network path. */

const BASE_URL = 'https://openrouter.ai/api/v1';
const TIMEOUT_SOFT = 4 * 60 * 1000; // hard timeout is enforced by the caller
// Reasoning tokens count against this budget on OpenRouter. A complete plan with per-exercise
// rationales can legitimately exceed 4k even when the visible JSON is much smaller.
const MAX_COMPLETION_TOKENS = 16 * 1024;

function requestBody(model, messages, structured = true) {
  return {
    model: model || undefined,  // undefined = OpenRouter uses the account's configured default
    messages,
    temperature: 0,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    // JSON mode materially reduces fenced, conversational and partially-structured answers.
    // It is intentionally the portable json_object mode rather than a provider-specific JSON
    // schema: OpenRouter can route one configured model through several upstream providers.
    ...(structured ? { response_format: { type: 'json_object' } } : {}),
    // Some OpenRouter models default to spending most of the completion budget on hidden
    // reasoning (up to ~95% at max effort). The Coach needs a complete JSON document more
    // than a long chain of thought, so leave the model a predictable majority for output.
    reasoning: { effort: 'minimal', exclude: true }
  };
}

function responseFormatUnsupported(status, raw) {
  if (![400, 404, 422].includes(status)) return false;
  return /response[_ -]?format|json[_ -]?(?:object|mode)|structured output/i.test(String(raw || '')) &&
    /unsupported|not support|invalid|unknown|unrecognized|not available/i.test(String(raw || ''));
}

function errorDetail(status, raw) {
  try {
    const parsed = JSON.parse(raw);
    const message = parsed?.error?.message || parsed?.error || parsed?.message;
    if (message) return `OpenRouter API returned ${status}: ${String(message).slice(0, 400)}`;
  } catch { /* preserve the raw provider response below */ }
  return `OpenRouter API returned ${status}: ${String(raw || '').slice(0, 400)}`;
}

function messageText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(part => typeof part === 'string' ? part : part?.text || '').join('').trim();
  }
  return '';
}

/** Build OpenAI-compatible messages from the Coach's text prompt. */
function toMessages(prompt) {
  // The Coach prompt is a plain-text document. Split it so the system preamble
  // (rules, hard constraints) stays in the system message and the dynamic
  // per-request payload lands in the user message.
  const sep = '\n---\n\n## Payload\n\n';
  const idx = prompt.indexOf(sep);
  if (idx < 0) {
    // No structured split found — send everything as a user message.
    return [
      { role: 'system', content: 'You are the openGym Coach. Output only valid JSON.' },
      { role: 'user', content: prompt }
    ];
  }
  return [
    { role: 'system', content: prompt.slice(0, idx) },
    { role: 'user', content: prompt.slice(idx + sep.length).replace(/^```json\s*/, '').replace(/```\s*$/, '').trim() }
  ];
}

export default {
  id: 'openrouter',

  async check(cfg, env) {
    const key = env.OPENROUTER_API_KEY;
    if (!key) return { ok: false, error: 'no OpenRouter API key in the job environment' };

    try {
      const res = await fetch(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${key}` }
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: errorDetail(res.status, body) };
      }
      const body = await res.json();
      if (!body?.data?.length) return { ok: false, error: 'OpenRouter returned an empty model list' };
      return { ok: true, version: `OpenRouter API (${body.data.length} models available)` };
    } catch (e) {
      return { ok: false, error: `cannot reach OpenRouter: ${e.message}` };
    }
  },

  async invoke({ prompt, jobDir, env, model, timeoutMs, signal }) {
    const key = env.OPENROUTER_API_KEY;
    if (!key) {
      return { code: -1, text: '', stderr: 'OPENROUTER_API_KEY is not set in the job environment', timedOut: false, spawnError: true };
    }

    const messages = toMessages(prompt);
    const timeout = Math.min(timeoutMs || TIMEOUT_SOFT, TIMEOUT_SOFT);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), timeout);

    let text = '', stderr = '', timedOut = false;
    try {
      const send = structured => fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'X-Title': 'openGym Coach'
        },
        body: JSON.stringify(requestBody(model, messages, structured)),
        signal: controller.signal
      });

      let res = await send(true);

      if (!res.ok) {
        let errBody = await res.text().catch(() => '');
        // A few upstream models do not implement JSON mode. The first request failed before
        // generation, so retrying once without that optional capability does not duplicate a
        // paid completion and retains the prompt-only behaviour older installations had.
        if (responseFormatUnsupported(res.status, errBody)) {
          res = await send(false);
          if (res.ok) errBody = '';
          else errBody = await res.text().catch(() => '');
        }
        if (res.ok) {
          // Continue through the normal response parsing below.
        } else {
          stderr = errorDetail(res.status, errBody);
          return { code: res.status, text: '', stderr, timedOut: false, spawnError: false };
        }
      }

      const data = await res.json();
      const choice = data?.choices?.[0];
      if (!choice) {
        stderr = 'OpenRouter returned no choices in the response';
        return { code: 1, text: '', stderr, timedOut: false, spawnError: false };
      }

      text = messageText(choice.message?.content);
      const finish = choice.finish_reason;
      if (finish && finish !== 'stop' && finish !== 'end_turn') {
        stderr = `model stopped early: ${finish}`;
        // A truncated object cannot pass validation. Reporting a provider failure here avoids
        // spending a second paid request trying to repair output under the same hard limit.
        return { code: 1, text, stderr, timedOut: false, spawnError: false };
      }
      if (!text) {
        stderr = 'OpenRouter returned an empty assistant message';
        return { code: 1, text: '', stderr, timedOut: false, spawnError: false };
      }

      return { code: 0, text, stderr, timedOut: false, spawnError: false };
    } catch (e) {
      if (e.name === 'AbortError') {
        timedOut = true;
        return { code: -1, text: '', stderr: 'OpenRouter request timed out', timedOut: true, spawnError: false };
      }
      stderr = `OpenRouter fetch failed: ${e.message}`;
      return { code: -1, text: '', stderr, timedOut: false, spawnError: true };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
};
