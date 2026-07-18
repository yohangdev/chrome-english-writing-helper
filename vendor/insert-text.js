/* Minimal insertText helper, modeled on fregante/text-field-edit (MIT).
 * Replaces the current selection in an <input>/<textarea> via execCommand,
 * preserving the native undo stack and firing an `input` event React notices.
 * Exposes globalThis.LH_insertText(field, text) -> boolean (success).
 */
(function () {
  function insertTextIntoField(field, text) {
    const document = field.ownerDocument;
    const initialFocus = document.activeElement;
    if (initialFocus !== field) field.focus();

    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }

    if (!ok) {
      // Fallback: setRangeText + manual input event (no undo entry, but works).
      try {
        const start = field.selectionStart;
        const end = field.selectionEnd;
        field.setRangeText(text, start, end, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true, cancelable: false }));
        ok = true;
      } catch {
        ok = false;
      }
    }

    return ok;
  }

  globalThis.LH_insertText = insertTextIntoField;
})();
