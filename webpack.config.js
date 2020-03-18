/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

// See https://github.com/Microsoft/vscode-azuretools/wiki/webpack for guidance

'use strict';

const process = require('process');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const StringReplacePlugin = require("string-replace-webpack-plugin");
const dev = require("vscode-azureextensiondev");

let DEBUG_WEBPACK = !!process.env.DEBUG_WEBPACK;

let config = dev.getDefaultWebpackConfig({
    projectRoot: __dirname,
    verbosity: DEBUG_WEBPACK ? 'debug' : 'normal',

    externalNodeModules: [
        // Modules that we can't easily webpack for some reason.
        // These and their dependencies will be copied into node_modules rather than placed in the bundle
        // Keep this list small, because all the subdependencies will also be excluded
        'mongodb',
        'pg',
        'pg-structure'
    ],
    entries: {
        // Note: Each entry is a completely separate Node.js application that cannot interact with any
        // of the others, and that individually includes all dependencies necessary (i.e. common
        // dependencies will have a copy in each entry file, no sharing).

        // Create a separate module bundle for the mongo language server (doesn't share any code with extension.bundle.js)
        './mongo-languageServer.bundle': './src/mongo/languageServer.ts'
    },

    externals:
    {
        // ./getCoreNodeModule.js (path from keytar.ts) uses a dynamic require which can't be webpacked
        './getCoreNodeModule': 'commonjs getCoreNodeModule',
    }, // end of externals

    loaderRules: [
    ], // end of loaderRules


    plugins: [
        // Replace vscode-languageserver/lib/files.js with a modified version that doesn't have webpack issues
        new webpack.NormalModuleReplacementPlugin(

            /[/\\]vscode-languageserver[/\\]lib[/\\]files\.js/,
            require.resolve('./build/vscode-languageserver-files-stub.js')
        ),

        // Copy files to dist folder where the runtime can find them
        new CopyWebpackPlugin([
            // getCoreNodeModule.js -> dist/node_modules/getCoreNodeModule.js
            { from: './out/src/utils/getCoreNodeModule.js', to: 'node_modules' },
        ]),

        // An instance of the StringReplacePlugin plugin must be present for it to work (its use is configured in modules).
        new StringReplacePlugin()
    ]
});

if (DEBUG_WEBPACK) {
    console.log('Config:', config);
}

module.exports = config;
