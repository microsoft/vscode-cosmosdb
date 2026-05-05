/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzer } from 'vite-bundle-analyzer';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Vite plugin that fails the build immediately if any module in the browser
 * bundle tries to import from 'vscode' or a Node.js built-in ('node:*', 'fs',
 * 'path', 'os', …). This catches accidental extension-host code leaking into
 * the webview bundle at build time rather than at runtime.
 */
function noExtensionImportsPlugin() {
    const NODE_BUILTINS = new Set([
        'fs',
        'path',
        'os',
        'crypto',
        'stream',
        'http',
        'https',
        'net',
        'tls',
        'events',
        'assert',
        'util',
        'buffer',
        'url',
        'querystring',
        'child_process',
        'cluster',
        'dns',
        'domain',
        'readline',
        'repl',
        'string_decoder',
        'timers',
        'tty',
        'v8',
        'vm',
        'worker_threads',
        'zlib',
    ]);

    return {
        name: 'no-extension-imports',
        enforce: 'pre',
        resolveId(source) {
            if (source === 'vscode') {
                throw new Error(
                    `[no-extension-imports] Importing 'vscode' is not allowed in webview code.\n` +
                        `  Check the import chain that led to this import.`,
                );
            }
            if (source.startsWith('node:') || NODE_BUILTINS.has(source)) {
                throw new Error(
                    `[no-extension-imports] Importing Node.js built-in '${source}' is not allowed in webview code.\n` +
                        `  Check the import chain that led to this import.`,
                );
            }
        },
    };
}

export default ({ mode }) => {
    const isDev = mode === 'development';

    return {
        build: {
            target: 'esnext',
            outDir: 'dist',
            emptyOutDir: false, // Extension build also writes to dist
            sourcemap: isDev,
            minify: !isDev,
            rollupOptions: {
                input: path.resolve(__dirname, 'src/webviews/index.tsx'),
                output: {
                    format: 'es',
                    // Match filename expected by BaseTab.ts
                    entryFileNames: 'views.js',
                    chunkFileNames: '[name]-[hash].js',
                    // Manual chunks — splits large dependencies into separate files for better caching
                    manualChunks: isDev
                        ? undefined
                        : (id) => {
                              if (id.includes('node_modules/monaco-editor')) return 'monaco-editor';
                              if (id.includes('node_modules/react') || id.includes('node_modules/scheduler'))
                                  return 'react-vendor';
                              if (id.includes('node_modules/@fluentui/react-icons')) return 'fluent-icons';
                              if (id.includes('node_modules/@fluentui')) return 'fluent-ui';
                              if (id.includes('node_modules')) return 'vendor';
                          },
                },
            },
        },
        resolve: {
            extensions: ['.js', '.jsx', '.ts', '.tsx'],
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
        // CSS/SCSS handled natively by Vite (no css-loader/sass-loader needed)
        css: {
            preprocessorOptions: {
                scss: { api: 'modern' },
            },
        },
        plugins: [
            noExtensionImportsPlugin(),
            react(),
            // In dev server mode, serve /views.js as a re-export of the real entry so VSCode
            // webview can load it from http://localhost:18080/views.js with full HMR support.
            isDev && {
                name: 'vscode-webview-entry',
                configureServer(server) {
                    server.middlewares.use('/views.js', (_req, res) => {
                        res.setHeader('Content-Type', 'application/javascript');
                        res.end(`export * from "/src/webviews/index.tsx";`);
                    });
                },
            },
            // Monaco workers are bundled inline via Rolldown — no separate plugin needed.
            // If custom worker URLs are required, configure MonacoEnvironment in webview source.
            !isDev &&
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
            cors: true,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
                'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
            },
        },
    };
};

