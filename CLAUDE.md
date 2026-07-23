# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Chrome extension (Manifest V3) that provides AI-powered grammar correction and text rewriting for selected text on any web page. Uses OpenAI-compatible LLM providers (OpenRouter, OpenAI, Groq, Ollama, etc.). No build step — plain vanilla JS that loads directly in Chrome.

**Key design decision:** The API key is stored and used only in the background service worker, keeping it out of the page context and bypassing page CORS.

## Development workflow

### Load and test the extension
```bash
# Load in Chrome
# 1. Open chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked" and select this directory
# 4. After editing files, click "Reload" on the extension card (no build step)
```

### Local testing
```bash
# Serve the test page (content scripts don't inject on file://)
python3 -m http.server 8000
# Open http://localhost:8000/test.html
```

`test.html` includes a `<textarea>`, a React-style input, and a `contenteditable` box to test selection → floating button → Apply across different editor types.

### Reloading during development
- Edit any file directly
- Click **Reload** on the extension card at `chrome://extensions`
- Refresh the page you're testing on
- No build/bundler/npm step required

## Architecture

### Entry points
- **background.js** — Service worker. Holds API key, makes LLM requests, streams results to content scripts via Port
- **content.js** — Content script entry. Renders floating button/menu/panel in Shadow DOM, captures selection, applies results
- **popup.js** — Toolbar popup UI (fallback when floating button unavailable)
- **options.js** — Settings page for profiles, tones, connection test

### Utility modules (utils/)
All are "classic scripts" that attach to `globalThis.LH`:

- **storage.js** — `chrome.storage.local` wrapper (never uses `chrome.storage.sync` to avoid uploading API keys)
- **providers.js** — Provider presets and request building (Azure vs OpenAI-compatible auth, base URL handling)
- **llm.js** — OpenAI-compatible client with streaming (SSE) and retry logic
- **prompts.js** — System prompts for grammar/polish/style modes, output cleaning
- **selection.js** — Selection capture (handles input/textarea and contenteditable)
- **replace.js** — Multi-rung inline replacement strategy ladder (tries progressively more forceful methods)
- **diff.js** — Word-level LCS diff for before/after display

### Communication patterns

**Content → Background (streaming LLM):**
- Content script opens `chrome.runtime.connect({ name: 'rewrite' })`
- Sends `{ type: 'run', mode, text, tone }`
- Background streams back `{ type: 'delta', text }` chunks
- Final `{ type: 'done', text }` or `{ type: 'error', error }`

**Options → Background (one-shot test):**
- `chrome.runtime.sendMessage({ type: 'test', profile })`
- Response via `sendResponse({ ok, error, sample })`

**Content → Page (selection/apply):**
- Selection captured via native Selection API and Range inspection
- Apply uses capability ladder: `document.execCommand('insertText')` → synthetic paste → native value setter → direct Range DOM edit
- Falls back to Copy clipboard when inline replace fails

### Shadow DOM isolation
All UI (button, menu, panel) is rendered inside a Shadow DOM to avoid host page style conflicts. Host element: `<div id="lh-writing-helper-host">` with `z-index: 2147483647`.

### Vendor code
- **textarea-caret-position.js** — Caret coordinate detection for button positioning
- **insert-text.js** — `document.execCommand('insertText')` wrapper for React safety (preserves undo history)

Both are MIT-licensed and vendored directly (no npm).

## Security considerations

- API keys stored in `chrome.storage.local` (not synced, not encrypted at rest)
- Optional host permissions granted per-provider at runtime via `chrome.permissions.request`
- Background worker bypasses page CORS — LLM calls don't need page headers
- Prompt injection guarded by wrapping user text in `<<<TEXT ... TEXT>>>` markers

## Common tasks

**Add a new action mode:**
1. Add system prompt in `prompts.js` + temperature to `TEMPS`
2. Add to action menu in `content.js` button handler
3. Pass `mode` through to background SW

**Add a new provider preset:**
- Add to `PRESETS` in `providers.js` with correct `baseURL` (include `/v1` segment)

**Debug streaming issues:**
- Check SSE parsing in `llm.js` (`readStream` function)
- Verify `content-type: text/event-stream` response
- Background SW logs: open `chrome://extensions` → Service worker link

**Fix inline apply failure for a specific editor:**
- Debug in `replace.js` — add logging to see which rung succeeds
- May need editor-specific strategy in the capability ladder

**Styles not applying:**
- Check `content.css` is injected into Shadow root
- Verify selector specificity (Shadow DOM scoping)
