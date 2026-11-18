/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { summarizeCoverage, summarizeModel } from '../../../dataModeling/modelingTelemetryMetrics';
import { type ModelingSection, type ModelingTelemetryEvent } from '../../../dataModeling/modelingTelemetrySchema';
import { type DataModelingAppRouter } from '../../api/types';
import { type WizardState } from './dataModel';

/** Reports only allowlisted aggregates; no file contents, paths, or names are emitted. */
export function useModelingTelemetryReporter() {
    const client = useTrpcClient<DataModelingAppRouter>();
    return useCallback(
        (event: ModelingTelemetryEvent) => {
            void client.dataModeling.recordTelemetry.mutate(event).catch(() => {
                console.warn('[Data Modeler] Could not record usage telemetry.');
            });
        },
        [client],
    );
}

export function useModelingPageVisible() {
    const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
    useEffect(() => {
        const update = () => setVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);
    return visible;
}

/** Tracks session-only interactions locally; no file contents, paths, or names are emitted. */
export function useModelingUsage(wizard: WizardState, report: ReturnType<typeof useModelingTelemetryReporter>) {
    const [visits, setVisits] = useState(() => new Map<string, Set<ModelingSection>>());
    const [edited, setEdited] = useState({ data: false, queries: false, scale: false });
    const visit = useCallback((containerId: string, section: ModelingSection) => {
        setVisits((previous) => {
            const sections = previous.get(containerId);
            if (sections?.has(section)) return previous;
            return new Map(previous).set(containerId, new Set(sections).add(section));
        });
    }, []);
    const markEdited = useCallback((section: ModelingSection) => {
        setEdited((previous) => (previous[section] ? previous : { ...previous, [section]: true }));
    }, []);
    const model = useMemo(() => summarizeModel(wizard), [wizard]);
    const usage = useMemo(
        () => ({
            ...model,
            ...summarizeCoverage(
                wizard.dataModel.containers.map((container) => container.id),
                visits,
            ),
            everEdited: edited.data || edited.queries || edited.scale,
            dataEverEdited: edited.data,
            queriesEverEdited: edited.queries,
            scaleEverEdited: edited.scale,
        }),
        [model, wizard.dataModel.containers, edited, visits],
    );
    const usageKey = JSON.stringify(usage);
    const lastUsage = useRef('');
    useEffect(() => {
        if (lastUsage.current !== usageKey) {
            lastUsage.current = usageKey;
            report({ type: 'usage', usage });
        }
    }, [usageKey, usage, report]);
    return { visit, markEdited };
}
