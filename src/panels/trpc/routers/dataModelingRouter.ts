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
function buildRecommendationPrompt(dataModelJson: string, wizardTabId: string): string {
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
        `When you have decided, call #${REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME} exactly once with the structured recommendation for every container and wizardTabId "${wizardTabId}", so it is displayed in the originating Data Modeling wizard's Result page. If its result says that wizard is no longer open, present the complete recommendation it returns in the Chat response instead.` +
        '\n\n' +
        'Provide a short overall `summary`, and for each container:' +
        '\n' +
        '- `partitionKey`: the recommended key path, and a `rationale` (1–2 sentences, may name the workload pattern).' +
        '\n' +
        '- `candidates`: 3–4 scored candidate keys ordered best first. Each has a `verdict` (recommended / alternative / avoid), a `score` 0–100 (higher is better), and 2–3 `assessments` — each a short rule `label` (e.g. "Query match", "Cardinality", "Immutability", "Write dist."), a `status` (pass / warn / fail / info), and a one-line `detail`. Include realistic "avoid" candidates (e.g. low-cardinality or time-bucketed keys) with low scores.' +
        '\n' +
        '- `hotPartitionRisk`: one row per candidate with a `risk` band (low / medium / high / severe) and a `pct` 0–100 (higher = more skew) for the comparison bars.' +
        '\n' +
        '- `queryRouting`: a `headline` (e.g. "1/3 reads single-partition with /conversationId"), a `routes` row per read pattern (`pattern`, `filters`, `qps` like "200/s", `routing` single/cross, `estCost` like "3 RU" or "50–100× RU"), and an `analysis` describing how to resolve cross-partition reads.' +
        '\n' +
        '- `documentIdStrategy`: a short access-pattern `tag` (e.g. "Query-driven access") and a `recommendation` for the document id.'
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
                query: buildRecommendationPrompt(input.dataModelJson, ctx.wizardTabId),
            });
        }),
});
