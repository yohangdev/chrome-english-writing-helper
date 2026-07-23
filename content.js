/**
 * Content script entry. Renders the floating button + action menu + result panel
 * inside a Shadow DOM (style-isolated from the host page), captures the user's
 * selection, talks to the background SW over a Port, and applies the result.
 *
 * Depends (via manifest load order) on: LH.storage, LH.diff, LH.selection,
 * LH.replace, and the vendored helpers.
 */
(function () {
  const LH = globalThis.LH;
  if (!LH || !LH.selection) return;

  const DEBOUNCE_MS = 180;
  let host, shadow, btn, menu, panel;
  let desc = null; // captured selection descriptor
  let state = null; // { mode, tone, resultText, streaming }
  let port = null;
  let debounceTimer = null;

  // ---- UI construction -----------------------------------------------------

  function buildUI() {
    host = document.createElement('div');
    host.id = 'lh-writing-helper-host';
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    shadow = host.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content.css');
    shadow.appendChild(link);

    // Floating button
    btn = el('button', 'lh-btn');
    btn.type = 'button';
    btn.title = 'Writing helper';
    btn.textContent = '✨';
    btn.hidden = true;
    shadow.appendChild(btn);

    // Action menu
    menu = el('div', 'lh-menu');
    menu.hidden = true;
    shadow.appendChild(menu);

    // Result panel
    panel = el('div', 'lh-panel');
    panel.hidden = true;
    shadow.appendChild(panel);

    (document.body || document.documentElement).appendChild(host);

    // Keep the page selection alive: never let clicks on our UI blur the target.
    for (const node of [btn, menu, panel]) {
      node.addEventListener('mousedown', (e) => e.preventDefault());
    }
    btn.addEventListener('click', onBtnClick);
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function eventInsideUI(e) {
    const path = e.composedPath ? e.composedPath() : [];
    return path.includes(host);
  }

  // ---- Selection detection -------------------------------------------------

  function onSelectionActivity(e) {
    if (e && eventInsideUI(e)) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const d = LH.selection.capture();
      if (d) {
        desc = d;
        showButton(d.rect);
      } else if (menu.hidden) {
        hideButton();
      }
    }, DEBOUNCE_MS);
  }

  function showButton(rect) {
    const pad = 6;
    let left = rect.right + pad;
    let top = rect.bottom + pad;
    // Keep on-screen.
    left = Math.min(left, window.innerWidth - 44);
    top = Math.min(top, window.innerHeight - 44);
    btn.style.left = Math.max(4, left) + 'px';
    btn.style.top = Math.max(4, top) + 'px';
    btn.hidden = false;
  }

  function hideButton() {
    btn.hidden = true;
  }

  function hideMenu() {
    menu.hidden = true;
    menu.innerHTML = '';
  }

  // ---- Action menu ---------------------------------------------------------

  async function onBtnClick(e) {
    e.stopPropagation();
    if (!desc) return;
    await buildMenu();
    positionNear(menu, btn.getBoundingClientRect());
    menu.hidden = false;
    hideButton();
  }

  async function buildMenu() {
    menu.innerHTML = '';
    const settings = await LH.storage.getSettings();

    menu.appendChild(menuItem('Fix grammar', () => run('grammar')));
    menu.appendChild(menuItem('Polish', () => run('polish')));

    const toggle = menuItem('Rewrite as ▸', () => {
      tones.hidden = !tones.hidden;
    });
    toggle.classList.add('lh-sub-toggle');
    menu.appendChild(toggle);

    const tones = el('div', 'lh-tones');
    tones.hidden = true;
    for (const t of settings.tones) {
      tones.appendChild(
        menuItem(t.name, () => run('style', t.name), t.description)
      );
    }
    menu.appendChild(tones);
  }

  function menuItem(label, onClick, title) {
    const b = el('button', 'lh-menu-item');
    b.type = 'button';
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function positionNear(node, anchor) {
    node.hidden = false;
    node.style.visibility = 'hidden';
    const w = node.offsetWidth || 200;

    // For panels, use viewport-constrained height to prevent overflow during streaming
    let h = node.offsetHeight || 120;
    if (node.classList.contains('lh-panel')) {
      // Account for worst-case: panel could grow to max-height during streaming
      h = Math.min(400, window.innerHeight - 100);  // 400px max, keeps 100px margin from edges
    }

    const gap = 6;

    // Calculate horizontal position
    let left = anchor.left + gap;
    // If would overflow right edge, try left-aligning to anchor's right edge
    if (left + w > window.innerWidth - 8) {
      left = Math.max(8, anchor.right - w - gap);
    }
    // If still overflowing, clamp to right edge
    left = Math.min(left, window.innerWidth - w - 8);
    // Ensure minimum left margin
    left = Math.max(8, left);

    // Calculate vertical position
    let top = anchor.bottom + gap;
    // If would overflow bottom edge, flip to top
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, anchor.top - h - gap);
    }

    node.style.left = left + 'px';
    node.style.top = top + 'px';
    node.style.visibility = 'visible';
  }

  // ---- Run request ---------------------------------------------------------

  function run(mode, tone) {
    hideMenu();
    if (!desc) return;
    state = { mode, tone, resultText: '', streaming: true };
    openPanel(mode, tone);
    setStatus(tone ? `Rewriting (${tone})…` : mode === 'grammar' ? 'Fixing grammar…' : 'Polishing…');
    setResultPlain('');
    setActionsEnabled(false);

    try {
      if (port) port.disconnect();
    } catch { /* ignore */ }
    port = chrome.runtime.connect({ name: 'rewrite' });
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => {
      if (state && state.streaming) {
        setStatus('Connection closed.');
        state.streaming = false;
      }
    });
    port.postMessage({ type: 'run', mode, tone, text: desc.text });
  }

  function onPortMessage(msg) {
    if (!msg || !state) return;
    if (msg.type === 'delta') {
      state.resultText += msg.text;
      setResultPlain(state.resultText);
      setStatus('Generating…');
    } else if (msg.type === 'done') {
      state.streaming = false;
      state.resultText = msg.text || state.resultText;
      renderDiff(desc.text, state.resultText);
      setStatus('');
      setActionsEnabled(true);
      cleanupPort();
    } else if (msg.type === 'error') {
      state.streaming = false;
      setStatus(msg.error || 'Error.');
      if (!msg.aborted) setResultPlain(state.resultText || '');
      setActionsEnabled(!!state.resultText);
      cleanupPort();
    }
  }

  function cleanupPort() {
    try {
      if (port) port.disconnect();
    } catch { /* ignore */ }
    port = null;
  }

  // ---- Panel ---------------------------------------------------------------

  function openPanel(mode, tone) {
    panel.innerHTML = '';
    const head = el('div', 'lh-head');
    const title = el('span', 'lh-title');
    title.textContent = tone ? `Rewrite · ${tone}` : mode === 'grammar' ? 'Fix grammar' : 'Polish';
    const spacer = el('span', 'lh-spacer');
    const close = el('button', 'lh-x');
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close';
    close.addEventListener('click', closePanel);
    head.append(title, spacer, close);

    const body = el('div', 'lh-body');
    const legend = el('div', 'lh-legend');
    legend.innerHTML =
      '<span class="lh-chip lh-ins">added</span><span class="lh-chip lh-del">removed</span>';
    const result = el('div', 'lh-result');
    const status = el('div', 'lh-status');
    body.append(legend, result, status);

    const actions = el('div', 'lh-actions');
    actions.append(
      actionBtn('Apply', 'apply', onApply),
      actionBtn('Copy', 'copy', onCopy),
      actionBtn('Regenerate', 'regen', onRegen),
      actionBtn('Cancel', 'cancel', onCancel)
    );

    panel.append(head, body, actions);
    panel.hidden = false;
    positionNear(panel, btn.hidden ? { left: 40, top: 40, bottom: 40 } : btn.getBoundingClientRect());
    // Re-anchor near the selection instead of the (now hidden) button.
    if (desc && desc.rect) positionNear(panel, { left: desc.rect.left, top: desc.rect.top, bottom: desc.rect.bottom });
  }

  function actionBtn(label, act, handler) {
    const b = el('button', 'lh-act');
    b.type = 'button';
    b.dataset.act = act;
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      handler();
    });
    return b;
  }

  function q(sel) {
    return panel.querySelector(sel);
  }

  function setStatus(text) {
    const s = q('.lh-status');
    if (s) s.textContent = text || '';
  }

  function setResultPlain(text) {
    const r = q('.lh-result');
    if (r) {
      r.textContent = text;
      r.classList.remove('lh-has-diff');
    }
  }

  function renderDiff(original, result) {
    const r = q('.lh-result');
    if (!r) return;
    r.textContent = '';
    r.classList.add('lh-has-diff');
    const ops = LH.diff.diffWords(original, result);
    for (const op of ops) {
      const span = document.createElement('span');
      if (op.type === 'insert') span.className = 'lh-ins';
      else if (op.type === 'delete') span.className = 'lh-del';
      span.textContent = op.text;
      r.appendChild(span);
    }
  }

  function setActionsEnabled(enabled) {
    const apply = q('.lh-act[data-act="apply"]');
    const copy = q('.lh-act[data-act="copy"]');
    const regen = q('.lh-act[data-act="regen"]');
    const cancel = q('.lh-act[data-act="cancel"]');
    if (apply) apply.disabled = !enabled;
    if (copy) copy.disabled = !enabled;
    if (regen) regen.disabled = !enabled;
    // Cancel is useful only while streaming.
    if (cancel) cancel.textContent = enabled ? 'Close' : 'Cancel';
  }

  async function onApply() {
    if (!state || !state.resultText) return;
    setStatus('Applying…');
    const res = await LH.replace.applyReplacement(desc, state.resultText);
    if (res.ok) {
      closePanel();
    } else {
      await copyToClipboard(state.resultText);
      setStatus('Could not edit this field inline — copied to clipboard. Paste manually (Ctrl/Cmd+V).');
    }
  }

  async function onCopy() {
    if (!state || !state.resultText) return;
    const ok = await copyToClipboard(state.resultText);
    setStatus(ok ? 'Copied to clipboard.' : 'Copy failed.');
  }

  function onRegen() {
    if (!state) return;
    run(state.mode, state.tone);
  }

  function onCancel() {
    if (state && state.streaming && port) {
      try {
        port.postMessage({ type: 'cancel' });
      } catch { /* ignore */ }
      setStatus('Cancelling…');
    } else {
      closePanel();
    }
  }

  function closePanel() {
    panel.hidden = true;
    panel.innerHTML = '';
    cleanupPort();
    state = null;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback via a temporary textarea.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  // ---- Global listeners ----------------------------------------------------

  // Messages from the toolbar popup (fallback UI).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'lh-capture') {
      const d = LH.selection.capture();
      if (d) desc = d;
      sendResponse({ text: d ? d.text : '' });
      return; // sync response
    }
    if (msg.type === 'lh-apply') {
      (async () => {
        const res = desc ? await LH.replace.applyReplacement(desc, msg.text) : { ok: false };
        sendResponse(res);
      })();
      return true; // async response
    }
  });

  document.addEventListener('mouseup', onSelectionActivity, true);
  document.addEventListener('keyup', onSelectionActivity, true);
  document.addEventListener('mousedown', (e) => {
    if (eventInsideUI(e)) return;
    hideMenu();
    // Hide the button on an outside click that isn't extending a selection.
    if (btn && !btn.hidden) hideButton();
  }, true);
  window.addEventListener('scroll', () => {
    hideButton();
    hideMenu();
  }, true);

  buildUI();
})();
