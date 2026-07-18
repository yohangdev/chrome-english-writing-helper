/**
 * Background service worker (classic). Holds the API key, builds requests, and
 * fetches the LLM — keeping the key out of page context and bypassing page CORS.
 * Streams deltas back to the content script over a long-lived Port.
 */
importScripts(
  'utils/storage.js',
  'utils/providers.js',
  'utils/prompts.js',
  'utils/llm.js'
);

const IDLE_TIMEOUT_MS = 60000;

function isLocal(baseURL) {
  return /localhost|127\.0\.0\.1|\[::1\]/i.test(baseURL || '');
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'rewrite') return;
  let controller = null;
  let idleTimer = null;

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  port.onMessage.addListener(async (msg) => {
    if (!msg) return;
    if (msg.type === 'cancel') {
      if (controller) controller.abort();
      return;
    }
    if (msg.type !== 'run') return;

    controller = new AbortController();
    try {
      const profile = await LH.storage.getActiveProfile();
      if (!profile || !LH.providers.normalizeBaseURL(profile.baseURL)) {
        port.postMessage({ type: 'error', error: 'No provider configured. Open the extension options and set a Base URL, model, and API key.' });
        return;
      }
      if (profile.authStyle === 'bearer' && !profile.apiKey && !isLocal(profile.baseURL)) {
        port.postMessage({ type: 'error', error: 'Missing API key. Add it in the extension options.' });
        return;
      }

      const settings = await LH.storage.getSettings();
      const stream = settings.streaming !== false;
      const messages = LH.prompts.buildMessages(msg.mode, msg.text, msg.tone);
      const temperature =
        profile.temperature != null ? profile.temperature : (LH.prompts.TEMPS[msg.mode] ?? 0.4);

      const resetIdle = () => {
        clearIdle();
        idleTimer = setTimeout(
          () => controller.abort(new DOMException('timeout', 'TimeoutError')),
          IDLE_TIMEOUT_MS
        );
      };
      resetIdle();

      const full = await LH.llm.runCompletion({
        profile,
        messages,
        temperature,
        stream,
        signal: controller.signal,
        onDelta: (d) => {
          resetIdle();
          try {
            port.postMessage({ type: 'delta', text: d });
          } catch {
            /* port closed */
          }
        },
      });

      clearIdle();
      port.postMessage({ type: 'done', text: LH.prompts.cleanOutput(full) });
    } catch (e) {
      clearIdle();
      const aborted = e && e.name === 'AbortError';
      try {
        port.postMessage({
          type: 'error',
          aborted: !!aborted,
          error: aborted ? 'Cancelled.' : (e && e.message) || String(e),
        });
      } catch {
        /* port closed */
      }
    }
  });

  port.onDisconnect.addListener(() => {
    clearIdle();
    if (controller) controller.abort();
  });
});

// One-shot "Test connection" from the options page.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'test') return;
  (async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);
    try {
      const out = await LH.llm.runCompletion({
        profile: msg.profile,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        temperature: 0,
        stream: false,
        signal: controller.signal,
      });
      sendResponse({ ok: true, sample: String(out || '').slice(0, 120) });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    } finally {
      clearTimeout(t);
    }
  })();
  return true; // keep the message channel open for the async response
});

// Clicking the toolbar icon opens options.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
