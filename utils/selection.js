/**
 * Selection capture + positioning. Classic script → globalThis.LH.selection.
 * Content-script / DOM only. Depends on vendor getCaretCoordinates (loaded first).
 */
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password', '']);

  function activeEditable() {
    let el = document.activeElement;
    // Pierce open shadow roots to find the truly focused element.
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function isTextField(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((el.type || '').toLowerCase());
    return false;
  }

  function editableHost(node) {
    let n = node;
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    while (n) {
      if (n.isContentEditable) {
        // climb to the top-most contenteditable root
        let root = n;
        while (root.parentElement && root.parentElement.isContentEditable) root = root.parentElement;
        return root;
      }
      n = n.parentElement;
    }
    return null;
  }

  /**
   * Capture the current selection as a replaceable descriptor, or null if there
   * is no usable non-empty selection.
   */
  function capture() {
    const el = activeEditable();

    // 1) Plain <input>/<textarea>
    if (isTextField(el)) {
      let start;
      let end;
      try {
        start = el.selectionStart;
        end = el.selectionEnd;
      } catch {
        return null; // some input types throw on selection access
      }
      if (start == null || end == null || start === end) return null;
      const text = el.value.slice(start, end);
      if (!text.trim()) return null;
      return { kind: 'input', el, start, end, text, rect: fieldRect(el, end) };
    }

    // 2) contenteditable / rich editors
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const host = editableHost(sel.anchorNode) || editableHost(sel.focusNode);
    if (!host) return null;
    const range = sel.getRangeAt(0).cloneRange();
    return { kind: 'contenteditable', el: host, range, text, rect: rangeRect(range) };
  }

  /** Viewport-relative rect of the selection end, for placing the floating button. */
  function rangeRect(range) {
    const rects = range.getClientRects();
    const r = rects && rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (r && (r.width || r.height)) return { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
    // Collapsed / zero-size fallback.
    const b = range.getBoundingClientRect();
    return { left: b.left, top: b.top, bottom: b.bottom, right: b.right };
  }

  function fieldRect(el, caretIndex) {
    const box = el.getBoundingClientRect();
    try {
      const coords = globalThis.getCaretCoordinates(el, caretIndex);
      const left = box.left + coords.left - el.scrollLeft;
      const top = box.top + coords.top - el.scrollTop;
      const bottom = top + (coords.height || 16);
      return { left, top, bottom, right: left };
    } catch {
      // Fallback: bottom-left of the field.
      return { left: box.left, top: box.top, bottom: box.bottom, right: box.right };
    }
  }

  LH.selection = { capture, isTextField, editableHost, activeEditable };
})();
