/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ANTLRErrorListener } from 'antlr4ts/ANTLRErrorListener';
import { type RecognitionException } from 'antlr4ts/RecognitionException';
import { type Recognizer } from 'antlr4ts/Recognizer';
import { type Token } from 'antlr4ts/Token';
import * as vscode from 'vscode';
import { type ErrorDescription } from './MongoCommand';

export class ParserErrorListener implements ANTLRErrorListener<Token> {
    private _errors: ErrorDescription[] = [];

    public get errors(): ErrorDescription[] {
        return this._errors;
    }

    public syntaxError(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _recognizer: Recognizer<Token, any>,
        _offendingSymbol: Token | undefined,
        line: number,
        charPositionInLine: number,
        msg: string,
        e: RecognitionException | undefined,
    ): void {
        const position = new vscode.Position(line - 1, charPositionInLine); // Symbol lines are 1-indexed. Position lines are 0-indexed
        const range = new vscode.Range(position, position);

        const error: ErrorDescription = {
            message: msg,
            range: range,
            exception: e,
        };
        this._errors.push(error);
    }
}

export class LexerErrorListener implements ANTLRErrorListener<number> {
    private _errors: ErrorDescription[] = [];

    public get errors(): ErrorDescription[] {
        return this._errors;
    }

    public syntaxError(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _recognizer: Recognizer<number, any>,
        _offendingSymbol: number | undefined,
        line: number,
        charPositionInLine: number,
        msg: string,
        e: RecognitionException | undefined,
    ): void {
        const position = new vscode.Position(line - 1, charPositionInLine); // Symbol lines are 1-indexed. Position lines are 0-indexed
        const range = new vscode.Range(position, position);

        const error: ErrorDescription = {
            message: msg,
            range: range,
            exception: e,
        };
        this._errors.push(error);
    }
}
