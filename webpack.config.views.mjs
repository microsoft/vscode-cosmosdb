/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactRefreshWebpackPlugin from '@pmmmwh/react-refresh-webpack-plugin';
import _StatoscopePlugin from '@statoscope/webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import MonacoWebpackPlugin from 'monaco-editor-webpack-plugin';
import path from 'path';
import TerserPlugin from 'terser-webpack-plugin';
import { fileURLToPath } from 'url';
import webpack from 'webpack';

const StatoscopeWebpackPlugin = _StatoscopePlugin.default ?? _StatoscopePlugin;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default (env, { mode }) => {
    const isDev = mode === 'development';

    return {
        target: 'web',
        mode: mode || 'none',
        entry: {
            views: './src/webviews/index.tsx',
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
            libraryTarget: 'module',
            devtoolModuleFilenameTemplate: '[resource-path]',
        },
        cache: {
            type: 'filesystem',
            name: `views-build${isDev ? '-dev' : ''}`,
            cacheDirectory: path.resolve(__dirname, 'node_modules/.cache/webpack/views'),
            buildDependencies: {
                config: [__filename],
            },
        },
        experiments: {
            outputModule: true,
        },
        resolve: {
            roots: [__dirname],
            extensions: ['.js', '.jsx', '.ts', '.tsx'],
            mainFields: ['browser', 'module', 'main'],
            conditionNames: ['browser', 'import', 'default'],
            // Map .js imports to .ts files for workspace packages using NodeNext resolution
            extensionAlias: {
                '.js': ['.ts', '.js'],
            },
        },
        optimization: {
            usedExports: !isDev,
            sideEffects: !isDev,
            minimize: !isDev,
            minimizer: !isDev
                ? [
                      new TerserPlugin({
                          terserOptions: {
                              compress: {
                                  drop_console: false,
                                  drop_debugger: !isDev,
                                  pure_funcs: isDev ? [] : ['console.debug'],
                              },
                              mangle: true,
                              format: {
                                  comments: false,
                              },
                          },
                          extractComments: false,
                      }),
                  ]
                : undefined,
            splitChunks: {
                chunks: 'all',
                maxInitialRequests: Infinity,
                minSize: 20000,
                cacheGroups: {
                    monaco: {
                        test: /[\\/]node_modules[\\/]monaco-editor[\\/]/,
                        name: 'monaco-editor',
                        priority: 50,
                        reuseExistingChunk: true,
                    },
                    react: {
                        test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                        name: 'react-vendor',
                        priority: 40,
                        reuseExistingChunk: true,
                    },
                    fluentIcons: {
                        test: /[\\/]node_modules[\\/]@fluentui[\\/]react-icons[\\/]/,
                        name: 'fluent-icons',
                        priority: 35,
                        reuseExistingChunk: true,
                    },
                    fluent: {
                        test: /[\\/]node_modules[\\/]@fluentui[\\/]/,
                        name: 'fluent-ui',
                        priority: 30,
                        reuseExistingChunk: true,
                    },
                    vendor: {
                        test: /[\\/]node_modules[\\/]/,
                        name: 'vendor',
                        priority: 20,
                        reuseExistingChunk: true,
                    },
                },
            },
            runtimeChunk: false,
        },
        module: {
            rules: [
                {
                    test: /\.(tsx?)?$/iu,
                    use: [
                        {
                            loader: 'ts-loader',
                            options: {
                                transpileOnly: true,
                                // Override module settings so that all files are emitted as ESM.
                                // ts.transpileModule() cannot read the filesystem to check
                                // package.json "type", so NodeNext defaults to CJS for .ts files,
                                // which breaks webpack's ESM output (outputModule: true).
                                compilerOptions: {
                                    module: 'ESNext',
                                    moduleResolution: 'Bundler',
                                },
                            },
                        },
                    ],
                    exclude: /node_modules/u,
                },
                {
                    test: /\.css$/i,
                    use: ['style-loader', 'css-loader'],
                },
                {
                    test: /\.s[ac]ss$/i,
                    use: ['style-loader', 'css-loader', 'sass-loader'],
                },
                {
                    test: /\.ttf$/,
                    type: 'asset/resource',
                },
                {
                    test: /\.woff2?$/,
                    type: 'asset/resource',
                },
            ],
        },
        devServer: {
            static: {
                directory: path.join(__dirname, 'src/webviews/static'),
                publicPath: '/static',
            },
            allowedHosts: 'all',
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
                'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
            },
            hot: true,
            host: '127.0.0.1',
            client: { overlay: true },
            compress: true,
            port: 18080,
            webSocketServer: 'ws',
        },
        plugins: [
            !isDev &&
                new StatoscopeWebpackPlugin({
                    saveReportTo: 'bundle-analysis/views-report.html',
                    saveStatsTo: 'bundle-analysis/views-stats.json',
                    open: false,
                    statsOptions: {
                        source: false,
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
            new MonacoWebpackPlugin({ languages: ['sql', 'json'] }),
            new webpack.ProvidePlugin({ React: 'react' }),
            isDev && new webpack.HotModuleReplacementPlugin(),
            isDev && new ReactRefreshWebpackPlugin(),
            new CopyWebpackPlugin({
                patterns: [{ from: 'src/webviews/static', to: 'static', noErrorOnMissing: true }].filter(Boolean),
            }),
        ].filter(Boolean),
        devtool: isDev ? 'source-map' : false,
        infrastructureLogging: {
            level: 'log',
        },
    };
};
