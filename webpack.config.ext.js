/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const webpack = require('webpack');
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const StatoscopeWebpackPlugin = require('@statoscope/webpack-plugin').default;

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

module.exports = (env, { mode }) => {
    const isDev = mode === 'development';

    return {
        target: 'node',
        mode: mode || 'none',
        node: { __filename: false, __dirname: false },
        entry: {
            main: './main.ts',
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
            chunkFormat: 'commonjs',
            libraryTarget: 'commonjs2',
            devtoolModuleFilenameTemplate: '[resource-path]',
        },
        cache: {
            type: 'filesystem',
            name: `extension-build${isDev ? '-dev' : ''}`, // Unique name for this build
            cacheDirectory: path.resolve(__dirname, 'node_modules/.cache/webpack/extension'),
            buildDependencies: {
                config: [__filename],
            },
        },
        optimization: {
            minimize: !isDev,
            // Tree-shaking configuration:
            // - Set both to `true` to enable tree-shaking (slower builds, smaller bundles)
            // - Set both to `false` for faster builds (current: optimized for speed)
            usedExports: !isDev, // false = faster builds (+2s saved) | true = smaller bundle (-10-20%)
            sideEffects: !isDev, // false = skip analysis (+1s saved) | true = remove unused modules
            runtimeChunk: !isDev,
        },
        externalsType: 'node-commonjs',
        externals: {
            vs: 'vs',
            vscode: 'commonjs vscode',
        },
        resolve: {
            roots: [__dirname],
            conditionNames: ['import', 'require', 'node'],
            mainFields: ['module', 'main'],
            extensions: ['.js', '.ts'],
        },
        module: {
            rules: [
                {
                    test: /\.(ts)$/iu,
                    exclude: /node_modules/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true, // Skip type checking for faster builds
                        },
                    },
                },
            ],
        },
        plugins: [
            !isDev &&
                new StatoscopeWebpackPlugin({
                    saveReportTo: 'bundle-analysis/extension-report.html',
                    saveStatsTo: 'bundle-analysis/extension-stats.json',
                    open: false,
                    statsOptions: {
                        source: false, // Exclude source code to reduce file size
                        reasons: false,
                        chunks: true,
                        chunkModules: true,
                        chunkOrigins: false,
                        modules: true,
                        maxModules: Infinity,
                        exclude: false,
                        assets: true,
                        performance: false,
                        errorDetails: false,
                    },
                }),
            new webpack.EnvironmentPlugin({
                NODE_ENV: mode,
                IS_BUNDLE: 'true',
                DEVSERVER: isDev ? 'true' : '',
            }),
            // Copy everything what is needed to run the extension
            // - We can't bundle everything into one file because system-dependent binaries in node_modules
            // - We mustn't change source code as it does the old packaging script
            // - The dist folder should be ready to be published to the marketplace and be only one working folder
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: 'l10n',
                        to: 'l10n',
                        noErrorOnMissing: true,
                        filter: (filepath) =>
                            new RegExp(`bundle.l10n.(${supportedLanguages.join('|')}).json`).test(filepath), // Only supported languages
                    },
                    {
                        from: 'resources',
                        to: 'resources',
                    },
                    {
                        from: 'package.json',
                        to: 'package.json',
                    },
                    {
                        from: 'package.nls.json',
                        to: 'package.nls.json',
                    },
                    {
                        from: 'package.nls.*.json',
                        to: '[name][ext]',
                        noErrorOnMissing: true,
                        filter: (filepath) =>
                            new RegExp(`package.nls.(${supportedLanguages.join('|')}).json`).test(filepath), // Only supported languages
                    },
                    {
                        from: 'CHANGELOG.md',
                        to: 'CHANGELOG.md',
                    },
                    {
                        from: 'LICENSE.md',
                        to: 'LICENSE.md',
                    },
                    {
                        from: 'NOTICE.html',
                        to: 'NOTICE.html',
                    },
                    {
                        from: 'README.md',
                        to: 'README.md',
                        transform: isDev ? undefined : (content) => content.toString().replace(excludeRegion, ''),
                    },
                    {
                        from: 'SECURITY.md',
                        to: 'SECURITY.md',
                    },
                    {
                        from: 'SUPPORT.md',
                        to: 'SUPPORT.md',
                    },
                    {
                        from: '.vscodeignore',
                        to: '.vscodeignore',
                        toType: 'file',
                    },
                ],
                options: {
                    // Parallel copying: copies up to 100 files simultaneously (saves ~1-2 seconds)
                    // Increase to 200 for faster copying, decrease to 50 to reduce memory usage
                    concurrency: 100,
                },
            }),
        ].filter(Boolean),
        devtool: isDev ? 'eval-source-map' : false,
        infrastructureLogging: {
            level: 'log', // enables logging required for problem matchers
        },
    };
};
