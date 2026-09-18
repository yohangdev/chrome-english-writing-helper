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
  const BACKUP_FORMAT = 'english-writing-helper-backup';
  const BACKUP_VERSION = 1;

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

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function invalidBackup(message) {
    return new Error('Invalid backup: ' + message);
  }

  function optionalString(value, fallback, label) {
    if (value == null) return fallback;
    if (typeof value !== 'string') throw invalidBackup(label + ' must be a string.');
    return value;
  }

  /** Validate imported data and copy only fields understood by this version. */
  function normalizeBackupSettings(value) {
    if (!isObject(value)) throw invalidBackup('settings are missing.');
    if (!Array.isArray(value.profiles) || value.profiles.length === 0) {
      throw invalidBackup('at least one provider profile is required.');
    }

    const ids = new Set();
    const profiles = value.profiles.map((profile, index) => {
      const label = `profile ${index + 1}`;
      if (!isObject(profile)) throw invalidBackup(label + ' must be an object.');

      const id = optionalString(profile.id, '', label + ' id').trim();
      if (!id) throw invalidBackup(label + ' has no id.');
      if (ids.has(id)) throw invalidBackup(`profile id "${id}" is duplicated.`);
      ids.add(id);

      const authStyle = optionalString(profile.authStyle, 'bearer', label + ' auth style');
      if (authStyle !== 'bearer' && authStyle !== 'azure-api-key') {
        throw invalidBackup(label + ' has an unsupported auth style.');
      }

      let temperature = profile.temperature;
      if (temperature == null) {
        temperature = null;
      } else if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        throw invalidBackup(label + ' has an invalid temperature.');
      }

      return {
        id,
        name: optionalString(profile.name, 'Provider', label + ' name'),
        baseURL: optionalString(profile.baseURL, '', label + ' Base URL'),
        apiKey: optionalString(profile.apiKey, '', label + ' API key'),
        model: optionalString(profile.model, '', label + ' model'),
        authStyle,
        temperature,
        azureApiVersion: optionalString(profile.azureApiVersion, '', label + ' Azure API version'),
      };
    });

    if (!Array.isArray(value.tones) || value.tones.length === 0) {
      throw invalidBackup('at least one style preset is required.');
    }
    const tones = value.tones.map((tone, index) => {
      const label = `style preset ${index + 1}`;
      if (!isObject(tone)) throw invalidBackup(label + ' must be an object.');
      const name = optionalString(tone.name, '', label + ' name').trim();
      if (!name) throw invalidBackup(label + ' has no name.');
      return {
        name,
        description: optionalString(tone.description, '', label + ' description'),
      };
    });

    const activeProfileId = ids.has(value.activeProfileId)
      ? value.activeProfileId
      : profiles[0].id;
    const requestedTone = optionalString(value.lastTone, tones[0].name, 'last tone');

    return {
      profiles,
      activeProfileId,
      tones,
      streaming: value.streaming !== false,
      lastMode: value.lastMode === 'style' ? 'style' : 'grammar',
      lastTone: tones.some((tone) => tone.name === requestedTone) ? requestedTone : tones[0].name,
    };
  }

  /** Build a portable, versioned backup. API keys are opt-in because JSON is plaintext. */
  function createBackup(settings, options = {}) {
    const normalized = normalizeBackupSettings(settings);
    const includeApiKeys = options.includeApiKeys === true;
    if (!includeApiKeys) {
      normalized.profiles = normalized.profiles.map((profile) => ({ ...profile, apiKey: '' }));
    }

    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      includesApiKeys: includeApiKeys,
      settings: normalized,
    };
    if (options.extensionVersion) backup.extensionVersion = String(options.extensionVersion);
    return backup;
  }

  /** Parse a backup envelope and return validated settings plus display metadata. */
  function parseBackup(backup) {
    if (!isObject(backup) || backup.format !== BACKUP_FORMAT) {
      throw invalidBackup('this is not an English Writing Helper backup.');
    }
    if (backup.version !== BACKUP_VERSION) {
      throw invalidBackup(`unsupported backup version (${String(backup.version)}).`);
    }
    const settings = normalizeBackupSettings(backup.settings);
    return {
      settings,
      includesApiKeys: backup.includesApiKeys === true || settings.profiles.some((profile) => !!profile.apiKey),
      exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : '',
    };
  }

  /** Replace all extension settings with previously validated backup settings. */
  async function replaceSettings(value) {
    const settings = normalizeBackupSettings(value);
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    return settings;
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
    BACKUP_FORMAT,
    BACKUP_VERSION,
    DEFAULT_TONES,
    defaultProfile,
    defaults,
    createBackup,
    parseBackup,
    replaceSettings,
    getSettings,
    setSettings,
    getActiveProfile,
  };
})();
