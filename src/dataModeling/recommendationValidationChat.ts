/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type ReportPartitionKeyRecommendationInput } from '../chat/reportPartitionKeyRecommendationTool';
import { registerRecommendationValidationRequest } from './recommendationValidationRequests';

export const VALIDATION_CHAT_TIMEOUT_MS = 10 * 60 * 1000;

export class ValidationChatInterruptedError extends Error {}

/**
 * Open the same Copilot Chat agent path as Data Modeler; the real registered report tool supplies the result.
 * A timeout/cancel stops the batch, not arbitrary user-owned Chat sessions.
 */
export async function runRecommendationValidationChat(
    model: Pick<vscode.LanguageModelChat, 'id' | 'vendor' | 'family' | 'version'>,
    prompt: string,
    requestId: string,
    token: vscode.CancellationToken,
    timeoutMs = VALIDATION_CHAT_TIMEOUT_MS,
): Promise<ReportPartitionKeyRecommendationInput> {
    if (token.isCancellationRequested) throw new ValidationChatInterruptedError('Validation cancelled.');
    let receive!: (outcome: ReportPartitionKeyRecommendationInput) => void;
    let received = false;
    let stopped = false;
    const result = new Promise<ReportPartitionKeyRecommendationInput>((resolve) => {
        receive = (outcome) => {
            received = true;
            resolve(outcome);
        };
    });
    const registration = registerRecommendationValidationRequest(requestId, receive);
    let rejectInterrupted!: (error: Error) => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
        rejectInterrupted = reject;
    });
    const timer = setTimeout(
        () =>
            rejectInterrupted(
                new ValidationChatInterruptedError(
                    'Timed out waiting for Copilot Chat to report a recommendation. Remaining scenarios were not run. Check Chat for pending approvals or errors.',
                ),
            ),
        timeoutMs,
    );
    const cancellation = token.onCancellationRequested(() =>
        rejectInterrupted(
            new ValidationChatInterruptedError(
                'Validation cancelled. Any in-flight Chat request may still be running.',
            ),
        ),
    );
    try {
        const run = async () => {
            await vscode.commands.executeCommand('workbench.action.chat.newChat');
            if (stopped || token.isCancellationRequested)
                throw new ValidationChatInterruptedError('Validation cancelled.');
            const terminal = await vscode.commands.executeCommand<
                | {
                      type?: string;
                      errorDetails?: { message?: string };
                  }
                | undefined
            >('workbench.action.chat.open', {
                mode: 'agent',
                query: prompt,
                modelSelector: { id: model.id, vendor: model.vendor, family: model.family, version: model.version },
                blockOnResponse: true,
            });
            if (terminal?.type === 'confirmation') {
                // Chat has paused for permission/input. Leave it visible for the user; never auto-approve tools.
                return result;
            }
            if (!received) {
                throw new Error(
                    terminal?.errorDetails?.message ??
                        'Copilot Chat finished without invoking the recommendation report tool.',
                );
            }
            return result;
        };
        return await Promise.race([run(), interrupted]);
    } finally {
        stopped = true;
        clearTimeout(timer);
        cancellation.dispose();
        registration.dispose();
    }
}
