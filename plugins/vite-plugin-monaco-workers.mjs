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
 * Why `?worker&inline` and not `?worker&url` + a blob trampoline?
 * --------------------------------------------------------------
 * The previous incarnation of this plugin emitted the worker as a separate
 * chunk (`?worker&url`) and then built a same-origin Blob whose body was
 * `import "<absolute worker url>";`. That works in dev (Vite's CORS-enabled
 * server fulfils the cross-origin module import) but FAILS in a VS Code
 * webview in production:
 *
 *   - The webview document origin is `vscode-webview://<uuid>`.
 *   - Asset URLs returned by `webview.asWebviewUri` are on `https://*.vscode-cdn.net`.
 *   - A Blob URL inherits the page origin, so the `import` inside the worker
 *     becomes a cross-origin ESM fetch from `vscode-webview://` → `https://…vscode-cdn.net/…`.
 *     VS Code's webview resource server does NOT serve those assets with the
 *     CORS headers required for a cross-origin module import, so the fetch
 *     hangs/fails silently. Monaco's internal startup timeout (~30s) then
 *     surfaces "Could not create web worker(s). Falling back to loading web
 *     worker code in main thread" plus an opaque `Worker error` event.
 *
 * `?worker&inline` sidesteps all of that. Vite emits a small wrapper that
 * does `new Worker(URL.createObjectURL(new Blob([<base64-decoded script>])))`
 * — the Blob carries the actual worker code, not an `import` of a remote URL,
 * so there is nothing cross-origin to fetch. Trade-off: the bundle grows by
 * ~870 KB (editor.worker ≈ 260 KB + json.worker ≈ 390 KB, base64-encoded),
 * which is negligible next to monaco-editor's own 3.8 MB chunk.
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
 * Each worker is imported with `?worker&inline`, which gives us a default
 * export that is a Worker **constructor**. Vite has already inlined the
 * worker script as a base64 blob inside the surrounding chunk, so
 * `new XxxWorker()` constructs a same-origin Blob worker with the real
 * script bytes (no `import` of a remote URL is performed at runtime).
 */
function buildEnvModule() {
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

    /** Worker constructor imports — `?worker&inline` returns a Worker class. */
    const workerImports = WORKERS.map(
        ({ label, entry }) => `import ${classNameForLabel(label)} from ${JSON.stringify(entry + '?worker&inline')};`,
    ).join('\n');

    const cases = WORKERS.filter((w) => w.label !== 'editorWorkerService')
        .map(({ label }) => `        if (label === ${JSON.stringify(label)}) return new ${classNameForLabel(label)}();`)
        .join('\n');

    return [
        '// virtual:monaco-env — generated by vite-plugin-monaco-workers',
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
 * @returns {import('vite').Plugin}
 */
export function monacoWorkers() {
    /** Normalised absolute path of the webview entry. */
    let entryId = '';

    return {
        name: 'monaco-workers',
        enforce: 'pre',

        configResolved(config) {
            entryId = (config.root + '/src/webviews/index.tsx').replace(/\\/g, '/');
        },

        // ── Virtual module: resolves `virtual:monaco-env` ────────────────────────
        resolveId(id) {
            if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
            return null;
        },

        load(id) {
            if (id !== RESOLVED_VIRTUAL_ID) return null;
            return buildEnvModule();
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
