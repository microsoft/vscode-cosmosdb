/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageItem } from "vscode";

export const DefaultBatchSize: number = 50;

export namespace DialogBoxResponses {
    export const Yes: MessageItem = { title: "Yes" };
    export const OK: MessageItem = { title: "OK" };
    export const DontShowAgain: MessageItem = { title: "Don't Show Again" };
    export const upload: MessageItem = { title: "Upload" };
    export const uploadDontWarn: MessageItem = { title: "Upload, don't warn again" };
    export const No: MessageItem = { title: "No" };
    export const Cancel: MessageItem = { title: "Cancel", isCloseAffordance: true };
}

export enum Experience {
    MongoDB = 'MongoDB',
    Graph = 'Graph',
    Table = 'Table',
    DocumentDB = 'DocumentDB'
}

export enum DBAccountKind {
    MongoDB = 'MongoDB',
    GlobalDocumentDB = 'GlobalDocumentDB'
}
