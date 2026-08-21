/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { z } from 'zod';
import { REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME } from '../../../chat/reportPartitionKeyRecommendationTool';
import { dataModelingProcedure, dataModelingRouter } from '../trpc';

/**
 * Builds the agent-mode prompt sent to the general Copilot Chat. Internal agent
 * instruction, not user-facing UI — kept as a stable, non-localized English
 * string so the model behavior is predictable.
 */
function buildRecommendationPrompt(dataModelJson: string): string {
    return (
        'You are helping choose the best Azure Cosmos DB for NoSQL partition key for a data model designed in the Cosmos DB Data Modeling wizard.' +
        '\n\n' +
        'The data model below is JSON. Each container has a schema (properties with a role: key / filter / payload), an estimated document shape, read query patterns (with the attributes they filter on and peak QPS), write rates, and scale characteristics (cardinality, write distribution, growth).' +
        '\n\n' +
        '```json\n' +
        dataModelJson +
        '\n```\n\n' +
        'For EACH container, decide the best partition key. Weigh cardinality (favor high-cardinality keys), query alignment (the dominant read filters should be the partition key), write distribution (avoid hot partitions), and the 20 GB storage / 10,000 RU-per-second limits of a single logical partition. Consider a hierarchical partition key when one attribute is not enough.' +
        '\n\n' +
        `When you have decided, call #${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME} exactly once with the structured recommendation for every container, so it is displayed in the Data Modeling wizard's Result page. Provide a short overall summary, and for each container the recommended partition key with a brief rationale, plus viable alternatives and keys to avoid where useful.`
    );
}

export const dataModelingRouterDef = dataModelingRouter({
    /**
     * Sends the finished data model to the general Copilot Chat with a prompt
     * asking for the best partition key. Copilot analyzes it and calls the
     * report tool, whose result is streamed back to the Result page.
     */
    requestRecommendation: dataModelingProcedure
        .input(z.object({ dataModelJson: z.string() }))
        .mutation(async ({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.errorHandling.suppressDisplay = true;
            }

            await vscode.commands.executeCommand('workbench.action.chat.open', {
                mode: 'agent',
                query: buildRecommendationPrompt(input.dataModelJson),
            });
        }),
});
