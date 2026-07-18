# English Writing Helper (Chrome extension)

Correct grammar, polish, and restyle **the text you select** on any page — using
your own **OpenAI-compatible** LLM (OpenRouter, OpenAI, Groq, Ollama, LM Studio,
Azure, or any custom endpoint). No build step, no npm — plain vanilla JS.

## Features
- Select text → a floating ✨ button appears → choose **Fix grammar**, **Polish**,
  or **Rewrite as…** (Friendly / Formal / Casual / Professional / Concise / your own).
- Result shown in a panel with a **word-level before/after diff**.
- **Apply** replaces the selection inline (where the field allows), **Copy** always
  works as a fallback, **Regenerate** re-runs.
- Works only on the selected text — never grabs the whole field.
- Bring-your-own-key: custom base URL, API key, model, temperature, multiple profiles.
- Optional live streaming of the result.

## Install (load unpacked)
1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (`chrome-languange-helper`).
4. Click the extension's **Details → Extension options** (or click the toolbar icon).
5. Pick a **Preset** (default: OpenRouter), paste your **API key**, set the **model**,
   click **Save** (approve the host-permission prompt), then **Test connection**.

## Use
1. On any web page, select some text in a text box, comment field, editor, etc.
2. Click the floating ✨ button near your selection.
3. Choose an action. Review the diff, then **Apply** or **Copy**.

## Providers
Store the Base URL **including** its version segment:

| Provider   | Base URL                              | Notes |
|------------|---------------------------------------|-------|
| OpenRouter | `https://openrouter.ai/api/v1`        | default |
| OpenAI     | `https://api.openai.com/v1`           | |
| Groq       | `https://api.groq.com/openai/v1`      | note the extra `/openai` |
| Ollama     | `http://localhost:11434/v1`           | key ignored; local model must be running |
| LM Studio  | `http://localhost:1234/v1`            | local |
| Azure      | `https://RES.openai.azure.com`        | uses `api-key` header + deployment name as model |

## Editor support
- **Reliable inline replace**: `<input>`/`<textarea>` (incl. React apps), Gmail,
  Notion / ProseMirror, Slack / Lexical, Quill / Slate.
- **Copy-only fallback** (Apply auto-copies instead): Google Docs (canvas),
  Monaco / CodeMirror, unknown custom editors, cross-origin iframes.

## Privacy & security
- Selected text is sent to your configured provider **only when you pick an action**.
- The API key is stored in `chrome.storage.local` — never synced to the cloud, never
  exposed to web pages (all LLM calls go through the background service worker).
- No storage is encrypted at rest; anyone with access to this browser profile can
  read the key.
- Host access uses `optional_host_permissions`, granted per-provider at runtime. Only
  `https://*` hosts and `http://localhost` / `http://127.0.0.1` are requestable by
  default. To use another plain-`http` host, add it to `optional_host_permissions`
  in `manifest.json`.

## Local testing
Serve the included scratch page over http (content scripts don't inject on
`file://` unless you enable "Allow access to file URLs" for the extension):

```bash
python3 -m http.server 8000
# then open http://localhost:8000/test.html
```

`test.html` has a `<textarea>`, a React-style input note, and a `contenteditable`
box to exercise selection → button → panel → Apply across field types.

## Project layout
```
manifest.json          MV3 manifest
background.js           service worker — holds key, calls LLM, streams back
content.js             floating UI (shadow DOM), selection, apply
content.css            widget styles (injected into the shadow root)
options.html/js/css    settings: profiles, tones, test connection
utils/                 storage, providers, prompts, llm, selection, replace, diff
vendor/                textarea-caret-position, insert-text (MIT, vendored)
```

## Notes
- Icons are omitted; Chrome shows a default icon. Add `icons` + `action.default_icon`
  to `manifest.json` if you want custom artwork.
- No build/bundler. Edit a file, then click **Reload** on the extension card.
