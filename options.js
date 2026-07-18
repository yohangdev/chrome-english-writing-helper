/**
 * Options page logic. Uses globalThis.LH.storage + LH.providers (loaded via
 * <script> tags before this file).
 */
(function () {
  const LH = globalThis.LH;
  const $ = (id) => document.getElementById(id);

  let settings = null;
  let currentId = null;

  function genId() {
    return 'p_' + Math.abs(hash(Date.now() + ':' + Math.floor(performance.now()))).toString(36);
  }
  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return h;
  }

  function currentProfile() {
    return settings.profiles.find((p) => p.id === currentId) || settings.profiles[0];
  }

  // ---- Render ---------------------------------------------------------------

  function renderPresets() {
    const sel = $('preset');
    sel.innerHTML = '';
    for (const p of LH.providers.PRESETS) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      sel.appendChild(o);
    }
  }

  function renderProfileSelect() {
    const sel = $('profileSelect');
    sel.innerHTML = '';
    for (const p of settings.profiles) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name || '(unnamed)';
      if (p.id === currentId) o.selected = true;
      sel.appendChild(o);
    }
  }

  function renderForm() {
    const p = currentProfile();
    $('name').value = p.name || '';
    $('baseURL').value = p.baseURL || '';
    $('apiKey').value = p.apiKey || '';
    $('model').value = p.model || '';
    $('authStyle').value = p.authStyle || 'bearer';
    $('azureApiVersion').value = p.azureApiVersion || '';
    $('temperature').value = p.temperature == null ? '' : p.temperature;
    $('azureRow').hidden = (p.authStyle || 'bearer') !== 'azure-api-key';
    $('streaming').checked = settings.streaming !== false;
  }

  function renderTones() {
    const ul = $('tones');
    ul.innerHTML = '';
    settings.tones.forEach((t, i) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'tone-label';
      label.textContent = t.description ? `${t.name} — ${t.description}` : t.name;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ghost small danger';
      del.textContent = 'Remove';
      del.addEventListener('click', async () => {
        settings.tones.splice(i, 1);
        await LH.storage.setSettings({ tones: settings.tones });
        renderTones();
      });
      li.append(label, del);
      ul.appendChild(li);
    });
  }

  // ---- Form → profile -------------------------------------------------------

  function readForm() {
    const p = currentProfile();
    p.name = $('name').value.trim() || 'Provider';
    p.baseURL = $('baseURL').value.trim();
    p.apiKey = $('apiKey').value;
    p.model = $('model').value.trim();
    p.authStyle = $('authStyle').value;
    p.azureApiVersion = $('azureApiVersion').value.trim();
    const temp = $('temperature').value.trim();
    p.temperature = temp === '' ? null : Number(temp);
    return p;
  }

  function setStatus(text, kind) {
    const s = $('status');
    s.textContent = text || '';
    s.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ---- Actions --------------------------------------------------------------

  async function onSave() {
    const p = readForm();
    settings.activeProfileId = currentId;
    settings.streaming = $('streaming').checked;
    await LH.storage.setSettings({
      profiles: settings.profiles,
      activeProfileId: settings.activeProfileId,
      streaming: settings.streaming,
    });
    renderProfileSelect();

    // Request host permission for the provider's origin (needs a user gesture).
    const pattern = LH.providers.originPatternFor(p.baseURL);
    if (pattern) {
      try {
        const granted = await chrome.permissions.request({ origins: [pattern] });
        setStatus(
          granted
            ? 'Saved. Host permission granted.'
            : 'Saved, but host permission was denied — requests to ' + pattern + ' will fail until granted.',
          granted ? 'ok' : 'warn'
        );
      } catch (e) {
        setStatus('Saved. (Could not request host permission: ' + (e.message || e) + ')', 'warn');
      }
    } else {
      setStatus('Saved, but the Base URL looks invalid.', 'warn');
    }
  }

  async function onTest() {
    const p = readForm();
    setStatus('Testing…');
    try {
      const pattern = LH.providers.originPatternFor(p.baseURL);
      if (pattern) {
        // Ensure we have permission before the background tries to fetch.
        const has = await chrome.permissions.contains({ origins: [pattern] });
        if (!has) await chrome.permissions.request({ origins: [pattern] });
      }
      const resp = await chrome.runtime.sendMessage({ type: 'test', profile: p });
      if (resp && resp.ok) setStatus('OK — provider responded: "' + resp.sample + '"', 'ok');
      else setStatus('Failed: ' + ((resp && resp.error) || 'no response'), 'err');
    } catch (e) {
      setStatus('Failed: ' + (e.message || e), 'err');
    }
  }

  function onPreset() {
    const name = $('preset').value;
    const preset = LH.providers.PRESETS.find((x) => x.name === name);
    if (!preset || preset.name === 'Custom') return;
    $('baseURL').value = preset.baseURL;
    $('model').value = preset.model;
    $('authStyle').value = preset.authStyle;
    $('azureRow').hidden = preset.authStyle !== 'azure-api-key';
    if (!$('name').value.trim() || isPresetName($('name').value)) $('name').value = preset.name;
  }

  function isPresetName(n) {
    return LH.providers.PRESETS.some((p) => p.name === n);
  }

  function onNewProfile() {
    const p = LH.storage.defaultProfile();
    p.id = genId();
    p.name = 'New provider';
    p.apiKey = '';
    settings.profiles.push(p);
    currentId = p.id;
    renderProfileSelect();
    renderForm();
    setStatus('New profile — fill in details and Save.');
  }

  async function onDeleteProfile() {
    if (settings.profiles.length <= 1) {
      setStatus('Cannot delete the last profile.', 'warn');
      return;
    }
    settings.profiles = settings.profiles.filter((p) => p.id !== currentId);
    currentId = settings.profiles[0].id;
    settings.activeProfileId = currentId;
    await LH.storage.setSettings({ profiles: settings.profiles, activeProfileId: currentId });
    renderProfileSelect();
    renderForm();
    setStatus('Profile deleted.');
  }

  async function onAddTone() {
    const name = $('toneName').value.trim();
    const desc = $('toneDesc').value.trim();
    if (!name) return;
    settings.tones.push({ name, description: desc });
    await LH.storage.setSettings({ tones: settings.tones });
    $('toneName').value = '';
    $('toneDesc').value = '';
    renderTones();
  }

  // ---- Wire up --------------------------------------------------------------

  async function init() {
    settings = await LH.storage.getSettings();
    currentId = settings.activeProfileId;

    renderPresets();
    renderProfileSelect();
    renderForm();
    renderTones();
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;

    $('profileSelect').addEventListener('change', (e) => {
      currentId = e.target.value;
      renderForm();
      setStatus('');
    });
    $('preset').addEventListener('change', onPreset);
    $('authStyle').addEventListener('change', () => {
      $('azureRow').hidden = $('authStyle').value !== 'azure-api-key';
    });
    $('toggleKey').addEventListener('click', () => {
      const k = $('apiKey');
      const show = k.type === 'password';
      k.type = show ? 'text' : 'password';
      $('toggleKey').textContent = show ? 'Hide' : 'Show';
    });
    $('save').addEventListener('click', onSave);
    $('test').addEventListener('click', onTest);
    $('newProfile').addEventListener('click', onNewProfile);
    $('deleteProfile').addEventListener('click', onDeleteProfile);
    $('addTone').addEventListener('click', onAddTone);
    $('streaming').addEventListener('change', async () => {
      await LH.storage.setSettings({ streaming: $('streaming').checked });
    });
  }

  init();
})();
