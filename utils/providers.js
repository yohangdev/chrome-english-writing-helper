/**
 * Provider presets + request-shape helpers. Classic script → globalThis.LH.providers.
 * Used by the options page (dropdown presets) and the background SW (build request).
 */
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  /**
   * Preset base URLs. Store the base URL INCLUDING the version segment; we append
   * "/chat/completions". Getting this wrong is the #1 cause of 404s (esp. Groq's
   * "/openai/v1"). Azure is the outlier: different auth header + api-version + the
   * deployment name goes in the path (handled in buildRequest via authStyle).
   */
  const PRESETS = [
    { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', authStyle: 'bearer' },
    { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', authStyle: 'bearer' },
    { name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', authStyle: 'bearer' },
    { name: 'Ollama (local)', baseURL: 'http://localhost:11434/v1', model: 'llama3.1', authStyle: 'bearer' },
    { name: 'LM Studio (local)', baseURL: 'http://localhost:1234/v1', model: 'local-model', authStyle: 'bearer' },
    { name: 'Azure OpenAI', baseURL: 'https://YOUR-RESOURCE.openai.azure.com', model: 'YOUR-DEPLOYMENT', authStyle: 'azure-api-key' },
    { name: 'Custom', baseURL: '', model: '', authStyle: 'bearer' },
  ];

  /** Normalize a base URL: trim, drop a trailing slash. */
  function normalizeBaseURL(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  /**
   * Build the endpoint URL + headers + whether to put `model` in the body.
   * Returns { url, headers, modelInBody }.
   */
  function buildRequestMeta(profile) {
    const base = normalizeBaseURL(profile.baseURL);
    const headers = { 'Content-Type': 'application/json' };

    if (profile.authStyle === 'azure-api-key') {
      // Classic Azure style: {base}/openai/deployments/{deployment}/chat/completions?api-version=...
      const apiVersion = (profile.azureApiVersion || '2025-04-01-preview').trim();
      const deployment = encodeURIComponent(profile.model);
      const url = `${base}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
      if (profile.apiKey) headers['api-key'] = profile.apiKey;
      return { url, headers, modelInBody: false };
    }

    // OpenAI-compatible (OpenAI, OpenRouter, Groq, Ollama, LM Studio, …)
    const url = `${base}/chat/completions`;
    if (profile.apiKey) headers['Authorization'] = `Bearer ${profile.apiKey}`;
    // OpenRouter attribution headers (harmless elsewhere; some setups ignore them).
    if (/openrouter\.ai/i.test(base)) {
      headers['HTTP-Referer'] = 'https://github.com/local/english-writing-helper';
      headers['X-Title'] = 'English Writing Helper';
    }
    return { url, headers, modelInBody: true };
  }

  /**
   * Extract the origin match-pattern for chrome.permissions.request, e.g.
   * "https://openrouter.ai/*". Match patterns must NOT include a port, so a port
   * (e.g. Ollama's :11434) is intentionally dropped — the pattern still grants it.
   */
  function originPatternFor(baseURL) {
    try {
      const u = new URL(normalizeBaseURL(baseURL));
      return `${u.protocol}//${u.hostname}/*`;
    } catch {
      return null;
    }
  }

  LH.providers = { PRESETS, normalizeBaseURL, buildRequestMeta, originPatternFor };
})();
