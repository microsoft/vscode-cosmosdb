/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import * as vscode from 'vscode';
import {
    DATA_MODELER_ENABLED_SETTING,
    isDataModelerFeatureEnabled,
} from '../../../../commands/dataModeling/dataModelerFeatureFlag';
import { ext } from '../../../../extensionVariables';
import { onCopilotAvailabilityChanged } from '../../../../utils/copilotUtils';
import { accountOverviewProcedure } from '../../trpc';

export const aiFeaturesProcedures = {
    dataModelerEnabled: accountOverviewProcedure.subscription(async function* ({ ctx }) {
        const sink = new TypedEventSink<{ type: 'dataModelerEnabledChanged'; isEnabled: boolean }>();
        const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(DATA_MODELER_ENABLED_SETTING)) {
                sink.emit({ type: 'dataModelerEnabledChanged', isEnabled: isDataModelerFeatureEnabled() });
            }
        });
        const close = () => sink.close();
        ctx.signal?.addEventListener('abort', close, { once: true });
        sink.emit({ type: 'dataModelerEnabledChanged', isEnabled: isDataModelerFeatureEnabled() });
        try {
            for await (const event of sink) {
                if (ctx.signal?.aborted) {
                    return;
                }
                yield event.isEnabled;
            }
        } finally {
            ctx.signal?.removeEventListener('abort', close);
            subscription.dispose();
            sink.close();
        }
    }),
    aiFeaturesEnabled: accountOverviewProcedure.subscription(async function* ({ ctx }) {
        const sink = new TypedEventSink<{ type: 'aiFeaturesEnabledChanged'; isEnabled: boolean }>();
        const subscription = onCopilotAvailabilityChanged((isEnabled) =>
            sink.emit({ type: 'aiFeaturesEnabledChanged', isEnabled }),
        );
        const close = () => sink.close();
        ctx.signal?.addEventListener('abort', close, { once: true });
        sink.emit({ type: 'aiFeaturesEnabledChanged', isEnabled: ext.isAIFeaturesEnabled ?? false });
        try {
            for await (const event of sink) {
                if (ctx.signal?.aborted) {
                    return;
                }
                yield event.isEnabled;
            }
        } finally {
            ctx.signal?.removeEventListener('abort', close);
            subscription.dispose();
            sink.close();
        }
    }),
};
