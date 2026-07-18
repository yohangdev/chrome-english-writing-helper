/**
 * OpenAI-compatible chat client. Classic script → globalThis.LH.llm.
 * Runs in the background service worker (owns the fetch → no CORS, key stays out
 * of the page). Supports streaming (SSE) and non-streaming.
 */
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  class LLMError extends Error {
    constructor(message, status, url) {
      super(message);
      this.name = 'LLMError';
      this.status = status;
      this.url = url;
    }
  }

  const sleep = (ms) =>
    new Promise((resolve) => {
      const id = setInterval(() => {
        clearInterval(id);
        resolve();
      }, ms);
    });

  /** Map an HTTP error into a friendly, actionable message. */
  async function toError(res, url) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || body?.message || '';
    } catch {
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
    }
    const s = res.status;
    let msg;
    if (s === 401 || s === 403) msg = 'Authentication failed — check your API key.';
    else if (s === 404) msg = `Endpoint not found (404). Check the Base URL / model:\n${url}`;
    else if (s === 429) msg = 'Rate limited (429). Try again shortly.';
    else if (s >= 500) msg = `Provider error (${s}). Try again shortly.`;
    else msg = `Request failed (${s}).`;
    if (detail) msg += `\n${detail}`;
    return new LLMError(msg, s, url);
  }

  /**
   * @param {object} opts
   * @param {object} opts.profile   active provider profile
   * @param {Array}  opts.messages  chat messages
   * @param {number} opts.temperature
   * @param {boolean} opts.stream
   * @param {AbortSignal} opts.signal
   * @param {(delta:string)=>void=} opts.onDelta  called per streamed token chunk
   * @returns {Promise<string>} full completion text
   */
  async function runCompletion(opts) {
    const { profile, messages, temperature, stream, signal, onDelta } = opts;
    const { url, headers, modelInBody } = LH.providers.buildRequestMeta(profile);

    const body = { messages, temperature };
    if (modelInBody) body.model = profile.model;
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: false };
    }

    const maxAttempts = 3;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        });

        if (!res.ok) {
          const err = await toError(res, url);
          // Retry only transient failures.
          if ((err.status === 429 || err.status >= 500) && attempt < maxAttempts) {
            const retryAfter = Number(res.headers.get('retry-after'));
            const backoff = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(200 * attempt);
            await sleep(backoff);
            lastErr = err;
            continue;
          }
          throw err;
        }

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        // Only parse as SSE if we asked to stream AND the server actually streams.
        if (stream && ct.includes('text/event-stream')) return await readStream(res, onDelta);
        return await readJson(res);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        if (e instanceof LLMError && !(e.status === 429 || e.status >= 500)) throw e;
        lastErr = e;
        if (attempt >= maxAttempts) throw e;
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }
    throw lastErr || new LLMError('Request failed.', 0, url);
  }

  async function readJson(res) {
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return text == null ? '' : String(text);
  }

  /** Parse an SSE (text/event-stream) body, emitting deltas. */
  async function readStream(res, onDelta) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // keep incomplete trailing fragment
      for (const part of parts) {
        // A part may contain multiple lines; find the data: payload.
        for (const line of part.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return full;
          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              if (onDelta) onDelta(delta);
            }
          } catch {
            /* keep-alive / comment line — ignore */
          }
        }
      }
    }
    return full;
  }

  LH.llm = { runCompletion, LLMError };
})();
