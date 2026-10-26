/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { workspace } from 'vscode';
import { getIsSurveyDisabledGlobally, openSurvey } from '../../../../utils/survey';
import { ExperienceKind } from '../../../../utils/surveyTypes';
import { accountOverviewProcedure } from '../../trpc';

export const feedbackProcedures = {
    provideFeedback: accountOverviewProcedure.mutation(async () => {
        await openSurvey(ExperienceKind.NoSQL, 'cosmosDB.accountOverview.provideFeedback');
    }),
    feedbackEnabled: accountOverviewProcedure.subscription(async function* ({ ctx }) {
        const sink = new TypedEventSink<{ type: 'feedbackEnabledChanged'; enabled: boolean }>();
        const emit = () => sink.emit({ type: 'feedbackEnabledChanged', enabled: !getIsSurveyDisabledGlobally() });
        const subscription = workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('telemetry.feedback.enabled')) {
                emit();
            }
        });
        const close = () => sink.close();
        ctx.signal?.addEventListener('abort', close, { once: true });
        emit();
        try {
            for await (const event of sink) {
                if (ctx.signal?.aborted) {
                    return;
                }
                yield event.enabled;
            }
        } finally {
            ctx.signal?.removeEventListener('abort', close);
            subscription.dispose();
            sink.close();
        }
    }),
};
