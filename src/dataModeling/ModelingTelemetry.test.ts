/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyScenario, createInitialState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { ModelingTelemetry } from './ModelingTelemetry';
import { type ModelingUsage } from './modelingTelemetrySchema';

const events = vi.hoisted(() => [] as { name: string; context: IActionContext }[]);
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(async (name: string, callback: (context: IActionContext) => unknown) => {
        const context = {
            errorHandling: {},
            telemetry: { properties: {}, measurements: {} },
            valuesToMask: [],
        } as unknown as IActionContext;
        events.push({ name, context });
        await callback(context);
    }),
}));

const first = '12345678-1234-4123-8123-123456789001';
const second = '12345678-1234-4123-8123-123456789002';
const result = {
    summary: 'PRIVATE RESPONSE',
    containers: [{ entity: 'PRIVATE ENTITY', partitionKey: '/PRIVATE FIELD', rationale: 'PRIVATE RATIONALE' }],
};
const usage: ModelingUsage = {
    scenario: 'chat',
    differsFromDefault: true,
    dataChanged: true,
    queriesChanged: false,
    scaleChanged: false,
    everEdited: true,
    dataEverEdited: true,
    queriesEverEdited: false,
    scaleEverEdited: false,
    containerCount: 1,
    propertyCount: 2,
    queryCount: 1,
    customizedContainerCount: 1,
    dataViewedCount: 1,
    queriesViewedCount: 0,
    scaleViewedCount: 0,
    dataNeverViewedCount: 0,
    queriesNeverViewedCount: 1,
    scaleNeverViewedCount: 1,
    dataCoverage: 1,
    queriesCoverage: 0,
    scaleCoverage: 0,
};
function event(suffix: string) {
    return events.filter((entry) => entry.name === `cosmosDB.dataModeler.${suffix}`);
}

describe('ModelingTelemetry', () => {
    beforeEach(() => {
        events.length = 0;
        vi.clearAllMocks();
    });

    it('captures first and subsequent workload choices immediately without stale model enrichment', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.record({ type: 'usage', usage });
        tracker.record({ type: 'scenarioSelected', scenario: 'iot' });
        tracker.record({ type: 'scenarioSelected', scenario: 'iot' });
        tracker.record({ type: 'scenarioSelected', scenario: 'inventory' });
        expect(event('recommendationRequested')).toHaveLength(0);
        expect(event('scenarioSelected').map((entry) => entry.context.telemetry.properties)).toMatchObject([
            { scenario: 'iot', firstSelection: 'true' },
            { scenario: 'iot', firstSelection: 'false' },
            { scenario: 'inventory', firstSelection: 'false' },
        ]);
        expect(
            event('scenarioSelected').map((entry) => entry.context.telemetry.measurements.scenarioSelectionCount),
        ).toEqual([1, 2, 3]);
        for (const selection of event('scenarioSelected')) {
            expect(selection.context.telemetry.properties).not.toHaveProperty('differsFromDefault');
            expect(selection.context.telemetry.measurements).not.toHaveProperty('containerCount');
        }
        tracker.dispose();
        expect(event('summary')[0].context.telemetry).toMatchObject({
            properties: { firstSelectedScenario: 'iot', lastSelectedScenario: 'inventory' },
            measurements: { scenarioSelectionCount: 3 },
        });
    });

    it('does not infer a workload selection from restored usage', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.record({ type: 'usage', usage });
        tracker.record({ type: 'sessionChoice', choice: 'continued' });
        tracker.dispose();
        expect(event('scenarioSelected')).toHaveLength(0);
        expect(event('summary')[0].context.telemetry.properties).not.toHaveProperty('firstSelectedScenario');
        expect(event('summary')[0].context.telemetry.measurements.scenarioSelectionCount).toBe(0);
    });

    it('snapshots submitted defaults and container counts even when the last webview summary is stale', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.record({ type: 'usage', usage });
        const wizard = applyScenario(createInitialState(), 'inventory');
        const names = wizard.dataModel.containers.map((container) => container.entity);
        tracker.beginRecommendation(first, names, wizard);
        expect(event('recommendationRequested')[0].context.telemetry).toMatchObject({
            properties: {
                scenario: 'inventory',
                differsFromDefault: 'false',
                dataChanged: 'false',
                queriesChanged: 'false',
                scaleChanged: 'false',
            },
            measurements: { requestedContainerCount: names.length, containerCount: names.length },
        });
        wizard.dataModel.containers[0].reads[0].qps += 1;
        tracker.beginRecommendation(second, names, wizard);
        expect(event('recommendationRequested')[1].context.telemetry.properties).toMatchObject({
            differsFromDefault: 'true',
            queriesChanged: 'true',
        });
    });

    it('counts deliberate tab/footer clicks separately from unique views and rolls up imports and new fields', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.record({ type: 'control', control: 'containerDataTab' });
        tracker.record({ type: 'control', control: 'containerDataTab' });
        tracker.record({ type: 'control', control: 'footerGetRecommendation' });
        tracker.record({ type: 'schemaImport', outcome: 'cancelled' });
        tracker.record({ type: 'schemaImport', outcome: 'error' });
        tracker.record({ type: 'schemaImport', outcome: 'success' });
        tracker.record({ type: 'fieldAdded' });
        tracker.dispose();
        expect(event('control').map((entry) => entry.context.telemetry.properties.controlId)).toEqual([
            'containerDataTab',
            'containerDataTab',
            'footerGetRecommendation',
        ]);
        expect(event('summary')[0].context.telemetry).toMatchObject({
            properties: { schemaUploaded: 'true' },
            measurements: {
                schemaImportSuccessCount: 1,
                schemaImportErrorCount: 1,
                schemaImportCancelledCount: 1,
                fieldsAddedCount: 1,
            },
        });
    });

    it('allows the same feedback vote for a later recommendation', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.beginRecommendation(first, []);
        tracker.record({ type: 'feedback', vote: 'up' });
        tracker.record({ type: 'feedback', vote: 'up' });
        tracker.beginRecommendation(second, []);
        tracker.record({ type: 'feedback', vote: 'up' });
        expect(event('feedback')).toHaveLength(2);
    });

    it('enriches milestones with the latest retained usage even when the panel never closes', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.record({ type: 'usage', usage });
        tracker.record({ type: 'usage', usage: { ...usage, queryCount: 5, queriesCoverage: 1 } });
        expect(events).toHaveLength(1);
        tracker.record({ type: 'step', step: 'review' });
        tracker.beginRecommendation(first, ['PRIVATE ENTITY']);
        tracker.record({ type: 'action', action: 'retryRecommendation' });
        tracker.record({ type: 'feedback', vote: 'up' });
        expect(event('summary')).toHaveLength(0);
        for (const milestone of ['step', 'recommendationRequested', 'action', 'feedback']) {
            expect(event(milestone)[0].context.telemetry).toMatchObject({
                properties: { scenario: 'chat', everEdited: 'true', dataChanged: 'true' },
                measurements: { queryCount: 5, queriesCoverage: 1, dataViewedCount: 1, scaleNeverViewedCount: 1 },
            });
        }
    });

    it('correlates fresh lifecycle durations once and emits only aggregates, not names or AI content', () => {
        let now = 0;
        const tracker = new ModelingTelemetry(true, () => now);
        tracker.record({ type: 'usage', usage });
        tracker.beginRecommendation(first, ['PRIVATE ENTITY', 'MISSING ENTITY']);
        now = 100;
        expect(tracker.recommendationReceived(result, first)).toBe(true);
        expect(tracker.recommendationReceived(result, first)).toBe(false);
        now = 125;
        tracker.record({ type: 'recommendationDisplayed', requestId: first });
        tracker.record({ type: 'recommendationDisplayed', requestId: first });
        expect(event('recommendationDisplayed')).toHaveLength(1);
        expect(event('recommendationReceived')[0].context.telemetry.measurements).toMatchObject({
            requestedContainerCount: 2,
            returnedContainerCount: 1,
            matchedContainerCount: 1,
            missingContainerCount: 1,
            requestToReceivedMs: 100,
            missingCandidatesCount: 1,
            missingHotPartitionRiskCount: 1,
            missingQueryRoutingCount: 1,
            missingDocumentIdStrategyCount: 1,
            missingGuardrailsCount: 1,
        });
        expect(event('recommendationDisplayed')[0].context.telemetry.measurements).toMatchObject({
            requestToDisplayedMs: 125,
            receivedToDisplayedMs: 25,
        });
        tracker.dispose();
        const serialized = JSON.stringify(events);
        for (const privateValue of ['PRIVATE', 'MISSING ENTITY', first]) expect(serialized).not.toContain(privateValue);
        for (const { context } of events) {
            expect(context.errorHandling).toMatchObject({ suppressDisplay: true, rethrow: false });
            expect(context.telemetry.properties.scenario ?? 'chat').toBe('chat');
        }
        expect(new Set(events.map((entry) => entry.context.telemetry.properties.panelId)).size).toBe(1);
    });

    it('rolls up saves and usage, visits and feedback; excludes hidden dwell and emits one disposal summary', () => {
        let now = 0;
        const tracker = new ModelingTelemetry(true, () => now);
        tracker.record({ type: 'usage', usage });
        tracker.record({ type: 'usage', usage: { ...usage, queryCount: 3 } });
        tracker.persistenceSave(false);
        tracker.persistenceSave(false);
        tracker.persistenceSave(true);
        expect(events).toHaveLength(1);
        tracker.persistenceLoad(false);
        tracker.persistenceLoad(true, true);
        tracker.record({ type: 'sessionChoice', choice: 'continued' });
        tracker.record({ type: 'step', step: 'workload' });
        tracker.record({ type: 'step', step: 'workload' });
        tracker.record({ type: 'step', step: 'review' });
        tracker.record({ type: 'step', step: 'workload' });
        tracker.record({ type: 'feedback', vote: 'up' });
        tracker.record({ type: 'feedback', vote: 'up' });
        now = 10;
        tracker.setVisible(false);
        now = 1000;
        tracker.setVisible(true);
        now = 1020;
        tracker.dispose();
        tracker.dispose();
        expect(event('step').map((entry) => entry.context.telemetry.properties.firstVisit)).toEqual([
            'true',
            'true',
            'false',
        ]);
        expect(event('feedback')).toHaveLength(1);
        expect(event('summary')).toHaveLength(1);
        expect(event('summary')[0].context.telemetry).toMatchObject({
            properties: {
                lastStep: 'workload',
                visitedWorkload: 'true',
                visitedReview: 'true',
                visitedResult: 'false',
                feedback: 'up',
                sessionChoice: 'continued',
            },
            measurements: {
                activeVisibleMs: 30,
                saveCount: 3,
                saveFailureCount: 2,
                saveRecoveryCount: 1,
                loadFailureCount: 1,
                loadRecoveryCount: 1,
                queryCount: 3,
            },
        });
    });

    it('distinguishes superseded, start-over and closed pending attempts without fabricating timeouts', () => {
        const tracker = new ModelingTelemetry(false);
        tracker.beginRecommendation(first, []);
        tracker.beginRecommendation(second, []);
        expect(tracker.recommendationReceived(result, first)).toBe(false);
        expect(tracker.recommendationFailed(first, 'ai')).toBe(false);
        tracker.record({ type: 'action', action: 'startOver' });
        expect(tracker.recommendationReceived(result, second)).toBe(false);
        tracker.beginRecommendation(undefined, []);
        tracker.dispose();
        expect(event('recommendationOutcome').map((entry) => entry.context.telemetry.properties.outcome)).toEqual([
            'superseded',
            'startOver',
            'closedBeforeResult',
        ]);
        expect(event('summary')[0].context.telemetry.measurements.recommendationRetries).toBe(2);
    });

    it('keeps legacy delivery and restored display uncorrelated with a known ID attempt', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.beginRecommendation(first, ['PRIVATE ENTITY']);
        expect(tracker.recommendationReceived(result)).toBe(true);
        tracker.record({ type: 'recommendationDisplayed' });
        tracker.record({ type: 'recommendationDisplayed' });
        expect(event('recommendationReceived')[0].context.telemetry.properties.source).toBe('uncorrelated');
        expect(event('recommendationReceived')[0].context.telemetry.measurements).not.toHaveProperty(
            'requestToReceivedMs',
        );
        expect(event('recommendationDisplayed')).toHaveLength(1);
        expect(event('recommendationDisplayed')[0].context.telemetry.properties).not.toHaveProperty('outcome');
        expect(tracker.recommendationReceived(result, first)).toBe(true);
        tracker.record({ type: 'recommendationDisplayed', requestId: first });
        expect(event('recommendationDisplayed')).toHaveLength(2);
    });

    it('categorizes pre-start client failures without falsely assigning them to another attempt', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.beginRecommendation(first, []);
        tracker.record({ type: 'recommendationClientFailure', requestId: second, errorCategory: 'save' });
        expect(event('recommendationOutcome')[0].context.telemetry.properties).toMatchObject({
            source: 'uncorrelated',
            errorCategory: 'save',
            outcome: 'error',
        });
        expect(event('recommendationOutcome')[0].context.telemetry.measurements).not.toHaveProperty('durationMs');
        expect(tracker.acceptsResponse(first)).toBe(true);
    });

    it('rejects unsafe bridge payloads and suppresses synchronous and asynchronous reporting failures', async () => {
        const tracker = new ModelingTelemetry(true);
        // @ts-expect-error Deliberately malicious extra field is rejected at runtime too.
        tracker.record({ type: 'feedback', vote: 'up', explanation: 'PRIVATE INPUT' });
        expect(event('feedback')).toHaveLength(0);
        vi.mocked(callWithTelemetryAndErrorHandling).mockImplementationOnce(() => {
            throw new Error('PRIVATE ERROR');
        });
        expect(() => tracker.record({ type: 'step', step: 'review' })).not.toThrow();
        vi.mocked(callWithTelemetryAndErrorHandling).mockRejectedValueOnce(new Error('PRIVATE ERROR'));
        expect(() => tracker.record({ type: 'step', step: 'result' })).not.toThrow();
        await Promise.resolve();
        expect(JSON.stringify(events)).not.toContain('PRIVATE');
    });

    it('attaches the resolved model identity to result events and clears it for each new attempt', () => {
        const model = {
            modelSource: 'matched',
            modelId: 'gpt-4o',
            modelFamily: 'gpt-4o',
            modelVendor: 'copilot',
        } as const;
        const tracker = new ModelingTelemetry(true);
        tracker.beginRecommendation(first, ['Orders']);
        expect(event('recommendationRequested')[0].context.telemetry.properties).not.toHaveProperty('modelSource');
        tracker.recommendationReceived(result, first, model);
        tracker.record({ type: 'recommendationDisplayed', requestId: first });
        tracker.record({ type: 'feedback', vote: 'up' });
        for (const name of ['recommendationReceived', 'recommendationDisplayed', 'feedback']) {
            expect(event(name)[0].context.telemetry.properties).toMatchObject(model);
        }

        tracker.beginRecommendation(second, ['Orders']);
        tracker.recommendationReceived(result, second);
        expect(event('recommendationReceived')[1].context.telemetry.properties).toMatchObject({
            modelSource: 'notReported',
        });
        expect(event('recommendationReceived')[1].context.telemetry.properties).not.toHaveProperty('modelId');
        tracker.dispose();
        expect(event('summary')[0].context.telemetry.properties).toMatchObject({ modelSource: 'notReported' });
    });

    it('reports model identity only for report-tool failures', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.beginRecommendation(first, ['Orders']);
        tracker.recommendationFailed(first, 'chat');
        expect(event('recommendationOutcome')[0].context.telemetry.properties).not.toHaveProperty('modelSource');
        tracker.beginRecommendation(second, ['Orders']);
        tracker.recommendationFailed(second, 'ai', { modelSource: 'unmatched' });
        expect(event('recommendationOutcome').at(-1)?.context.telemetry.properties).toMatchObject({
            errorCategory: 'ai',
            modelSource: 'unmatched',
        });
    });

    it('does not attribute a model to a restored result', () => {
        const tracker = new ModelingTelemetry(true);
        tracker.record({ type: 'recommendationDisplayed' });
        tracker.record({ type: 'feedback', vote: 'down' });
        expect(event('recommendationDisplayed')[0].context.telemetry.properties).not.toHaveProperty('modelSource');
        expect(event('feedback')[0].context.telemetry.properties).not.toHaveProperty('modelSource');
    });
});
