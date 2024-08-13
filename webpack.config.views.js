#!/usr/bin/env node
/* eslint-env node */

const path = require('path');
const webpack = require('webpack');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

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
        },
        experiments: {
            outputModule: true,
        },
        resolve: {
            roots: [__dirname],
            extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
        optimization: {
            minimize: !isDev,
        },
        module: {
            rules: [
                {
                    test: /\.(tsx?)?$/iu,
                    use: ['swc-loader'],
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
                    test: /\.js$/,
                    enforce: 'pre',
                    use: ['source-map-loader'],
                    exclude: /node_modules/u,
                },
                {
                    test: /\.ttf$/,
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
            new MonacoWebpackPlugin({
                languages: ['sql'],
            }),
            new webpack.ProvidePlugin({
                React: 'react',
            }),
            isDev && new ReactRefreshWebpackPlugin(),
            new CopyWebpackPlugin({
                patterns: [{ from: 'src/webviews/static', to: 'static', noErrorOnMissing: true }].filter(Boolean),
            }),
        ].filter(Boolean),
        devtool: isDev ? 'source-map' : false,
        infrastructureLogging: {
            level: 'log', // enables logging required for problem matchers
        },
    };
};
