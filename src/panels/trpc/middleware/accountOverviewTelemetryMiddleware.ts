/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MiddlewareResultLike, type ProcedureInvocation } from '@microsoft/vscode-ext-webview/host';
import { getAccountOverviewMaskedValues, getResourceMaskedValues } from '../../accountOverview/resourceMasking';
import { reportOverviewResultTelemetry } from '../../accountOverview/telemetry';
import { type AccountOverviewRouterContext } from '../appRouter';
import { type AzextTelemetryEnrichment } from './azextTelemetryRunner';

/** Enriches the existing RPC event; no file contents, paths, or names are emitted. */
export async function accountOverviewTelemetryMiddleware<TResult extends MiddlewareResultLike>({
    ctx,
    next,
    getRawInput,
    type,
}: Pick<ProcedureInvocation<TResult>, 'next' | 'type'> & {
    ctx: AccountOverviewRouterContext & AzextTelemetryEnrichment;
    getRawInput: () => Promise<unknown>;
}): Promise<TResult> {
    const context = ctx.actionContext;
    context.valuesToMask.push(...getAccountOverviewMaskedValues(ctx.metadata));
    const input: unknown = await getRawInput();
    if (input && typeof input === 'object') {
        context.valuesToMask.push(
            ...getResourceMaskedValues([
                'databaseId' in input ? input.databaseId : undefined,
                'containerId' in input ? input.containerId : undefined,
                'url' in input ? input.url : undefined,
                'message' in input ? input.message : undefined,
            ]),
        );
    }
    context.telemetry.properties.isServerless = String(ctx.metadata.isServerless);
    if (ctx.panelId) {
        context.telemetry.properties.panelId = ctx.panelId;
    }
    const result = await next();
    if (!result.ok) {
        context.telemetry.properties.errorCategory = 'infrastructure';
    } else if (type === 'query' && 'data' in result) {
        reportOverviewResultTelemetry(context, result.data);
    }
    return result;
}
