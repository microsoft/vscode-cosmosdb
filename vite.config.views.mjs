/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { fileURLToPath } from 'url';
import react from '@vitejs/plugin-react';
import { analyzer } from 'vite-bundle-analyzer';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default ({ mode }) => {
    const isDev = mode === 'development';

    return {
        build: {
            target: 'esnext',
            outDir: 'dist',
            emptyOutDir: false, // Extension build also writes to dist
            sourcemap: isDev,
            minify: isDev ? false : 'esbuild',
            rollupOptions: {
                input: path.resolve(__dirname, 'src/webviews/index.tsx'),
                output: {
                    format: 'es',
                    // Match filename expected by BaseTab.ts
                    entryFileNames: 'views.js',
                    chunkFileNames: '[name]-[hash].js',
                    // Manual chunks — mirrors webpack splitChunks strategy
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
            react(),
            monacoEditorPlugin.default({ languageWorkers: ['json'] }),
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

