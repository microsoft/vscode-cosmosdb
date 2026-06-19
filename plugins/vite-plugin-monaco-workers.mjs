/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * vite-plugin-monaco-workers
 *
 * Vite equivalent of `monaco-editor-webpack-plugin`. For each configured
 * language it:
 *
 *   1. Imports the language **contribution** so monaco actually KNOWS about
 *      that language id — without this `language: 'json'` is unknown to
 *      monaco, no Monarch tokenizer runs, you see plain unhighlighted text.
 *   2. Imports the language worker via Vite's `?worker&inline`, which yields
 *      a `Worker` **constructor** whose script is embedded as a base64 blob
 *      directly in the surrounding chunk.
 *   3. Hands `MonacoEnvironment.getWorker` a fresh `new XxxWorker()` for each
 *      label.
 *
 * Worker loading strategy — different in dev vs prod
 * --------------------------------------------------
 * The webview document origin is always `vscode-webview://<uuid>`, while the
 * worker script lives on a DIFFERENT origin in BOTH environments:
 *   - prod: assets are served from `https://*.vscode-cdn.net` (via `webview.asWebviewUri`);
 *   - dev:  Vite serves each worker as a separate ES module at the absolute
 *           dev-server URL `http://localhost:18080/...?worker_file&type=module`.
 * Constructing `new Worker(<cross-origin url>)` is blocked by the browser in
 * either case, so neither environment can load the worker by URL directly.
 *
 * PROD → `?worker&inline`.
 *   Vite inlines the worker script as a base64 blob and emits a wrapper that
 *   does `new Worker(URL.createObjectURL(new Blob([<decoded script>])))`. The
 *   Blob carries the actual worker bytes (no `import` of a remote URL), so
 *   there is nothing cross-origin to fetch. Trade-off: the bundle grows by
 *   ~870 KB (editor.worker ≈ 260 KB + json.worker ≈ 390 KB, base64-encoded),
 *   negligible next to monaco-editor's own 3.8 MB chunk.
 *
 *   `?worker&inline` only actually inlines during `vite build`. In `vite serve`
 *   it degrades to a URL worker (`?worker_file&type=module`) on the dev-server
 *   origin — which the webview cannot construct cross-origin. That is exactly
 *   the dev failure ("Could not create web worker(s). Falling back to loading
 *   web worker code in main thread" + `Failed to construct 'Worker' … cannot be
 *   accessed from origin 'vscode-webview://…'`). Hence the dev path below.
 *
 * DEV → `?worker&url` + a same-origin Blob trampoline.
 *   We import the worker's absolute dev-server URL (`?worker&url`) and wrap it
 *   in a Blob whose body is `import "<absolute url>";`. The Blob URL inherits
 *   the webview page origin, so `new Worker(blobUrl, { type: 'module' })` is
 *   same-origin and constructs fine; the module `import` inside then fetches
 *   the real worker script from Vite's CORS-enabled dev server (`cors: '*'`,
 *   and the dev CSP allows `script-src`/`worker-src` from the dev host + blob:).
 *   This is dev-only — it must NOT be used in prod, where `vscode-webview://`
 *   → `https://*.vscode-cdn.net` lacks the CORS headers a cross-origin module
 *   import needs, so the fetch would hang and Monaco would fall back to the
 *   main thread after a ~30s timeout.
 *
 * Why an injected import, not a transform on MonacoEditor.tsx?
 * -----------------------------------------------------------
 * webpack injects MonacoEnvironment into a runtime chunk that runs *before*
 * any module body — possible because webpack output is an IIFE. Vite/Rolldown
 * emit pure ES modules whose `import`s are hoisted, so prepending text to
 * the output chunk wouldn't help. Instead we expose a virtual module
 * `virtual:monaco-env` and inject `import 'virtual:monaco-env';` as the
 * FIRST statement of the webview entry (`src/webviews/index.tsx`). Because
 * ESM hoists imports in source order, this is guaranteed to be the first
 * side-effecting module to run.
 *
 * WEBPACK BUILD
 *   This plugin is Vite-only. The webpack build used
 *   `monaco-editor-webpack-plugin` and never loaded this file.
 */

/** Worker definitions — mirrors the `languages` option of MonacoWebpackPlugin. */
const WORKERS = [
    {
        /** Monaco's base editor worker — always required. */
        label: 'editorWorkerService',
        entry: 'monaco-editor/esm/vs/editor/editor.worker',
        /**
         * No language contribution — `editorWorkerService` is part of the base
         * editor API and is wired up by `monaco-editor/esm/vs/editor/editor.api`.
         */
        contribution: null,
    },
    {
        /** JSON language worker (syntax, validation, formatting). */
        label: 'json',
        entry: 'monaco-editor/esm/vs/language/json/json.worker',
        /**
         * Importing this side-effect module:
         *   - registers the JSON language with monaco,
         *   - installs the Monarch tokenizer (THIS is what enables syntax
         *     highlighting — without it `language: 'json'` is unknown and the
         *     editor renders plain unhighlighted text),
         *   - registers hover/completion/validation providers backed by json.worker.
         *
         * MonacoWebpackPlugin auto-injects this when you pass `languages: ['json']`.
         * Vite has no equivalent magic, so we import it explicitly here.
         */
        contribution: 'monaco-editor/esm/vs/language/json/monaco.contribution',
    },
];

const VIRTUAL_ID = 'virtual:monaco-env';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

function classNameForLabel(label) {
    const base = label === 'editorWorkerService' ? 'Editor' : label.charAt(0).toUpperCase() + label.slice(1);
    return `${base}Worker`;
}

/**
 * Module body of `virtual:monaco-env`.
 *
 * @param {boolean} isDev `true` for `vite serve`, `false` for `vite build`.
 *   See the top-of-file comment for why the strategy differs.
 */
function buildEnvModule(isDev) {
    /**
     * Language contributions — side-effect imports that register the
     * language's full service (Monarch tokenizer + worker-backed
     * hover/completion/validation). MonacoWebpackPlugin auto-injects these
     * via its `languages: [...]` option; with Vite we list them explicitly.
     *
     * Note: `monaco-editor/esm/vs/editor/editor.main` (imported by
     * `MonacoEditor.tsx`) already pulls in every basic-language contribution,
     * so these are technically redundant. They are kept here so the worker
     * config is self-documenting — one place to see "language X needs worker Y
     * and contribution Z".
     */
    const contributionImports = WORKERS.filter((w) => !!w.contribution)
        .map(({ contribution }) => `import ${JSON.stringify(contribution)};`)
        .join('\n');

    return isDev ? buildDevEnvModule(contributionImports) : buildProdEnvModule(contributionImports);
}

/**
 * PROD: workers imported with `?worker&inline` give a Worker **constructor**
 * whose script is embedded as a base64 Blob inside the surrounding chunk, so
 * `new XxxWorker()` constructs a same-origin Blob worker with the real bytes
 * (no remote `import` at runtime).
 */
function buildProdEnvModule(contributionImports) {
    const workerImports = WORKERS.map(
        ({ label, entry }) => `import ${classNameForLabel(label)} from ${JSON.stringify(entry + '?worker&inline')};`,
    ).join('\n');

    const cases = WORKERS.filter((w) => w.label !== 'editorWorkerService')
        .map(({ label }) => `        if (label === ${JSON.stringify(label)}) return new ${classNameForLabel(label)}();`)
        .join('\n');

    return [
        '// virtual:monaco-env — generated by vite-plugin-monaco-workers (build)',
        contributionImports,
        workerImports,
        '',
        'self.MonacoEnvironment = {',
        '    getWorker(_moduleId, label) {',
        cases,
        `        return new ${classNameForLabel('editorWorkerService')}();`,
        '    },',
        '};',
        '',
    ].join('\n');
}

/**
 * DEV: `?worker&inline` does not inline under `vite serve`; it degrades to a
 * cross-origin URL worker the webview cannot construct. Import each worker's
 * absolute dev-server URL (`?worker&url`) instead and wrap it in a same-origin
 * Blob module worker that `import`s the real script. See top-of-file comment.
 */
function buildDevEnvModule(contributionImports) {
    const urlImports = WORKERS.map(
        ({ label, entry }) => `import ${classNameForLabel(label)}Url from ${JSON.stringify(entry + '?worker&url')};`,
    ).join('\n');

    const cases = WORKERS.filter((w) => w.label !== 'editorWorkerService')
        .map(
            ({ label }) =>
                `        if (label === ${JSON.stringify(label)}) return makeWorker(${classNameForLabel(label)}Url);`,
        )
        .join('\n');

    return [
        '// virtual:monaco-env — generated by vite-plugin-monaco-workers (dev, blob trampoline)',
        contributionImports,
        urlImports,
        '',
        'function makeWorker(url) {',
        '    // The dev server serves the worker at an absolute cross-origin URL',
        '    // (http://localhost:18080/...). A Blob URL inherits the webview page',
        '    // origin, so the Worker is constructed same-origin; the module import',
        '    // inside then fetches the real script from the CORS-enabled dev server.',
        '    const absolute = new URL(url, import.meta.url).href;',
        '    const blobUrl = URL.createObjectURL(',
        "        new Blob([`import ${JSON.stringify(absolute)};`], { type: 'text/javascript' }),",
        '    );',
        "    const worker = new Worker(blobUrl, { type: 'module' });",
        '    // The blob is only needed to bootstrap the worker; the engine keeps it',
        '    // alive for the running worker, so we can revoke the URL immediately.',
        '    URL.revokeObjectURL(blobUrl);',
        '    return worker;',
        '}',
        '',
        'self.MonacoEnvironment = {',
        '    getWorker(_moduleId, label) {',
        cases,
        `        return makeWorker(${classNameForLabel('editorWorkerService')}Url);`,
        '    },',
        '};',
        '',
    ].join('\n');
}

/**
 * @returns {import('vite').Plugin}
 */
export function monacoWorkers() {
    /** Normalised absolute path of the webview entry. */
    let entryId = '';
    /** `true` under `vite serve`, `false` under `vite build`. */
    let isDev = false;

    return {
        name: 'monaco-workers',
        enforce: 'pre',

        configResolved(config) {
            entryId = (config.root + '/src/webviews/index.tsx').replace(/\\/g, '/');
            isDev = config.command === 'serve';
        },

        // ── Virtual module: resolves `virtual:monaco-env` ────────────────────────
        resolveId(id) {
            if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
            return null;
        },

        load(id) {
            if (id !== RESOLVED_VIRTUAL_ID) return null;
            return buildEnvModule(isDev);
        },

        // ── Inject `import 'virtual:monaco-env';` at the top of the entry ───────
        //
        // ESM hoists imports in source order, so this runs before any other
        // import in index.tsx — and therefore before any lazy import that pulls
        // monaco-editor into the graph.
        transform(code, id) {
            const normId = id.replace(/\\/g, '/').split('?')[0];
            if (normId !== entryId) return null;
            if (code.includes(VIRTUAL_ID)) return null; // idempotent guard
            return {
                code: `import ${JSON.stringify(VIRTUAL_ID)};\n${code}`,
                map: null,
            };
        },
    };
}
