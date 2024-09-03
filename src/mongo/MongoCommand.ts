/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RecognitionException } from 'antlr4ts';
import type * as vscode from 'vscode';

export interface MongoCommand {
    range: vscode.Range;
    text: string;
    collection?: string;
    name?: string;
    arguments?: string[];
    // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    argumentObjects?: Object[];
    errors?: ErrorDescription[];
    chained?: boolean;
}

export interface ErrorDescription {
    range: vscode.Range;
    message: string;
    exception?: RecognitionException;
}
