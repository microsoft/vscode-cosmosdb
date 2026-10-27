/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import {
    APPLY_DATA_MODELING_QUERY_TOOL_DESCRIPTION,
    APPLY_DATA_MODELING_QUERY_TOOL_NAME,
    QueryGenerationResultSchema,
} from '../dataModeling/queryGeneration';
import { DataModelingWizardTab } from '../panels/DataModelingWizardTab';
import { stripCodeFences } from '../utils/sanitization';
import { queryPropertyNames } from '../webviews/cosmosdb/DataModeling/queryFilterProperties';

const InputSchema = QueryGenerationResultSchema.safeExtend({ wizardTabId: z.string().uuid() });
type Input = z.infer<typeof InputSchema>;

export { APPLY_DATA_MODELING_QUERY_TOOL_DESCRIPTION };

export const APPLY_DATA_MODELING_QUERY_TOOL_INPUT_SCHEMA = {
    type: 'object' as const,
    properties: {
        wizardTabId: { type: 'string', format: 'uuid', description: 'The wizardTabId from the generation request.' },
        requestId: { type: 'string', format: 'uuid', description: 'The requestId from the generation request.' },
        query: { type: 'string', minLength: 1, description: 'The generated Cosmos DB NoSQL SELECT query, SQL only.' },
        error: {
            type: 'string',
            minLength: 1,
            description: 'Why a query could not be generated. Send instead of query.',
        },
    },
    required: ['wizardTabId', 'requestId'],
    oneOf: [
        { required: ['query'], not: { required: ['error'] } },
        { required: ['error'], not: { required: ['query'] } },
    ],
    additionalProperties: false,
};

export function registerApplyDataModelingQueryTool(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.lm.registerTool<Input>(APPLY_DATA_MODELING_QUERY_TOOL_NAME, {
            prepareInvocation: () => ({ invocationMessage: l10n.t('Updating the Data Modeler query…') }),
            async invoke(options, token) {
                const result = await callWithTelemetryAndErrorHandling(
                    'cosmosDB.ai.tool.applyDataModelingQuery',
                    async (actionContext) => {
                        actionContext.telemetry.suppressAll = true;
                        actionContext.errorHandling.suppressDisplay = true;
                        actionContext.errorHandling.rethrow = false;
                        const respond = (message: string) =>
                            new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(message)]);
                        const parsed = InputSchema.safeParse(options.input);
                        if (!parsed.success) {
                            return respond(
                                l10n.t('Provide wizardTabId, requestId, and either a non-empty query or error.'),
                            );
                        }
                        if (token.isCancellationRequested) return respond(l10n.t('Operation cancelled.'));
                        const { wizardTabId, ...input } = parsed.data;
                        const tab = DataModelingWizardTab.findById(wizardTabId);
                        if (!tab) {
                            return respond(
                                l10n.t(
                                    'The originating Data Modeler is closed. Show the query or error in Chat instead.',
                                ),
                            );
                        }
                        if (input.query !== undefined) {
                            input.query = stripCodeFences(input.query).trim();
                            if (!input.query || !queryPropertyNames(input.query).valid) {
                                return respond(
                                    l10n.t(
                                        'The query is not valid Cosmos DB NoSQL SQL. Correct it and retry; no query was changed.',
                                    ),
                                );
                            }
                        }
                        const outcome = await tab.queryGeneration.deliver(
                            input,
                            (delivery) => tab.eventSink.emit({ type: 'queryGenerated', ...delivery }),
                            token,
                        );
                        switch (outcome) {
                            case 'applied':
                                return respond(
                                    l10n.t(
                                        'The query was applied to the originating Data Modeler row. It was not executed.',
                                    ),
                                );
                            case 'error':
                                return respond(
                                    l10n.t('The generation error is shown in the Data Modeler. No query was changed.'),
                                );
                            case 'invalidQuery':
                                return respond(
                                    l10n.t('The query is invalid. Correct it and retry; no query was changed.'),
                                );
                            case 'stale':
                                return respond(
                                    l10n.t(
                                        'The query request expired or its row changed. No query was applied. Show the result in Chat instead.',
                                    ),
                                );
                        }
                    },
                );
                return (
                    result ??
                    new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            l10n.t(
                                'Could not confirm the Data Modeler query update. Check the wizard before retrying.',
                            ),
                        ),
                    ])
                );
            },
        }),
    );
}
