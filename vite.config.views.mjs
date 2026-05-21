/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Detailed rationale for every non-obvious setting in this file lives in
// docs/webview-build.md. Inline comments here are intentionally terse and
// reference the matching section by anchor (e.g. `#base`).

import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzer } from 'vite-bundle-analyzer';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { bundleReport } from './plugins/vite-plugin-bundle-report.mjs';
import { inlineCss } from './plugins/vite-plugin-inline-css.mjs';
import { monacoWorkers } from './plugins/vite-plugin-monaco-workers.mjs';
import { noExtensionImports } from './plugins/vite-plugin-no-extension-imports.mjs';
import { reactRefreshPreamble } from './plugins/vite-plugin-react-refresh-preamble.mjs';
import { webviewEntry } from './plugins/vite-plugin-webview-entry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Opt-in HTML bundle report. @see [docs/webview-build.md#plugin-bundle-report](./docs/webview-build.md#plugin-bundle-report) */
const analyze = !!process.env.BUNDLE_ANALYZE;

export default ({ mode }) => {
    const isDev = mode === 'development';

    return {
        /**
         * Prod: chunk-relative URLs for webview asset resolution.
         * Dev: root-relative against the dev server.
         * @see [docs/webview-build.md#base](./docs/webview-build.md#base)
         */
        base: isDev ? '/' : './',
        /**
         * Workers ship via `?worker&inline`.
         * @see [docs/webview-build.md#worker-format](./docs/webview-build.md#worker-format)
         */
        worker: { format: 'es' },
        build: {
            target: 'esnext',
            outDir: 'dist',
            emptyOutDir: false, // Extension build also writes to dist.
            sourcemap: isDev,
            minify: !isDev,
            /**
             * Inline TTF/WOFF/OTF as `data:` URIs.
             * @see [docs/webview-build.md#assets-inline-fonts](./docs/webview-build.md#assets-inline-fonts)
             */
            assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? true : undefined),
            /**
             * Flat asset layout so inline-css and worker trampoline both work.
             * @see [docs/webview-build.md#assets-dir](./docs/webview-build.md#assets-dir)
             */
            assetsDir: '',
            /**
             * monaco-editor + inlined workers ~= 4.4 MB.
             * @see [docs/webview-build.md#chunk-size-warning](./docs/webview-build.md#chunk-size-warning)
             */
            chunkSizeWarningLimit: 5000,
            rollupOptions: {
                input: path.resolve(__dirname, 'src/webviews/index.tsx'),
                /**
                 * Keep named exports (`render`) on the entry.
                 * @see [docs/webview-build.md#rollup-output](./docs/webview-build.md#rollup-output)
                 */
                preserveEntrySignatures: 'strict',
                output: {
                    format: 'es',
                    // Matches the filename BaseTab.ts loads.
                    entryFileNames: 'views.js',
                    chunkFileNames: '[name]-[hash].js',
                    /**
                     * Prod-only minimal split: monaco-editor + vendor + app.
                     * @see [docs/webview-build.md#rollup-output](./docs/webview-build.md#rollup-output)
                     */
                    manualChunks: isDev
                        ? undefined
                        : (id) => {
                              const nid = id.replace(/\\/g, '/');
                              if (nid.includes('node_modules/monaco-editor')) return 'monaco-editor';
                              if (nid.includes('node_modules')) return 'vendor';
                          },
                },
            },
        },
        /**
         * Explicitly list large shared deps so Rolldown emits a separate
         * pre-bundle entry for each instead of merging everything into one giant
         * shared chunk that V8 has to parse on the main thread before render.
         * With separate files V8 can background-parse them in parallel.
         */
        optimizeDeps: {
            include: [
                '@griffel/core',
                '@griffel/react',
                'stylis',
                'rtl-css-js',
                '@emotion/hash',
                '@fluentui/react-components',
                '@fluentui/react-icons',
            ],
        },
        resolve: {
            mainFields: ['browser', 'module', 'main'],
            conditions: ['browser', 'import', 'default'],
            alias: {
                '@cosmosdb/nosql-language-service/monaco': path.resolve(
                    __dirname,
                    'packages/nosql-language-service/src/providers/monaco/index.ts',
                ),
                '@cosmosdb/nosql-language-service/services': path.resolve(
                    __dirname,
                    'packages/nosql-language-service/src/services/index.ts',
                ),
                '@cosmosdb/nosql-language-service': path.resolve(
                    __dirname,
                    'packages/nosql-language-service/src/index.ts',
                ),
            },
        },
        // CSS/SCSS handled natively by Vite (no css-loader/sass-loader needed).
        css: {
            preprocessorOptions: {
                scss: { api: 'modern' },
            },
        },
        plugins: [
            /**
             * Guard: webview code must not import `vscode` or Node built-ins.
             * @see [docs/webview-build.md#plugin-no-extension-imports](./docs/webview-build.md#plugin-no-extension-imports)
             */
            noExtensionImports(),
            /**
             * Dev: serve `/views.js` as a re-export of the real entry.
             * @see [docs/webview-build.md#plugin-webview-entry](./docs/webview-build.md#plugin-webview-entry)
             */
            webviewEntry(),
            react(),
            /**
             * Dev: inject React Refresh runtime preamble.
             * @see [docs/webview-build.md#plugin-react-refresh-preamble](./docs/webview-build.md#plugin-react-refresh-preamble)
             */
            reactRefreshPreamble(),
            /**
             * Monaco language workers + contributions.
             * @see [docs/webview-build.md#monaco-workers](./docs/webview-build.md#monaco-workers)
             */
            monacoWorkers(),
            /**
             * Inline emitted .css into views.js (prod). No-op in dev.
             * @see [docs/webview-build.md#plugin-inline-css](./docs/webview-build.md#plugin-inline-css)
             */
            inlineCss(),
            /**
             * Prod-only size tracking + opt-in HTML report.
             * @see [docs/webview-build.md#plugin-bundle-report](./docs/webview-build.md#plugin-bundle-report)
             */
            !isDev && bundleReport(),
            !isDev &&
                analyze &&
                analyzer({
                    analyzerMode: 'static',
                    fileName: path.resolve(__dirname, 'bundle-analysis/views-report-vite'),
                    openAnalyzer: false,
                }),
            viteStaticCopy({
                targets: [{ src: 'src/webviews/static/**/*', dest: 'static' }],
            }),
        ].filter(Boolean),
        server: {
            port: 18080,
            host: '127.0.0.1',
            /**
             * Absolute URLs against the dev server.
             * @see [docs/webview-build.md#server-origin](./docs/webview-build.md#server-origin)
             */
            origin: 'http://localhost:18080',
            /**
             * Wildcard CORS so the `vscode-webview://` origin can fetch.
             * @see [docs/webview-build.md#server-cors](./docs/webview-build.md#server-cors)
             */
            cors: { origin: '*' },
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
                'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
            },
            /**
             * Pre-transform all webview source files when the dev-server starts so
             * that the first panel open doesn't pay the cold-transform cost for every
             * module in the graph.
             *
             * Without this, Vite transforms each of the ~230 source files on-demand
             * (disk read + esbuild transform per request), adding ~1.5 s to the first
             * panel open via sequential HTTP waterfall.  After warmup those files are
             * served from Vite's in-memory module cache with near-zero latency.
             *
             * `clientFiles` accepts fast-glob patterns relative to the project root.
             */
            warmup: {
                clientFiles: ['src/webviews/**/*.{ts,tsx,scss}', 'packages/*/src/**/*.{ts,tsx}'],
            },
        },
    };
};
