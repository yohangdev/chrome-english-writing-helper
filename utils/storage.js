/**
 * Storage layer. Classic script — attaches to globalThis.LH.storage.
 * Works in content script, service worker, and options page.
 *
 * Everything (including the API key) lives in chrome.storage.local — NEVER
 * chrome.storage.sync, which would upload the secret key to Google's servers.
 * Note: no chrome.storage area is encrypted at rest.
 */
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  const STORAGE_KEY = 'settings';

  /** Default tone presets offered in the "Rewrite as…" submenu. */
  const DEFAULT_TONES = [
    { name: 'Friendly', description: 'warm, approachable, personable' },
    { name: 'Formal', description: 'professional, precise, respectful' },
    { name: 'Casual', description: 'relaxed, conversational, informal' },
    { name: 'Professional', description: 'clear, businesslike, confident' },
    { name: 'Concise', description: 'shorter and to the point' },
  ];

  /** Built-in default profile so the extension works out of the box. */
  function defaultProfile() {
    return {
      id: 'default',
      name: 'OpenRouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '',
      model: 'openai/gpt-4o-mini',
      authStyle: 'bearer', // 'bearer' | 'azure-api-key'
      temperature: null, // null → use per-mode default
      azureApiVersion: '',
    };
  }

  function defaults() {
    return {
      profiles: [defaultProfile()],
      activeProfileId: 'default',
      tones: DEFAULT_TONES.slice(),
      streaming: true,
      lastMode: 'grammar',
      lastTone: 'Friendly',
    };
  }

  /** Shallow-merge stored settings over defaults; guarantee a valid shape. */
  async function getSettings() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const base = defaults();
    const s = Object.assign(base, stored[STORAGE_KEY] || {});
    if (!Array.isArray(s.profiles) || s.profiles.length === 0) {
      s.profiles = [defaultProfile()];
    }
    if (!Array.isArray(s.tones) || s.tones.length === 0) s.tones = DEFAULT_TONES.slice();
    if (!s.profiles.some((p) => p.id === s.activeProfileId)) {
      s.activeProfileId = s.profiles[0].id;
    }
    return s;
  }

  async function setSettings(patch) {
    const current = await getSettings();
    const next = Object.assign(current, patch);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  }

  async function getActiveProfile() {
    const s = await getSettings();
    return s.profiles.find((p) => p.id === s.activeProfileId) || s.profiles[0];
  }

  LH.storage = {
    STORAGE_KEY,
    DEFAULT_TONES,
    defaultProfile,
    defaults,
    getSettings,
    setSettings,
    getActiveProfile,
  };
})();
