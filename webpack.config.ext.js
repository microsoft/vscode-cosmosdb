/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

// See https://github.com/Microsoft/vscode-azuretools/wiki/webpack for guidance

'use strict';

const webpack = require('webpack');
const dev = require('@microsoft/vscode-azext-dev');
const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, { mode }) => {
    const isDev = mode === 'development';

    return {
        target: 'node',
        mode: mode || 'none',
        node: { __filename: false, __dirname: false },
        entry: {
            // 'extension.bundle.ts': './src/extension.ts', // Is still necessary?
            './mongo-languageServer.bundle': './src/mongo/languageServer.ts',
            main: './main.ts',
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
            chunkFormat: 'commonjs',
            libraryTarget: 'commonjs2',
            devtoolModuleFilenameTemplate: '[resource-path]',
        },
        externalsType: 'node-commonjs',
        externals: {
            vs: 'vs',
            vscode: 'commonjs vscode',
            /* Mongodb optional dependencies */
            kerberos: 'commonjs kerberos',
            '@mongodb-js/zstd': 'commonjs @mongodb-js/zstd',
            '@aws-sdk/credential-providers': 'commonjs @aws-sdk/credential-providers',
            'gcp-metadata': 'commonjs gcp-metadata',
            snappy: 'commonjs snappy',
            socks: 'commonjs socks',
            aws4: 'commonjs aws4',
            'mongodb-client-encryption': 'commonjs mongodb-client-encryption',
            /* PG optional dependencies */
            'pg-native': 'commonjs pg-native',
        },
        resolve: {
            roots: [__dirname],
            extensions: ['.js', '.ts'],
        },
        module: {
            rules: [
                {
                    test: /\.(ts)$/iu,
                    use: {
                        loader: 'swc-loader',
                        options: {
                            module: {
                                type: 'commonjs',
                            },
                            isModule: true,
                            sourceMaps: isDev,
                            minify: !isDev,
                            jsc: {
                                baseUrl: path.resolve(__dirname, './'),  // Set absolute path here
                                minify: {
                                    compress: !isDev,
                                    mangle: isDev
                                        ? false
                                        : {
                                              keep_classnames: true,
                                              keep_fnames: true,
                                          },
                                },
                                keepClassNames: true,
                                target: 'es2021',
                                parser: {
                                    syntax: 'typescript',
                                    tsx: true,
                                    functionBind: false,
                                    decorators: true,
                                    dynamicImport: true,
                                },
                            },
                        },
                    },
                },
            ],
        },
        plugins: [
            new webpack.EnvironmentPlugin({
                NODE_ENV: mode,
                MONGO_LANGUAGE_SERVER_PATH: 'mongo-languageServer.bundle.js',
            }),
            // Copy everything what is needed to run the extension
            // - We can't bundle everything into one file because system-dependent binaries in node_modules
            // - We mustn't change source code as it does the old packaging script
            // - The dist folder should be ready to be published to the marketplace and be only one working folder
            new CopyWebpackPlugin({
                patterns: [
                    // Test files -> dist/test (these files are ignored during packaging)
                    {
                        from: '**/*',
                        context: path.posix.join(__dirname.replace(/\\/g, '/'), 'out', 'test'),
                        to: path.posix.join(__dirname.replace(/\\/g, '/'), 'dist', 'test'),
                        noErrorOnMissing: true,
                    },
                    {
                        from: 'grammar',
                        to: 'grammar',
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
                        from: 'CHANGELOG.md',
                        to: 'CHANGELOG.md',
                    },
                    {
                        from: 'CODE_OF_CONDUCT.md',
                        to: 'CODE_OF_CONDUCT.md',
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
                    },
                    {
                        from: 'SECURITY.md',
                        to: 'SECURITY.md',
                    },
                    {
                        from: 'SUPPORT.md',
                        to: 'SUPPORT.md',
                    },
                ],
            }),
            // TODO: Is still necessary?
            // Replace vscode-languageserver/lib/files.js with a modified version that doesn't have webpack issues
            new webpack.NormalModuleReplacementPlugin(
                /[/\\]vscode-languageserver[/\\]lib[/\\]files\.js/,
                require.resolve('./build/vscode-languageserver-files-stub.js'),
            ),
        ].filter(Boolean),
        devtool: isDev ? 'source-map' : false,
        infrastructureLogging: {
            level: 'log', // enables logging required for problem matchers
        },
    };
};
