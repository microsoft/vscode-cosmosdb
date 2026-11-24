/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { builtinModules } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';
import { analyzer } from 'vite-bundle-analyzer';
import { bundleReport } from './plugins/vite-plugin-bundle-report.mjs';
import { copyStaticAssets } from './plugins/vite-plugin-copy-static-assets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Opt-in HTML bundle report. @see [docs/webview-build.md#plugin-bundle-report](./docs/webview-build.md#plugin-bundle-report) */
const analyze = !!process.env.BUNDLE_ANALYZE;

/** Node built-ins that must stay external (available natively in Node.js runtime) */
const NODE_EXTERNALS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const marketplaceExcludedRegion =
    /<!-- region exclude-from-marketplace -->.*?<!-- endregion exclude-from-marketplace -->/gis;
const shippedLocales = '{cs,de,es,fr,it,ja,ko,pl,pt-BR,ru,tr,zh-Hans,zh-Hant,qps-ploc}';

export default ({ mode }) => {
    const isDev = mode === 'development';
    const env = isDev ? loadEnv(mode, __dirname, 'COSMOSDB_WEBVIEW_') : {};
    if (isDev && !env.COSMOSDB_WEBVIEW_ORIGIN) {
        throw new Error('COSMOSDB_WEBVIEW_ORIGIN must be set in the development environment.');
    }

    return {
        build: {
            target: 'node22',
            outDir: 'dist',
            emptyOutDir: false, // Views build also writes to dist
            sourcemap: isDev,
            minify: !isDev,
            lib: {
                entry: path.resolve(__dirname, 'main.ts'),
                formats: ['es'],
                fileName: 'main',
            },
            rollupOptions: {
                // Only externalize vscode, vs, and node built-ins.
                // Everything else (npm packages) is bundled into main.mjs.
                external: (id) => {
                    if (id === 'vscode' || id === 'vs') return true;
                    if (NODE_EXTERNALS.has(id) || id.startsWith('node:')) return true;
                    return false;
                },
                output: {
                    entryFileNames: '[name].mjs',
                    chunkFileNames: '[name]-[hash].mjs',
                    // CJS interop: bundled CJS packages may call require() at runtime.
                    // Since the output is ESM, require is not defined — inject it via createRequire.
                    banner: `import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);`,
                    /**
                     * Explicit chunk strategy for the extension bundle.
                     *
                     * Unlike the webview build there is no browser HTTP cache
                     * or parallel-loading benefit here — the extension is a
                     * single ESM entry loaded by Node.js. The only real goal
                     * is **bundle-report readability**: without this, Rolldown
                     * names every shared vendor chunk after an arbitrary
                     * source file (e.g. `src-XXX.mjs`, `Index-XXX.mjs`,
                     * `esm-XXX.mjs`) so the report tells you nothing about
                     * what's actually in each file.
                     *
                     * **Important constraint — do NOT name chunks for code
                     * that is shared between the static graph and a dynamic
                     * import boundary.** Specifically, `@azure/arm-postgresql*`
                     * SDKs are lazy-loaded from `src/utils/azureClients.ts`,
                     * and their `@azure/core-*` runtime deps are shared with
                     * the eagerly-loaded `@azure/cosmos`, `@azure/identity`,
                     * and `@azure/arm-cosmosdb`. If we force-group the lazy
                     * SDKs into a named chunk, Rolldown folds the shared
                     * core code into them, which then becomes a static
                     * dependency of `main.mjs` and defeats the
                     * `await import()` lazy boundary.
                     *
                     * So we only name **pure-static** vendor groups here and
                     * let Rolldown's default splitting handle the lazy
                     * PostgreSQL ARM SDKs (with cryptic-but-correct
                     * `src-XXX.mjs` names).
                     *
                     * @see [docs/webview-build.md#manual-chunks](./docs/webview-build.md#manual-chunks)
                     */
                    manualChunks(id) {
                        // tslib (aliased above to its ESM build) — tiny,
                        // used by every legacy Azure SDK.
                        if (id.includes('node_modules/tslib/') || id.endsWith('tslib.es6.mjs')) {
                            return 'tslib';
                        }

                        // @azure/cosmos — data-plane SDK. Statically
                        // imported and used everywhere. Largest single
                        // static dep.
                        if (id.includes('node_modules/@azure/cosmos/')) {
                            return 'azure-cosmos';
                        }

                        // @azure/arm-cosmosdb — control-plane SDK. Used by
                        // RBAC, offers, account metadata and migration
                        // flows, i.e. effectively always; eagerly imported
                        // from `src/utils/azureClients.ts`. Safe to name
                        // because there is no longer a lazy boundary that
                        // shares core deps with it.
                        if (id.includes('node_modules/@azure/arm-cosmosdb/')) {
                            return 'azure-arm-cosmosdb';
                        }

                        // @azure/identity + MSAL — auth stack. Statically
                        // imported by extension activation.
                        if (id.includes('node_modules/@azure/identity/') || id.includes('node_modules/@azure/msal-')) {
                            return 'azure-identity';
                        }

                        // @microsoft/vscode-azext-* — VS Code Azure Extension
                        // shared utilities. Always loaded at activation.
                        if (id.includes('node_modules/@microsoft/vscode-azext-')) {
                            return 'vscode-azext';
                        }

                        // NB: deliberately no rule for `@azure/arm-postgresql*`
                        // or `@azure/core-*`. PostgreSQL ARM SDKs are still
                        // dynamically imported (`await import()` in
                        // `azureClients.ts`) and share core deps with the
                        // eagerly-loaded chunks above; forcing a name here
                        // breaks the lazy boundary (see header).

                        // App code and remaining node_modules
                        // (@trpc/*, @vscode/prompt-tsx, vscode-languageclient,
                        // zod, es-toolkit, semver, @prantlf/jsonlint, ajv,
                        // @azure/arm-postgresql*, @azure/core-*, …): let
                        // Rolldown decide. The auto-named chunks that show
                        // up are the PostgreSQL ARM lazy chunks and their
                        // shared Azure core deps.
                        return undefined;
                    },
                },
            },
        },
        resolve: {
            conditions: ['import', 'require', 'node'],
            mainFields: ['module', 'main'],
            extensions: ['.ts', '.js'],
            alias: {
                // Force tslib to its ESM build. Legacy Azure SDKs
                // (`@azure/arm-cosmosdb`, `@azure/arm-postgresql`,
                // `@azure/arm-postgresql-flexible`, …) compile to CJS with
                // `importHelpers: true` and pull in tslib. tslib's CJS entry
                // (`tslib.js`) attaches helpers directly onto `module.exports`
                // AND sets `module.exports.__esModule = true`. Rolldown's
                // `__toESM` interop helper sees `__esModule === true` and
                // therefore does NOT install a `.default` property on the
                // wrapped namespace — but the emitted destructure still reads
                // `.default`, producing the runtime crash:
                //   "Cannot destructure property '__extends' of
                //    '__toESM(...).default' as it is undefined."
                // Aliasing tslib to its ESM build sidesteps the broken
                // CJS-interop path entirely; the helpers come through as
                // plain named ESM exports.
                tslib: path.resolve(__dirname, 'node_modules/tslib/tslib.es6.mjs'),
                '@azure/cosmosdb-nosql-language-service/vscode': path.resolve(
                    __dirname,
                    'packages/nosql-language-service/src/providers/vscode/index.ts',
                ),
                '@azure/cosmosdb-nosql-language-service/services': path.resolve(
                    __dirname,
                    'packages/nosql-language-service/src/services/index.ts',
                ),
                '@azure/cosmosdb-nosql-language-service': path.resolve(
                    __dirname,
                    'packages/nosql-language-service/src/index.ts',
                ),
                '@azure/cosmosdb-schema-analyzer/json': path.resolve(
                    __dirname,
                    'packages/schema-analyzer/src/json/index.ts',
                ),
                '@azure/cosmosdb-schema-analyzer/bson': path.resolve(
                    __dirname,
                    'packages/schema-analyzer/src/bson/index.ts',
                ),
                '@azure/cosmosdb-schema-analyzer': path.resolve(__dirname, 'packages/schema-analyzer/src/index.ts'),
            },
        },
        define: {
            'process.env.NODE_ENV': JSON.stringify(mode ?? 'development'),
            'process.env.IS_BUNDLE': JSON.stringify('true'),
            'process.env.DEVSERVER': JSON.stringify(isDev ? 'true' : ''),
            'process.env.COSMOSDB_WEBVIEW_ORIGIN': JSON.stringify(isDev ? env.COSMOSDB_WEBVIEW_ORIGIN : ''),
        },
        plugins: [
            copyStaticAssets({
                targets: [
                    { src: `l10n/bundle.l10n.${shippedLocales}.json`, dest: 'l10n' },
                    { src: `package.nls.${shippedLocales}.json` },
                    { src: 'package.nls.json' },
                    { src: 'resources' },
                    { src: 'skills' },
                    { src: 'CHANGELOG.md' },
                    { src: 'LICENSE.md' },
                    { src: 'NOTICE.html' },
                    { src: 'SECURITY.md' },
                    { src: 'SUPPORT.md' },
                    { src: '.vscodeignore' },
                    { src: 'packages/nosql-language-service/syntaxes/nosql.tmLanguage.json', dest: 'syntaxes' },
                    { src: 'packages/nosql-language-service/language-configuration.json' },
                    {
                        src: 'package.json',
                        transform: (content) => {
                            const manifest = JSON.parse(content);
                            manifest.main = './main.mjs';
                            return JSON.stringify(manifest, null, 2);
                        },
                    },
                    {
                        src: 'README.md',
                        transform: isDev ? undefined : (content) => content.replace(marketplaceExcludedRegion, ''),
                    },
                ],
            }),
            !isDev && !analyze && bundleReport({ outFile: 'bundle-analysis/extension-report-vite.json' }),
            !isDev &&
                analyze &&
                analyzer({
                    analyzerMode: 'static',
                    fileName: path.resolve(__dirname, 'bundle-analysis/extension-report-vite'),
                    openAnalyzer: false,
                }),
        ].filter(Boolean),
    };
};
