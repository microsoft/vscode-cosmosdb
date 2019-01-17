/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

// Using webpack helps reduce the install and startup time of large extensions by reducing the large number of files into a much smaller set
// Full webpack documentation: [https://webpack.js.org/configuration/]().

'use strict';

const path = require('path');
const process = require('process');
const webpack = require('webpack');
const fse = require('fs-extra');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const StringReplacePlugin = require("string-replace-webpack-plugin");
const dev = require("vscode-azureextensiondev");

const packageLock = fse.readJSONSync('./package-lock.json');

let DEBUG_WEBPACK = !!process.env.DEBUG_WEBPACK;

let config = dev.getDefaultWebpackConfig({
    projectRoot: __dirname,
    verbosity: DEBUG_WEBPACK ? 'normal' : 'debug',

    externalNodeModules: [
        // Modules that we can't easily webpack for some reason.
        // These and their dependencies will be copied into node_modules rather than placed in the bundle
        // Keep this list small, because all the subdependencies will also be excluded
        'require_optional',
        'gremlin',
        'socket.io',
        'mongodb-core'
    ],
    entries: {
        // Note: Each entry is a completely separate Node.js application that cannot interact with any
        // of the others, and that individually includes all dependencies necessary (i.e. common
        // dependencies will have a copy in each entry file, no sharing).

        // Create a separate module bundle for the mongo language server (doesn't share any code with main extension.js)
        './mongo-languageServer': './src/mongo/languageServer.ts'
    },

    externals:
    {
        // Fix "Module not found" errors in ./node_modules/websocket/lib/{BufferUtil,Validation}.js
        //   and 'ws' module.
        // These files are not in node_modules and so will fail normally at runtime and instead use fallbacks.
        // Make them as external so webpack doesn't try to process them, and they'll simply fail at runtime as before.
        '../build/Release/validation': 'commonjs ../build/Release/validation',
        '../build/default/validation': 'commonjs ../build/default/validation',
        '../build/Release/bufferutil': 'commonjs ../build/Release/bufferutil',
        '../build/default/bufferutil': 'commonjs ../build/default/bufferutil',
        'bufferutil': 'commonjs bufferutil',
        'utf-8-validate': 'commonjs utf-8-validate',

        // Fix "module not found" error in node_modules/es6-promise/dist/es6-promise.js
        'vertx': 'commonjs vertx',
    }, // end of externals

    loaderRules: [
        {
            // Fix error:
            //   > WARNING in ./node_modules/engine.io/lib/server.js 67:43-65
            //   > Critical dependency: the request of a dependency is an expression
            // in this code:
            //   var WebSocketServer = (this.wsEngine ? require(this.wsEngine) : require('ws')).Server;
            test: /engine\.io[/\\]lib[/\\]server.js$/,
            loader: StringReplacePlugin.replace({
                replacements: [
                    {
                        pattern: /var WebSocketServer = \(this.wsEngine \? require\(this\.wsEngine\) : require\('ws'\)\)\.Server;/ig,
                        replacement: function (match, offset, string) {
                            // Since we're not using the wsEngine option, we'll just require it to not be set and use only the `require('ws')` call.
                            return `if (!!this.wsEngine) {
                                            throw new Error('wsEngine option not supported with current webpack settings');
                                        }
                                        var WebSocketServer = require('ws').Server;`;
                        }
                    }
                ]
            })
        },

        {
            // Fix warning:
            //   > WARNING in ./node_modules/cross-spawn/index.js
            //   > Module not found: Error: Can't resolve 'spawn-sync' in 'C:\Users\<user>\Repos\vscode-cosmosdb\node_modules\cross-spawn'
            //   > @ ./node_modules/cross-spawn/index.js
            // in this code:
            //   cpSpawnSync = require('spawn-sync');  // eslint-disable-line global-require
            test: /cross-spawn[/\\]index\.js$/,
            loader: StringReplacePlugin.replace({
                replacements: [
                    {
                        pattern: /cpSpawnSync = require\('spawn-sync'\);/ig,
                        replacement: function (match, offset, string) {
                            // The code in question only applies to Node 0.10 or less (see comments in code), so just throw an error
                            return `throw new Error("This shouldn't happen"); // MODIFIED`;
                        }
                    }
                ]
            })
        }
    ], // end of loaderRules

    plugins: [
        // Replace vscode-languageserver/lib/files.js with a modified version that doesn't have webpack issues
        new webpack.NormalModuleReplacementPlugin(
            /[/\\]vscode-languageserver[/\\]lib[/\\]files\.js/,
            require.resolve('./build/vscode-languageserver-files-stub.js')
        )
    ] // end of plugins
});

if (DEBUG_WEBPACK) {
    console.log('Config:', config);
}

module.exports = config;
