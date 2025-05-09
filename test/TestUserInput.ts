/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import type * as vscodeTypes from 'vscode';
import {
    type Disposable,
    type Event,
    type EventEmitter,
    type InputBoxOptions,
    type InputBoxValidationMessage,
    type MessageItem,
    type MessageOptions,
    type OpenDialogOptions,
    type QuickPickItem,
    type QuickPickOptions,
    type Uri,
    type WorkspaceFolder,
    type WorkspaceFolderPickOptions,
} from 'vscode';

export declare enum TestInput {
    /**
     * Use the first entry in a quick pick or the default value (if it's defined) for an input box. In all other cases, throw an error
     */
    UseDefaultValue,

    /**
     * Simulates the user hitting the back button in an AzureWizard.
     */
    BackButton,
}

export type PromptResult = {
    value: string | QuickPickItem | QuickPickItem[] | MessageItem | Uri[] | WorkspaceFolder;

    /**
     * True if the user did not change from the default value, currently only supported for `showInputBox`
     */
    matchesDefault?: boolean;
};

class GoBackError extends Error {
    constructor() {
        super('Go back.');
    }
}

/**
 * Wrapper class of several `vscode.window` methods that handle user input.
 * This class is meant to be used for testing in non-interactive mode.
 */
export class TestUserInput {
    private readonly _onDidFinishPromptEmitter: EventEmitter<PromptResult>;
    private readonly _vscode: typeof vscodeTypes;
    private _inputs: (string | RegExp | TestInput)[] = [];

    /**
     * Boolean set to indicate whether the UI is being used for test inputs. For`TestUserInput`, this will always default to true.
     * See: https://github.com/microsoft/vscode-azuretools/pull/1807
     */
    readonly isTesting: boolean = true;

    constructor(vscode: typeof vscodeTypes) {
        this._vscode = vscode;
        this._onDidFinishPromptEmitter = new this._vscode.EventEmitter<PromptResult>();
    }

    public static async create(): Promise<TestUserInput> {
        return new TestUserInput(await import('vscode'));
    }

    public get onDidFinishPrompt(): Event<PromptResult> {
        return this._onDidFinishPromptEmitter.event;
    }

    /**
     * An ordered array of inputs that will be used instead of interactively prompting in VS Code. RegExp is only applicable for QuickPicks and will pick the first input that matches the RegExp.
     */
    public async runWithInputs<T>(inputs: (string | RegExp | TestInput)[], callback: () => Promise<T>): Promise<T> {
        this.setInputs(inputs);
        const result: T = await callback();
        this.validateAllInputsUsed();
        return result;
    }

    public setInputs(inputs: (string | RegExp | TestInput)[]): void {
        this._inputs = inputs;
    }

    public validateAllInputsUsed(): void {
        assert.strictEqual(this._inputs.length, 0, `Not all inputs were used: ${this._inputs.toString()}`);
    }

    public async showQuickPick<T extends QuickPickItem>(
        items: T[] | Thenable<T[]>,
        options: QuickPickOptions,
    ): Promise<T | T[]> {
        const resolvedItems: T[] = await Promise.resolve(items);

        let result: T | T[];
        const input: string | RegExp | TestInput | undefined = this._inputs.shift();
        if (input === undefined) {
            throw new Error(`No more inputs left for call to showQuickPick. Placeholder: '${options.placeHolder}'`);
        } else if (input === TestInput.BackButton) {
            throw new GoBackError();
        } else {
            if (resolvedItems.length === 0) {
                throw new Error(`No quick pick items found. Placeholder: '${options.placeHolder}'`);
            } else if (input === TestInput.UseDefaultValue) {
                result = resolvedItems[0];
            } else {
                const qpiMatchesInput = (qpi: QuickPickItem): boolean => {
                    const description = qpi.description || '';
                    const valuesToTest = [qpi.label, description, `${qpi.label} ${description}`];
                    return valuesToTest.some((v) => (input instanceof RegExp ? input.test(v) : input === v));
                };

                if (options.canPickMany) {
                    result = resolvedItems.filter(qpiMatchesInput);
                } else {
                    const resolvedItem: T | undefined = resolvedItems.find(qpiMatchesInput);
                    if (resolvedItem) {
                        result = resolvedItem;
                    } else {
                        const picksString = resolvedItems.map((i) => `"${i.label}"`).join(', ');
                        const lastItem = resolvedItems[resolvedItems.length - 1];
                        if (/load more/i.test(lastItem.label)) {
                            console.log(
                                `Loading more items for quick pick with placeholder "${options.placeHolder}"...`,
                            );
                            result = lastItem;
                            this._inputs.unshift(input);
                        } else {
                            throw new Error(
                                `Did not find quick pick item matching "${input}". Placeholder: "${options.placeHolder}". Picks: ${picksString}`,
                            );
                        }
                    }
                }
            }

            this._onDidFinishPromptEmitter.fire({ value: result });
            return result;
        }
    }

    public async showInputBox(options: InputBoxOptions): Promise<string> {
        let result: string;
        const input: string | RegExp | TestInput | undefined = this._inputs.shift();
        if (input === undefined) {
            throw new Error(
                `No more inputs left for call to showInputBox. Placeholder: '${options.placeHolder}'. Prompt: '${options.prompt}'`,
            );
        } else if (input === TestInput.BackButton) {
            throw new GoBackError();
        } else if (input === TestInput.UseDefaultValue) {
            if (!options.value) {
                throw new Error("Can't use default value because none was specified");
            } else {
                result = options.value;
            }
        } else if (typeof input === 'string') {
            if (options.validateInput) {
                const msg: string | InputBoxValidationMessage | null | undefined = await Promise.resolve(
                    options.validateInput(input),
                );
                if (msg !== null && msg !== undefined) {
                    if (typeof msg === 'object' && 'message' in msg) {
                        throw new Error(msg.message);
                    } else {
                        throw new Error(msg);
                    }
                }
            }
            result = input;
        } else {
            throw new Error(`Unexpected input '${input}' for showInputBox.`);
        }

        this._onDidFinishPromptEmitter.fire({
            value: result,
            matchesDefault: result === options.value,
        });
        return result;
    }

    public showWarningMessage<T extends MessageItem>(message: string, ...items: T[]): Promise<T>;
    public showWarningMessage<T extends MessageItem>(
        message: string,
        options: MessageOptions,
        ...items: T[]
    ): Promise<MessageItem>;

    public async showWarningMessage<T extends MessageItem>(message: string, ...args: any[]): Promise<T> {
        let result: T;
        const input: string | RegExp | TestInput | undefined = this._inputs.shift();
        if (input === undefined) {
            throw new Error(`No more inputs left for call to showWarningMessage. Message: ${message}`);
        } else if (typeof input === 'string') {
            const matchingItem: T | undefined = args.find((item: T) => item.title === input);
            if (matchingItem) {
                result = matchingItem;
            } else {
                throw new Error(`Did not find message item matching '${input}'. Message: '${message}'`);
            }
        } else {
            throw new Error(`Unexpected input '${input}' for showWarningMessage.`);
        }

        this._onDidFinishPromptEmitter.fire({ value: result });
        return result;
    }

    public async showOpenDialog(options: OpenDialogOptions): Promise<Uri[]> {
        let result: Uri[];
        const input: string | RegExp | TestInput | undefined = this._inputs.shift();
        if (input === undefined) {
            throw new Error(`No more inputs left for call to showOpenDialog. Message: ${options.openLabel}`);
        } else if (typeof input === 'string') {
            result = [this._vscode.Uri.file(input)];
        } else {
            throw new Error(`Unexpected input '${input}' for showOpenDialog.`);
        }

        this._onDidFinishPromptEmitter.fire({ value: result });
        return result;
    }

    public async showWorkspaceFolderPick(options: WorkspaceFolderPickOptions): Promise<WorkspaceFolder> {
        let result: WorkspaceFolder;
        const input: string | RegExp | TestInput | undefined = this._inputs.shift();

        if (input === undefined) {
            throw new Error(
                `No more inputs left for call to showWorkspaceFolderPick. Placeholder: ${options.placeHolder}`,
            );
        } else if (typeof input === 'string' || input instanceof RegExp) {
            const workspaceFolders: readonly WorkspaceFolder[] | undefined = this._vscode.workspace.workspaceFolders;
            const workspaceFolder: WorkspaceFolder | undefined = workspaceFolders?.find((workspace) => {
                const valuesToTest: string[] = [workspace.name, workspace.uri.path];
                if (typeof input === 'string') {
                    return !!valuesToTest.find((v) => v === input);
                } else {
                    return !!valuesToTest.find((v) => v.match(input));
                }
            });

            if (!workspaceFolder) {
                throw new Error(`Did not find workspace folder with name matching '${input}'.`);
            }
            result = workspaceFolder;
        } else {
            throw new Error(`Unexpected input '${input}' for showWorkspaceFolderPick.`);
        }

        this._onDidFinishPromptEmitter.fire({ value: result });
        return result;
    }
}

type registerOnActionStartHandlerType = (
    handler: (context: { callbackId: string; ui: Partial<TestUserInput> }) => void,
) => Disposable;

/**
 * Alternative to `TestUserInput.runWithInputs` that can be used on the rare occasion when the `IActionContext` must be created inside `callback` instead of before `callback`
 *
 * @param callbackId The expected callbackId for the action to be run
 * @param inputs An ordered array of inputs that will be used instead of interactively prompting in VS Code
 * @param registerOnActionStartHandler The function defined in 'vscode-azureextensionui' for registering onActionStart handlers
 * @param callback The callback to run
 */
export async function runWithInputs<T>(
    callbackId: string,
    inputs: (string | RegExp | TestInput)[],
    registerOnActionStartHandler: registerOnActionStartHandlerType,
    callback: () => Promise<T>,
): Promise<T> {
    const testUserInput = await TestUserInput.create();
    testUserInput.setInputs(inputs);
    const disposable = registerOnActionStartHandler((context) => {
        if (context.callbackId === callbackId) {
            context.ui = testUserInput;
            disposable.dispose();
        }
    });

    let result: T;
    try {
        result = await callback();
    } finally {
        disposable.dispose();
    }

    testUserInput.validateAllInputsUsed();
    return result;
}
