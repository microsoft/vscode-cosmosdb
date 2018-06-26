/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RecognitionException } from 'antlr4ts';

export interface MongoCommand {
    range: vscode.Range;
    text: string;
    collection?: string;
    name?: string;
    // tslint:disable-next-line:no-banned-terms
    arguments?: string[];
    argumentObjects?: Object[];
    errors?: errorDescription[];
}

export interface errorDescription {
    range: vscode.Range;
    message: string;
    exception?: RecognitionException;
}
