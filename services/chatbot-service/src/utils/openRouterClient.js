const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Second hop of the chatbot chain. chatbot-service keeps its OWN
 * OPENROUTER_API_KEY / OPENROUTER_MODEL - it does not reach into
 * search-service's config.
 *
 * Returns the assistant's reply text, or throws. Callers treat any throw
 * (no key, timeout, non-2xx, empty content) as "no AI reply available"
 * and fall back to a plain templated answer - the chatbot still works
 * without a key, same "degrade, don't crash" approach as the rest of the
 * app's AI features.
 */
async function generateReply(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }
  const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let res;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 400 }),
        signal: controller.signal
      });
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'OpenRouter request timed out' : err.message);
    }

    if (!res.ok) {
      throw new Error(`OpenRouter returned HTTP ${res.status}`);
    }

    const body = await res.json();
    const content = body && body.choices && body.choices[0] && body.choices[0].message
      && body.choices[0].message.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('OpenRouter response had no content');
    }
    return content.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { generateReply };
