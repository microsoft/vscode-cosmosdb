/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const webpack = require('webpack');
const path = require('path');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const StatoscopeWebpackPlugin = require('@statoscope/webpack-plugin').default;
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, { mode }) => {
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
            name: `views-build${isDev ? '-dev' : ''}`, // Unique name for this build
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
            // Prefer browser-compatible versions of packages
            mainFields: ['browser', 'module', 'main'],
            // Use 'import' and 'default' conditions (NOT 'node') to get browser versions
            // This makes uuid use dist/index.js instead of dist-node/index.js
            conditionNames: ['browser', 'import', 'default'],
        },
        optimization: {
            // Tree-shaking configuration:
            // - In PRODUCTION: Enabled to reduce bundle size (important for web bundles downloaded over network)
            // - In DEVELOPMENT: Disabled for faster builds and better debugging
            usedExports: !isDev, // Only analyze exports in production (saves ~2s in dev)
            sideEffects: !isDev, // Only analyze side effects in production (saves ~1s in dev)
            minimize: !isDev, // Only minify in production
            minimizer: !isDev
                ? [
                      // TerserPlugin: Minifies JavaScript for smaller bundle sizes (production only)
                      new TerserPlugin({
                          terserOptions: {
                              compress: {
                                  drop_console: false, // Keep console for debugging
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
                : undefined, // No minimizer in development - faster builds, readable code
            // Code splitting: Separates vendor code into separate chunks for better caching
            // When users revisit, they only re-download changed app code, not all dependencies
            splitChunks: {
                chunks: 'all',
                maxInitialRequests: Infinity,
                minSize: 20000, // Only split chunks larger than 20KB
                cacheGroups: {
                    // Monaco Editor - separate chunk (~500KB) for better caching
                    // Changes rarely, so cached separately from app code
                    monaco: {
                        test: /[\\/]node_modules[\\/]monaco-editor[\\/]/,
                        name: 'monaco-editor',
                        priority: 50,
                        reuseExistingChunk: true,
                    },
                    // React and React DOM - separate chunk (~150KB)
                    // Core framework, changes rarely
                    react: {
                        test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                        name: 'react-vendor',
                        priority: 40,
                        reuseExistingChunk: true,
                    },
                    // FluentUI icons - separate chunk (~200KB)
                    // Icon font, changes rarely
                    fluentIcons: {
                        test: /[\\/]node_modules[\\/]@fluentui[\\/]react-icons[\\/]/,
                        name: 'fluent-icons',
                        priority: 35,
                        reuseExistingChunk: true,
                    },
                    // Other FluentUI packages - UI component library
                    fluent: {
                        test: /[\\/]node_modules[\\/]@fluentui[\\/]/,
                        name: 'fluent-ui',
                        priority: 30,
                        reuseExistingChunk: true,
                    },
                    // All other node_modules - remaining dependencies
                    vendor: {
                        test: /[\\/]node_modules[\\/]/,
                        name: 'vendor',
                        priority: 20,
                        reuseExistingChunk: true,
                    },
                },
            },
            runtimeChunk: false, // Keep runtime inline (small, changes with each build)
        },
        module: {
            rules: [
                {
                    test: /\.(tsx?)?$/iu,
                    use: [
                        {
                            loader: 'ts-loader',
                            options: {
                                // Transpile only, skip type checking
                                // This allows our custom loader to transform imports
                                transpileOnly: true,
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
                    use: [
                        // Creates `style` nodes from JS strings
                        'style-loader',
                        // Translates CSS into CommonJS
                        'css-loader',
                        // Compiles Sass to CSS
                        'sass-loader',
                    ],
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
            client: {
                overlay: true,
            },
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
            new MonacoWebpackPlugin({ languages: ['sql', 'json'] }),
            new webpack.ProvidePlugin({ React: 'react' }),
            isDev && new webpack.HotModuleReplacementPlugin(),
            isDev && new ReactRefreshWebpackPlugin(),
            new CopyWebpackPlugin({
                patterns: [{ from: 'src/webviews/static', to: 'static', noErrorOnMissing: true }].filter(Boolean),
            }),
        ].filter(Boolean),
        devtool: isDev ? 'eval-source-map' : false,
        infrastructureLogging: {
            level: 'log', // enables logging required for problem matchers
        },
    };
};
