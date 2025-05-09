/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Event, type LogLevel, type LogOutputChannel } from 'vscode';

export class TestOutputChannel implements LogOutputChannel {
    public name: string = 'Extension Test Output';

    public append(value: string): void {
        // Technically this is wrong (because of the new line), but good enough for now
        console.log(value);
    }

    public appendLine(value: string): void {
        console.log(value);
    }

    public appendLog(value: string, options?: { resourceName?: string; date?: Date }): void {
        options = options || {};
        const date: Date = options.date || new Date();
        this.appendLine(
            `${date.toLocaleTimeString()}${options.resourceName ? ' '.concat(options.resourceName) : ''}: ${value}`,
        );
    }

    public replace(value: string): void {
        console.log(value);
    }

    public clear(): void {
        // do nothing
    }

    public show(): void {
        // do nothing
    }

    public hide(): void {
        // do nothing
    }

    public dispose(): void {
        // do nothing
    }

    logLevel: LogLevel = 2;

    onDidChangeLogLevel = (() => {
        // empty
    }) as unknown as Event<LogLevel>;

    trace(message: string, ...args: unknown[]): void {
        console.trace(message, args);
    }
    debug(message: string, ...args: unknown[]): void {
        console.debug(message, args);
    }
    info(message: string, ...args: unknown[]): void {
        console.info(message, args);
    }
    warn(message: string, ...args: unknown[]): void {
        console.warn(message, args);
    }
    error(error: string | Error, ...args: unknown[]): void {
        console.error(error, args);
    }
}
