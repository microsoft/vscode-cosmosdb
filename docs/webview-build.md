# Webview build (Vite) — rationale

Detailed background for non-obvious settings in `vite.config.views.mjs` and the
local plugins under `plugins/vite-plugin-*.mjs`. The config itself keeps only
short comments that link back to the sections here.

The webview is loaded by `src/panels/BaseTab.ts` and ships as a single
`views.js` module. Two runtimes share most of this config:

- **Production** — `views.js` is loaded by the webview from an
  `https://<uuid>.vscode-cdn.net/<ext-path>/dist/views.js` URL produced by
  `webview.asWebviewUri()`.
- **Development** — `views.js` is served by Vite at
  `http://localhost:18080/views.js` and the webview loads it cross-origin from
  `vscode-webview://<uuid>`. HMR is fully wired.

---

## <a id="base"></a> `base` — relative in prod, root in dev

```js
base: isDev ? '/' : './';
```

**Prod (`./`).** The webview document lives at one path under
`vscode-webview://<uuid>/...` and the bundle at a different path under the
same origin. A root-relative URL like `/assets/foo.js` would resolve to the
origin root and 404. `base: './'` makes Vite emit asset URLs resolved against
`import.meta.url` of the loading chunk — i.e. siblings of `views.js`, where
the assets actually live. Without this you see "Could not create web
worker(s). Falling back to loading web worker code in main thread" plus a
worker error event for Monaco language workers, and 403s on the codicon TTF.

**Dev (`/`).** Modules are served by the dev server at `localhost:18080` and
Vite's import-analysis emits absolute URLs against `server.origin` (see
[server.origin](#server-origin)). Forcing `base: './'` in dev makes Vite emit
relative module URLs that the webview document resolves against
`vscode-webview://…`, the requests go through the webview's service worker
and fail with `net::ERR_FAILED` / "FetchEvent … promise was rejected".

---

## <a id="worker-format"></a> `worker.format: 'es'`

Workers are imported via `?worker&inline` (see
[monaco-workers](#monaco-workers)), so Vite embeds the worker script as a
base64 blob and no standalone worker chunk is emitted — this setting is moot
in the normal path. Kept as a defensive default in case any future code path
falls back to a standalone worker chunk: Monaco's language workers expect ES
module semantics, Vite's default is `'iife'` in prod which breaks them.

---

## <a id="assets-inline-fonts"></a> `assetsInlineLimit` — inline font assets

```js
assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? true : undefined);
```

CSS is concatenated into `views.js` by the `inline-css` plugin and injected
via a single `<style>` tag at runtime. Relative `url(./foo.ttf)` inside a
`<style>` element is resolved against the **document base URL**, which in a
VS Code webview is `vscode-webview://<uuid>/` — requests to that origin
bypass `webview.asWebviewUri()` and the resource server replies **403
Forbidden**. Inlining the font bytes as `data:` URIs sidesteps the entire
resource-resolution issue.

`import.meta.url`-based asset URLs in JS (e.g. Monaco worker imports) are
**not** affected — those resolve against the script URL
(`https://<uuid>.vscode-cdn.net/.../views.js`), which is already an
`asWebviewUri` and serves correctly. Returning `undefined` for non-fonts
defers to Vite's default 4 KB threshold so other assets behave normally.

---

## <a id="assets-dir"></a> `assetsDir: ''` — flat asset layout

Vite's default `assetsDir: 'assets'` breaks two things in our pipeline:

1. **`inline-css`** moves CSS into `views.js` (in `dist/`), but font URLs
   inside that CSS were emitted relative to the CSS's original location
   (`dist/assets/foo.css`), so e.g. `url(./codicon-HASH.ttf)` resolves to
   `dist/codicon-HASH.ttf` — wrong, the file is in `dist/assets/`.
2. **Monaco worker trampoline** imports `assets/json.worker-HASH.js` from
   `monaco-editor-HASH.js` via `import.meta.url`. That works only if the
   `assets/` directory exists alongside the chunk; flattening keeps
   everything sibling-relative.

With `assetsDir: ''` everything lives at `dist/` root, matching what webpack's
`asset/resource` + `MonacoWebpackPlugin` produced before the Vite migration.
A single sibling-relative URL space is what `inline-css` and the worker
trampoline both rely on.

---

## <a id="chunk-size-warning"></a> `chunkSizeWarningLimit: 5000`

`monaco-editor` is ~3.7 MB on its own; with the editor + JSON language workers
inlined via `?worker&inline` it grows by ~650 KB to ~4.4 MB. The threshold is
raised above that so the warning does not fire on every build, but kept low
enough that growth in any **other** chunk is still flagged.

---

## <a id="rollup-output"></a> Rollup output

```js
preserveEntrySignatures: 'strict',
entryFileNames: 'views.js',
chunkFileNames: '[name]-[hash].js',
manualChunks: ...
```

- **`preserveEntrySignatures: 'strict'`** — the webview HTML does
  `import { render } from "./views.js"`. Without this, app-mode builds treat
  the entry as side-effect only and strip its exports.
- **`entryFileNames: 'views.js'`** — matches the filename `BaseTab.ts`
  loads.
- **`manualChunks`** — minimal split (prod only):
  - `monaco-editor` is isolated because it dominates the bundle and its hash
    should stay stable across builds where only app code changes.
  - Everything else from `node_modules` lands in `vendor`. Splitting it
    further (react/fluent-ui/…) gives no real benefit in a webview, where
    all chunks load together as static imports and the extension ships as a
    monolithic .vsix.
  - App source stays in the `views.js` entry.

---

## <a id="server-origin"></a> `server.origin: 'http://localhost:18080'`

Makes Vite emit **absolute** asset URLs (e.g. for `?worker` imports) instead
of root-relative paths. Critical for VS Code webviews: the webview document
lives at `vscode-webview://…` so a root-relative
`/node_modules/.../json.worker.js?worker_file` would resolve to
`vscode-webview:///node_modules/...` (404, empty MIME) instead of
`http://localhost:18080/node_modules/...`. Symptom without this: "Failed to
load module script: non-JavaScript MIME type ''" when Monaco tries to create
a language worker.

---

## <a id="server-cors"></a> `server.cors: { origin: '*' }`

Vite 5+ made the default `cors: true` restrictive: it only emits
`Access-Control-Allow-Origin` for `localhost` / `127.0.0.1` origins. Our
webview document runs at `vscode-webview://<uuid>`, which doesn't match that
allow-list — Vite's CORS middleware then strips the header and overrides the
explicit `headers: { 'Access-Control-Allow-Origin': '*' }` next to it.

**Symptom:** the webview can load `/views.js` (served by
[`webview-entry`](#plugin-webview-entry), which writes ACAO:\* by hand and
bypasses the middleware), but every chained ESM import
(`/src/webviews/...tsx`, `/node_modules/.vite/deps/...`) fails with
`net::ERR_FAILED` plus a service-worker
"FetchEvent … promise was rejected" log.

Explicit `cors: { origin: '*' }` opts back into the wildcard behaviour we had
with old Vite defaults. Safe in dev because the dev server only serves source
code we own.

---

## Plugins

### <a id="plugin-no-extension-imports"></a> `noExtensionImports`

Fails the build immediately if any module in the browser bundle tries to
import `vscode` or a Node.js built-in (`node:*`, `fs`, `path`, `os`, …).
Catches accidental extension-host code leaking into the webview bundle at
build time rather than at runtime.

### <a id="plugin-webview-entry"></a> `webviewEntry`

Dev-server only. Serves `/views.js` as a re-export of the real entry
(`src/webviews/index.tsx`) so the webview can load it from
`http://localhost:18080/views.js` with full HMR. Sets CORS headers itself
because middleware ordering with Vite's built-in cors is not guaranteed.
No-op in production.

### <a id="plugin-react-refresh-preamble"></a> `reactRefreshPreamble`

Dev-only. Injects the React Refresh runtime preamble required by
`@vitejs/plugin-react` so HMR works inside the webview. Webpack got this via
`@pmmmwh/react-refresh-webpack-plugin`; `@vitejs/plugin-react` expects an
HTML author to inject the preamble through `transformIndexHtml`, but our HTML
is generated server-side in `BaseTab.ts`. The plugin exposes a virtual
module `virtual:react-refresh-preamble` and prepends
`import 'virtual:react-refresh-preamble';` to `src/webviews/index.tsx`.
Source-order import hoisting guarantees it runs before any React module.

### <a id="monaco-workers"></a> `monacoWorkers`

Vite equivalent of `monaco-editor-webpack-plugin`. For each language it:

1. Imports the language **contribution** so Monaco knows about the language
   id (without this `language: 'json'` is unknown — plain unhighlighted
   text).
2. Imports the worker via `?worker&inline`, yielding a `Worker` **constructor**
   whose script is embedded as a base64 blob in the surrounding chunk.
3. Wires `MonacoEnvironment.getWorker` to `new XxxWorker()` per label.

**Why `?worker&inline` and not `?worker&url` + a Blob trampoline?**
The previous incarnation emitted the worker as a separate chunk and built a
same-origin Blob whose body was `import "<absolute worker url>";`. Works in
dev, but in a VS Code webview production build:

- Document origin is `vscode-webview://<uuid>`.
- Worker asset URLs (via `asWebviewUri`) are on `https://*.vscode-cdn.net`.
- A Blob URL inherits the page origin, so `import` inside the worker becomes
  a cross-origin ESM fetch from `vscode-webview://` to `https://…vscode-cdn.net/…`.
  VS Code's webview resource server does **not** serve those assets with the
  CORS headers required for a cross-origin module import. The fetch
  hangs/fails silently, Monaco's internal ~30 s startup timeout surfaces
  "Could not create web worker(s). Falling back to loading web worker code
  in main thread" plus an opaque `Worker error` event.

`?worker&inline` sidesteps all of that — the Blob carries the actual worker
script bytes, no remote import. Cost: ~870 KB added to the monaco chunk
(editor.worker ≈ 260 KB + json.worker ≈ 390 KB, base64-encoded), negligible
next to monaco-editor's own 3.8 MB.

**Why an injected import, not a transform on `MonacoEditor.tsx`?** Webpack
injects `MonacoEnvironment` into a runtime chunk that runs _before_ any
module body — possible because webpack output is an IIFE. Vite/Rolldown emit
pure ES modules whose `import`s are hoisted, so prepending text to the
output chunk would not help. Instead a virtual module `virtual:monaco-env`
is exposed and `import 'virtual:monaco-env';` is injected as the FIRST
statement of `src/webviews/index.tsx`. ESM hoisting guarantees it runs
before any module that pulls in monaco.

### <a id="plugin-inline-css"></a> `inlineCss`

Inlines every emitted `.css` into the entry chunk and removes the separate
`.css` files. The webview HTML loads a single `<script type="module">`, so
CSS must travel through JS. ~30-line local plugin that replaces
`vite-plugin-css-injected-by-js`. No-op in dev — Vite already serves CSS via
HMR-managed `<style>` tags.

### <a id="plugin-bundle-report"></a> `bundleReport` and `analyzer`

Production only. `bundleReport` emits a lightweight `bundle-report.json` for
CI size tracking. The full HTML bundle report is opt-in via the
`BUNDLE_ANALYZE=true` environment variable.
