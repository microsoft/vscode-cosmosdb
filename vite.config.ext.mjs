/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { builtinModules } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzer } from 'vite-bundle-analyzer';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Node built-ins that must stay external (available natively in Node.js runtime) */
const NODE_EXTERNALS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const excludeRegion = /<!-- region exclude-from-marketplace -->.*?<!-- endregion exclude-from-marketplace -->/gis;
const supportedLanguages = [
    'cs',
    'de',
    'es',
    'fr',
    'it',
    'ja',
    'ko',
    'pl',
    'pt-BR',
    'ru',
    'tr',
    'zh-Hans',
    'zh-Hant',
    'qps-ploc',
]; // From VSCode L10n

export default ({ mode }) => {
    const isDev = mode === 'development';

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
                },
            },
        },
        resolve: {
            conditions: ['import', 'require', 'node'],
            mainFields: ['module', 'main'],
            extensions: ['.ts', '.js'],
            alias: {
                '@cosmosdb/nosql-language-service/vscode': path.resolve(
                    __dirname,
                    'packages/nosql-language-service/src/providers/vscode/index.ts',
                ),
                '@cosmosdb/nosql-language-service/services': path.resolve(
                    __dirname,
                    'packages/nosql-language-service/src/services/index.ts',
                ),
                '@cosmosdb/nosql-language-service': path.resolve(
                    __dirname,
                    'packages/nosql-language-service/src/index.ts',
                ),
                '@cosmosdb/schema-analyzer/json': path.resolve(__dirname, 'packages/schema-analyzer/src/json/index.ts'),
                '@cosmosdb/schema-analyzer/bson': path.resolve(__dirname, 'packages/schema-analyzer/src/bson/index.ts'),
                '@cosmosdb/schema-analyzer': path.resolve(__dirname, 'packages/schema-analyzer/src/index.ts'),
            },
        },
        define: {
            'process.env.NODE_ENV': JSON.stringify(mode ?? 'development'),
            'process.env.IS_BUNDLE': JSON.stringify('true'),
            'process.env.DEVSERVER': JSON.stringify(isDev ? 'true' : ''),
        },
        plugins: [
            viteStaticCopy({
                targets: [
                    {
                        src: `l10n/bundle.l10n.{${supportedLanguages.join(',')}}.json`,
                        dest: 'l10n',
                    },
                    { src: 'resources', dest: '.' },
                    {
                        src: 'package.json',
                        dest: '.',
                        transform: (content) => {
                            const pkg = JSON.parse(content);
                            pkg.main = './main.mjs';
                            return JSON.stringify(pkg, null, 2);
                        },
                    },
                    { src: 'package.nls.json', dest: '.' },
                    {
                        src: `package.nls.{${supportedLanguages.join(',')}}.json`,
                        dest: '.',
                    },
                    { src: 'CHANGELOG.md', dest: '.' },
                    { src: 'LICENSE.md', dest: '.' },
                    { src: 'NOTICE.html', dest: '.' },
                    {
                        src: 'README.md',
                        dest: '.',
                        transform: isDev ? undefined : (content) => content.toString().replace(excludeRegion, ''),
                    },
                    { src: 'skills', dest: '.' },
                    {
                        src: 'packages/nosql-language-service/syntaxes',
                        dest: 'syntaxes',
                        rename: (_fileName, _fileExtension, fullPath) => path.basename(fullPath),
                    },
                    {
                        src: 'packages/nosql-language-service/language-configuration.json',
                        dest: '.',
                    },
                    { src: 'SECURITY.md', dest: '.' },
                    { src: 'SUPPORT.md', dest: '.' },
                    { src: '.vscodeignore', dest: '.' },
                ],
            }),
            !isDev &&
                analyzer({
                    analyzerMode: 'static',
                    fileName: path.resolve(__dirname, 'bundle-analysis/extension-report-vite'),
                    openAnalyzer: false,
                }),
        ].filter(Boolean),
    };
};

