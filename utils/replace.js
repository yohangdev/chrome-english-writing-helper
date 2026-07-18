/**
 * Inline-replacement capability ladder. Classic script → globalThis.LH.replace.
 * Tries progressively more forceful strategies, verifying after each. Returns
 * { ok, method } — the caller falls back to the copy panel when ok === false.
 */
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
  }

  async function applyReplacement(desc, text) {
    if (!desc || text == null) return { ok: false };
    try {
      return desc.kind === 'input'
        ? await replaceInput(desc, text)
        : await replaceContentEditable(desc, text);
    } catch {
      return { ok: false };
    }
  }

  async function replaceInput(desc, text) {
    const el = desc.el;
    el.focus();
    try {
      el.setSelectionRange(desc.start, desc.end);
    } catch {
      /* ignore */
    }
    const before = el.value;

    // Rung 1: execCommand insertText via vendored helper (undo-preserving, React-safe).
    try {
      if (globalThis.LH_insertText && globalThis.LH_insertText(el, text)) {
        if (el.value !== before) return { ok: true, method: 'insertText' };
      }
    } catch {
      /* ignore */
    }

    // Rung 2: setRangeText (explicit; must dispatch input ourselves).
    try {
      el.setRangeText(text, desc.start, desc.end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (el.value !== before) return { ok: true, method: 'setRangeText' };
    } catch {
      /* ignore */
    }

    // Rung 3: React-controlled — native value setter on the full field + input event.
    try {
      const full = before.slice(0, desc.start) + text + before.slice(desc.end);
      setNativeValue(el, full);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (el.value === full) return { ok: true, method: 'nativeSetter' };
    } catch {
      /* ignore */
    }

    return { ok: false };
  }

  function restoreRange(range) {
    const sel = window.getSelection();
    try {
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      /* ignore */
    }
    return sel;
  }

  async function replaceContentEditable(desc, text) {
    const el = desc.el;
    el.focus();
    restoreRange(desc.range);
    const before = el.textContent;

    // Rung 1: execCommand insertText — drives ProseMirror/Lexical/Slate/Quill/Gmail.
    try {
      const did = document.execCommand('insertText', false, text);
      await raf();
      if (did && el.textContent !== before) return { ok: true, method: 'insertText' };
    } catch {
      /* ignore */
    }

    // Rung 2: synthetic paste (Draft.js / Lexical). Needs a non-collapsed selection.
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) restoreRange(desc.range);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      dt.setData('text/html', text);
      const ev = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      el.dispatchEvent(ev);
      await raf();
      if (el.textContent !== before) return { ok: true, method: 'paste' };
    } catch {
      /* ignore */
    }

    // Rung 3: direct Range DOM edit (plain contenteditable only; loses undo).
    try {
      const sel = window.getSelection();
      let range = desc.range;
      if (sel && sel.rangeCount) range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      sel.collapseToEnd();
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await raf();
      if (el.textContent !== before) return { ok: true, method: 'range' };
    } catch {
      /* ignore */
    }

    return { ok: false };
  }

  LH.replace = { applyReplacement };
})();
