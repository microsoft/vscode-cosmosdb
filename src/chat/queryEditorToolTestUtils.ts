/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** The minimal shape a language-model tool exposes for invocation. */
interface InvokableTool {
    prepareInvocation?: (options: unknown, token: unknown) => unknown;
    invoke: (options: unknown, token: unknown) => Promise<vscode.LanguageModelToolResult>;
}

/**
 * Registers a query-editor language-model tool and returns the tool object it hands to
 * `vscode.lm.registerTool`, restoring `vscode.lm.registerTool` before returning.
 *
 * Use this when a test needs to drive `prepareInvocation` and `invoke` separately (e.g. to exercise
 * the confirmation snapshot); use {@link invokeRegisteredTool} for the common invoke-only case.
 */
export function captureRegisteredTool(register: (context: vscode.ExtensionContext) => void): InvokableTool {
    const lmRecord = vscode.lm as unknown as Record<string, unknown>;
    const originalRegisterTool = lmRecord.registerTool;

    let captured: InvokableTool | undefined;
    lmRecord.registerTool = (_name: string, tool: unknown) => {
        captured = tool as InvokableTool;
        return { dispose: () => {} };
    };

    try {
        register({ subscriptions: { push: () => {} } } as unknown as vscode.ExtensionContext);
    } finally {
        if (originalRegisterTool !== undefined) {
            lmRecord.registerTool = originalRegisterTool;
        } else {
            delete lmRecord.registerTool;
        }
    }

    if (!captured) {
        throw new Error('register did not call vscode.lm.registerTool');
    }
    return captured;
}

/** Concatenates the text parts of a tool result into a single string. */
export function serializeToolResult(result: vscode.LanguageModelToolResult): string {
    return (result.content as Array<{ value?: string }>).map((part) => part.value ?? '').join('');
}

/**
 * Registers a query-editor language-model tool, captures the tool object it hands to
 * `vscode.lm.registerTool`, invokes it once, and returns both the raw result and the concatenated
 * text of its parts.
 *
 * Centralizes the registration-capture + invoke + serialize dance shared by the tool tests so each
 * test only has to arrange its tab/connection stubs and assert on the returned `text`. Uses plain
 * function stubs (no test-framework globals) so it stays a dependency-light helper.
 */
export async function invokeRegisteredTool(
    register: (context: vscode.ExtensionContext) => void,
): Promise<{ result: vscode.LanguageModelToolResult; text: string }> {
    const captured = captureRegisteredTool(register);

    const cts = new vscode.CancellationTokenSource();
    try {
        const result = await captured.invoke({ input: {} }, cts.token);
        return { result, text: serializeToolResult(result) };
    } finally {
        cts.dispose();
    }
}
