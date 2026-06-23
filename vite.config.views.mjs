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
import { bundleReport } from './plugins/vite-plugin-bundle-report.mjs';
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
         * Monaco workers: `?worker&inline` in prod (build), same-origin Blob
         * trampoline over `?worker&url` in dev (serve) — see the monacoWorkers
         * plugin and docs/webview-build.md#monaco-workers.
         */
        worker: { format: 'es' },
        build: {
            target: 'esnext',
            outDir: 'dist',
            emptyOutDir: false, // Extension build also writes to dist.
            sourcemap: isDev,
            minify: !isDev,
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
                     * Explicit chunk strategy. Without this, when several
                     * dynamic entries share code Rolldown picks an arbitrary
                     * source file as the shared-chunk name — e.g. all the
                     * Fluent UI bits shared between Document and QueryEditor
                     * ended up in a `ToolbarOverflowButton-*.js` chunk.
                     *
                     * Goals:
                     *  - Cacheable vendor chunks (fluentui / griffel / react /
                     *    monaco) that rarely change between app releases.
                     *  - Predictable, named chunks instead of file-name lottery.
                     *  - Parallel-loadable: a few medium chunks beat one huge.
                     *
                     * @see [docs/webview-build.md#manual-chunks](./docs/webview-build.md#manual-chunks)
                     */
                    manualChunks(id) {
                        // monaco-editor — huge, isolated, almost never changes.
                        if (id.includes('node_modules/monaco-editor/')) {
                            return 'monaco-editor';
                        }

                        // Fluent UI — used by every view. Single chunk so a
                        // version bump invalidates one file, not many.
                        if (id.includes('node_modules/@fluentui/')) {
                            return 'fluentui';
                        }

                        // Griffel + its CSS-in-JS deps. Split out from
                        // `fluentui` so each can be cached independently.
                        if (
                            id.includes('node_modules/@griffel/') ||
                            id.includes('node_modules/stylis/') ||
                            id.includes('node_modules/rtl-css-js/') ||
                            id.includes('node_modules/@emotion/hash/')
                        ) {
                            return 'griffel';
                        }

                        // React runtime — small but used everywhere.
                        if (
                            id.includes('node_modules/react/') ||
                            id.includes('node_modules/react-dom/') ||
                            id.includes('node_modules/scheduler/')
                        ) {
                            return 'react';
                        }

                        // react-data-grid — only Document + QueryEditor use it,
                        // so keep it out of `vendor` (which loads for every view
                        // including MigrationAssistant).
                        if (id.includes('node_modules/react-data-grid/')) {
                            return 'react-data-grid';
                        }

                        // Catch-all for the rest of node_modules
                        // (es-toolkit, allotment, uuid, vscode-webview, …).
                        if (id.includes('node_modules/')) {
                            return 'vendor';
                        }

                        // App code: let Rolldown decide. With vendor extracted
                        // above, any shared app chunk now contains only real
                        // shared components (e.g. the ToolbarOverflowButton
                        // wrapper itself, ~5 KB instead of ~600 KB).
                        return undefined;
                    },
                },
            },
        },
        /**
         * Dev-server only: pre-bundle these large deps with esbuild so the
         * first page load doesn't trigger on-demand transformation of hundreds
         * of Fluent UI / Griffel modules. Has no effect on the production
         * build — prod chunk splitting is controlled by
         * `build.rollupOptions.output.manualChunks` above.
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
                // NB: only client + shared (no /server — that's vscode/Node-only and the
                // noExtensionImports plugin would refuse it anyway).
                '@cosmosdb/webview-rpc/client': path.resolve(__dirname, 'packages/webview-rpc/src/client/index.ts'),
                '@cosmosdb/webview-rpc/react': path.resolve(__dirname, 'packages/webview-rpc/src/react/index.ts'),
                '@cosmosdb/webview-rpc': path.resolve(__dirname, 'packages/webview-rpc/src/index.ts'),
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
             * Prod-only size tracking + opt-in HTML report.
             * @see [docs/webview-build.md#plugin-bundle-report](./docs/webview-build.md#plugin-bundle-report)
             */
            !isDev && !analyze && bundleReport({ outFile: 'bundle-analysis/views-report-vite.json' }),
            !isDev &&
                analyze &&
                analyzer({
                    analyzerMode: 'static',
                    fileName: path.resolve(__dirname, 'bundle-analysis/views-report-vite'),
                    openAnalyzer: false,
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
