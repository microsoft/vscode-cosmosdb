// /*---------------------------------------------------------------------------------------------
//  *  Copyright (c) Microsoft Corporation. All rights reserved.
//  *  Licensed under the MIT License. See License.txt in the project root for license information.
//  *--------------------------------------------------------------------------------------------*/

// import * as assert from 'assert';
// import { ObjectID, ObjectId } from '../extension.bundle';
// import { Position } from 'vscode';
// import { parseError } from 'vscode-azureextensionui';
// import { MongoCommand } from '../extension.bundle';
// import * as cp from "child_process";
// import { getAllCommandsFromText, getCommandFromTextAtLocation } from '../extension.bundle';

// suite("MongoShell", () => {
//     let mongodCP: cp.ChildProcess;

//     suiteSetup(() => {
//         mongodCP = cp.spawn(
//             "mongod2",
//             [],
//             {
//                 shell: true
//             });

//         mongodCP.on("data", (buffer: Buffer) => {
//             console.log("mongod: " + buffer.toString());
//         });
//         mongodCP.on("error", (buffer: Buffer) => {
//             console.log("mongod Error: " + buffer.toString());
//         });
//         mongodCP.on("close", (code?: number) => {
//             console.log("mongod: Close " + code);
//         });
//     });

//     test("a", () => {

//     });
//     suiteTeardown(() => {
//         mongodCP.kill();
//     });
// });
