/**
 * Toolbar popup — a fallback UI for when the in-page floating button isn't
 * available. Grabs the page selection (or accepts pasted text), runs the same
 * background LLM pipeline, and offers Copy + best-effort Apply-to-page.
 */
(function () {
  const LH = globalThis.LH;
  const $ = (id) => document.getElementById(id);

  let tabId = null;
  let captured = false; // did we pull a selection the content script can apply to?
  let resultText = '';
  let sourceText = '';
  let port = null;

  async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab ? tab.id : null;
    } catch { /* ignore */ }

    const settings = await LH.storage.getSettings();
    const sel = $('tone');
    for (const t of settings.tones) {
      const o = document.createElement('option');
      o.value = t.name;
      o.textContent = t.name;
      if (t.name === settings.lastTone) o.selected = true;
      sel.appendChild(o);
    }

    wire();
    await grab();
    $('input').addEventListener('input', () => {
      // Manual edits mean we can no longer map back to the page selection.
      captured = false;
      updateApply();
    });
  }

  function wire() {
    $('grab').addEventListener('click', grab);
    $('grammar').addEventListener('click', () => run('grammar'));
    $('polish').addEventListener('click', () => run('polish'));
    $('rewrite').addEventListener('click', () => run('style', $('tone').value));
    $('copy').addEventListener('click', onCopy);
    $('apply').addEventListener('click', onApply);
    $('options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });
  }

  async function grab() {
    if (tabId == null) {
      setStatus('No active tab.');
      return;
    }
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'lh-capture' }, { frameId: 0 });
      if (resp && resp.text) {
        $('input').value = resp.text;
        captured = true;
        setStatus('Loaded selection from the page.');
      } else {
        captured = false;
        setStatus('No text selected on the page — paste text below.');
      }
    } catch {
      // No content script on this page (chrome://, PDF, file:// without access…).
      captured = false;
      setStatus('This page can’t be edited directly — paste text and use Copy.');
    }
    updateApply();
  }

  function run(mode, tone) {
    sourceText = $('input').value.trim();
    if (!sourceText) {
      setStatus('Enter or grab some text first.');
      return;
    }
    resultText = '';
    setResultPlain('');
    setStatus(tone ? `Rewriting (${tone})…` : mode === 'grammar' ? 'Fixing grammar…' : 'Polishing…');
    setBusy(true);

    cleanupPort();
    port = chrome.runtime.connect({ name: 'rewrite' });
    port.onMessage.addListener((m) => {
      if (!m) return;
      if (m.type === 'delta') {
        resultText += m.text;
        setResultPlain(resultText);
      } else if (m.type === 'done') {
        resultText = m.text || resultText;
        renderDiff(sourceText, resultText);
        setStatus('');
        setBusy(false);
        cleanupPort();
      } else if (m.type === 'error') {
        setStatus(m.error || 'Error.');
        setBusy(false);
        cleanupPort();
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
    });
    port.postMessage({ type: 'run', mode, tone, text: sourceText });
  }

  function cleanupPort() {
    try {
      if (port) port.disconnect();
    } catch { /* ignore */ }
    port = null;
  }

  async function onCopy() {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
      setStatus('Copied to clipboard.');
    } catch {
      setStatus('Copy failed.');
    }
  }

  async function onApply() {
    if (!resultText || tabId == null) return;
    if (!captured) {
      await onCopy();
      setStatus('No live selection to replace — copied instead.');
      return;
    }
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'lh-apply', text: resultText }, { frameId: 0 });
      if (resp && resp.ok) {
        setStatus('Applied to the page.');
        window.setTimeout(() => window.close(), 500);
      } else {
        await onCopy();
        setStatus('Could not edit that field inline — copied instead. Paste manually.');
      }
    } catch {
      await onCopy();
      setStatus('Page not editable here — copied instead.');
    }
  }

  // ---- UI helpers ----------------------------------------------------------

  function setStatus(text) {
    $('status').textContent = text || '';
  }

  function setResultPlain(text) {
    const r = $('result');
    r.textContent = text;
    r.classList.remove('has-diff');
  }

  function renderDiff(original, result) {
    const r = $('result');
    r.textContent = '';
    r.classList.add('has-diff');
    const ops = LH.diff.diffWords(original, result);
    for (const op of ops) {
      const span = document.createElement('span');
      if (op.type === 'insert') span.className = 'ins';
      else if (op.type === 'delete') span.className = 'del';
      span.textContent = op.text;
      r.appendChild(span);
    }
    $('copy').disabled = false;
    updateApply();
  }

  function setBusy(busy) {
    for (const id of ['grammar', 'polish', 'rewrite', 'grab']) $(id).disabled = busy;
    if (busy) {
      $('copy').disabled = true;
      $('apply').disabled = true;
    }
  }

  function updateApply() {
    $('apply').disabled = !(resultText && captured);
    $('apply').title = captured
      ? 'Replace the page selection'
      : 'No live page selection — use Copy';
  }

  init();
})();
