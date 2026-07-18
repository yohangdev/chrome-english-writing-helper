/**
 * System prompts + message builder. Classic script → globalThis.LH.prompts.
 * Output is plain text (no JSON) so it streams cleanly across every provider.
 */
(function () {
  const LH = (globalThis.LH = globalThis.LH || {});

  const COMMON_TAIL =
    ' Output ONLY the resulting text — no preamble, no explanation, no quotation marks, and no markdown formatting.';

  const GRAMMAR =
    'You are a grammar and spelling correction engine. Fix only grammar, spelling, ' +
    'punctuation, and obvious typos in the text. Preserve the original meaning, tone, ' +
    'voice, wording, and formatting as much as possible — change as little as possible. ' +
    'Do not rephrase, restructure, shorten, or improve style. If the text is already ' +
    'correct, return it unchanged.' +
    COMMON_TAIL;

  const POLISH =
    'You are a writing improvement engine. Rewrite the text to be clearer, more concise, ' +
    'and better flowing, while fully preserving the original meaning and the author\'s ' +
    'intent and voice. Fix grammar and awkward phrasing, remove redundancy, and improve ' +
    'word choice. Do not add new information, do not change the language, and do not alter ' +
    'the level of formality unless it is grammatically necessary.' +
    COMMON_TAIL;

  function styleSystem(tone) {
    const t = (tone || 'friendly').trim();
    return (
      `You are a tone and style rewriting engine. Rewrite the text in a ${t} tone while ` +
      'preserving the original meaning and all factual content. Adjust vocabulary, sentence ' +
      'structure, and phrasing to match the requested tone. Keep the same language as the ' +
      'input. Do not add new information or commentary.' +
      COMMON_TAIL
    );
  }

  const TEMPS = { grammar: 0.2, polish: 0.4, style: 0.6 };

  /**
   * Build the chat messages array.
   * @param {'grammar'|'polish'|'style'} mode
   * @param {string} text  the user-selected text
   * @param {string=} tone required when mode === 'style'
   */
  function buildMessages(mode, text, tone) {
    let system;
    if (mode === 'grammar') system = GRAMMAR;
    else if (mode === 'polish') system = POLISH;
    else system = styleSystem(tone);

    // Delimit the user's text so any instructions inside it are treated as data,
    // not as commands to the model (prompt-injection guard).
    const user =
      'Transform the text between the <<<TEXT and TEXT>>> markers. Return only the ' +
      'transformed text.\n\n<<<TEXT\n' + text + '\nTEXT>>>';

    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  /** Strip a wrapping pair of quotes or a ``` fence the model may have added. */
  function cleanOutput(raw) {
    let s = String(raw == null ? '' : raw).trim();
    // Remove a ```lang ... ``` fence if the whole output is fenced.
    const fence = s.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
    if (fence) s = fence[1].trim();
    // Remove a single wrapping pair of matching quotes.
    if (s.length >= 2) {
      const a = s[0];
      const b = s[s.length - 1];
      if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === '“' && b === '”')) {
        s = s.slice(1, -1).trim();
      }
    }
    return s;
  }

  LH.prompts = { GRAMMAR, POLISH, styleSystem, TEMPS, buildMessages, cleanOutput };
})();
