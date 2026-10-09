/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
    deriveMigrationPhaseStates,
    isCodeMigrationReady,
    isDiscoveryLaunchReady,
    shouldResetMigrationTargetEndpoint,
    type MigrationCompletionMap,
    type MigrationPhaseName,
} from './deriveMigrationPhaseStates';
import { MigrationChannel, type Channel } from './MigrationChannel';
import { useMigrationDispatch, useMigrationState, WithMigrationContext } from './MigrationContext';

describe('shouldResetMigrationTargetEndpoint', () => {
    it.each(['azure', 'provision'] as const)('clears the emulator endpoint when selecting %s', (targetType) => {
        expect(shouldResetMigrationTargetEndpoint('emulator', targetType)).toBe(true);
        expect(shouldResetMigrationTargetEndpoint(targetType, 'emulator')).toBe(true);
    });

    it('clears an existing account endpoint when selecting a new account', () => {
        expect(shouldResetMigrationTargetEndpoint('azure', 'provision', 'old', 'new')).toBe(true);
        expect(shouldResetMigrationTargetEndpoint('azure', 'provision', 'same', 'same')).toBe(true);
        expect(shouldResetMigrationTargetEndpoint('provision', 'provision', 'old', 'new')).toBe(true);
        expect(shouldResetMigrationTargetEndpoint('azure', null)).toBe(true);
    });

    it('preserves an endpoint when adopting the same provisioned account', () => {
        expect(shouldResetMigrationTargetEndpoint('provision', 'azure')).toBe(false);
    });

    it('preserves endpoints for same-target partial updates', () => {
        expect(shouldResetMigrationTargetEndpoint('emulator', 'emulator')).toBe(false);
        expect(shouldResetMigrationTargetEndpoint('azure', 'azure')).toBe(false);
        expect(shouldResetMigrationTargetEndpoint('provision', 'provision', 'same', 'same')).toBe(false);
        expect(shouldResetMigrationTargetEndpoint('provision', 'provision', 'same', null)).toBe(false);
        expect(shouldResetMigrationTargetEndpoint('provision', 'provision', 'same')).toBe(false);
    });
});

describe('Discovery launch readiness', () => {
    const ready = {
        projectName: 'migration-app',
        consentGiven: true,
        selectedModelId: 'auto',
        isAIFeaturesEnabled: true,
    };

    it('allows launch without application analysis, schema files, or preflight completion', () => {
        expect(isDiscoveryLaunchReady(ready)).toBe(true);
    });

    it.each([
        { projectName: '' },
        { projectName: '   ' },
        { consentGiven: false },
        { selectedModelId: null },
        { selectedModelId: '' },
        { isAIFeaturesEnabled: false },
    ])('requires all launch preconditions: %j', (missing) => {
        expect(isDiscoveryLaunchReady({ ...ready, ...missing })).toBe(false);
    });
});

describe('migration model state', () => {
    const models = ['auto', 'first', 'second'].map((id) => ({
        id,
        name: id,
        family: id,
        vendor: 'copilot',
        maxInputTokens: 100_000,
    }));
    const channel: Channel = { on: () => ({ dispose: () => {} }), postMessage: async () => {} };
    const setup = () =>
        renderHook(() => ({ state: useMigrationState(), dispatch: useMigrationDispatch() }), {
            wrapper: ({ children }: { children: ReactNode }) =>
                createElement(WithMigrationContext, { channel }, children),
        });

    it('clears stale UI endpoints when selecting or renaming a new account', () => {
        const { result } = setup();
        act(() => result.current.dispatch({ type: 'SET_TARGET_TYPE', payload: 'emulator' }));
        act(() => result.current.dispatch({ type: 'SET_TARGET_ENDPOINT', payload: 'https://localhost:8081/' }));
        act(() => result.current.dispatch({ type: 'SET_TARGET_TYPE', payload: 'provision' }));
        expect(result.current.state.targetEndpoint).toBe('');
        expect(result.current.state.accountProvisioningState).toBe('available');
        expect(result.current.state.connectionVerified).toBe(false);

        act(() => result.current.dispatch({ type: 'SET_TARGET_ACCOUNT_NAME', payload: 'old-account' }));
        act(() =>
            result.current.dispatch({
                type: 'SET_TARGET_ENDPOINT',
                payload: 'https://old-account.documents.azure.com/',
            }),
        );
        act(() => result.current.dispatch({ type: 'SET_TARGET_ACCOUNT_NAME', payload: 'new-account' }));
        expect(result.current.state.targetEndpoint).toBe('');
        expect(result.current.state.accountProvisioningState).toBe('available');
    });

    it('preserves saved Auto while legacy mode resolves the first model', () => {
        const { result } = setup();
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models, savedModelId: 'auto', useProgrammaticFlow: false },
            }),
        );
        expect(result.current.state.selectedModelId).toBe('auto');
        act(() => result.current.dispatch({ type: 'SET_USE_PROGRAMMATIC_FLOW', payload: true }));
        expect(result.current.state.selectedModelId).toBe('first');
        expect(result.current.state.savedModelId).toBe('auto');
        expect(result.current.state.availableModels.map((model) => model.id)).toEqual(['first', 'second']);
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models, savedModelId: 'auto', useProgrammaticFlow: false },
            }),
        );
        expect(result.current.state.selectedModelId).toBe('auto');
    });

    it('replaces the saved preference only on explicit selection', () => {
        const { result } = setup();
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models, savedModelId: 'auto', useProgrammaticFlow: true },
            }),
        );
        act(() => result.current.dispatch({ type: 'SET_SELECTED_MODEL', payload: 'second' }));
        act(() => result.current.dispatch({ type: 'SET_USE_PROGRAMMATIC_FLOW', payload: false }));
        expect(result.current.state.savedModelId).toBe('second');
        expect(result.current.state.selectedModelId).toBe('second');
    });

    it('clears estimates on selection and ignores stale model or file results', () => {
        const { result } = setup();
        const estimate = {
            modelId: 'first',
            minTokens: 10,
            maxTokens: 20,
            modelMaxTokens: 100_000,
            estimateGeneration: 0,
        };
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models, savedModelId: null, useProgrammaticFlow: true },
            }),
        );
        act(() => result.current.dispatch({ type: 'SET_TOKEN_ESTIMATE', payload: estimate }));
        expect(result.current.state.tokenEstimate).toEqual(estimate);
        act(() => result.current.dispatch({ type: 'SET_SELECTED_MODEL', payload: 'auto' }));
        act(() => result.current.dispatch({ type: 'SET_TOKEN_ESTIMATE', payload: estimate }));
        expect(result.current.state.tokenEstimate).toBeNull();
        act(() => result.current.dispatch({ type: 'SET_SELECTED_MODEL', payload: 'second' }));
        act(() =>
            result.current.dispatch({
                type: 'SET_TOKEN_ESTIMATE',
                payload: { ...estimate, modelId: 'second', estimateGeneration: 1 },
            }),
        );
        expect(result.current.state.tokenEstimate).toBeNull();
    });

    it.each([
        { modelId: 'first', viaModels: false },
        { modelId: 'auto', viaModels: false },
        { modelId: 'first', viaModels: true },
    ])('rejects token estimates in skill mode: %j', ({ modelId, viaModels }) => {
        const { result } = setup();
        const estimate = {
            modelId,
            minTokens: 10,
            maxTokens: 20,
            modelMaxTokens: 100_000,
            estimateGeneration: 0,
        };
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models, savedModelId: 'first', useProgrammaticFlow: true },
            }),
        );
        act(() => result.current.dispatch({ type: 'SET_TOKEN_ESTIMATE', payload: { ...estimate, modelId: 'first' } }));
        expect(result.current.state.tokenEstimate).not.toBeNull();
        act(() =>
            result.current.dispatch(
                viaModels
                    ? { type: 'SET_MODELS', payload: { models, savedModelId: 'first', useProgrammaticFlow: false } }
                    : { type: 'SET_USE_PROGRAMMATIC_FLOW', payload: false },
            ),
        );
        expect(result.current.state.tokenEstimate).toBeNull();
        act(() => result.current.dispatch({ type: 'SET_SELECTED_MODEL', payload: modelId }));
        act(() => result.current.dispatch({ type: 'SET_TOKEN_ESTIMATE', payload: estimate }));
        expect(result.current.state.tokenEstimate).toBeNull();

        act(() => result.current.dispatch({ type: 'SET_USE_PROGRAMMATIC_FLOW', payload: true }));
        act(() => result.current.dispatch({ type: 'SET_TOKEN_ESTIMATE', payload: { ...estimate, modelId: 'first' } }));
        expect(result.current.state.tokenEstimate).toEqual({ ...estimate, modelId: 'first' });
    });

    it('supports an empty legacy list without selecting Auto', () => {
        const { result } = setup();
        act(() =>
            result.current.dispatch({
                type: 'SET_MODELS',
                payload: { models: models.slice(0, 1), savedModelId: 'auto', useProgrammaticFlow: true },
            }),
        );
        expect(result.current.state.selectedModelId).toBeNull();
        expect(result.current.state.savedModelId).toBe('auto');
    });
});

describe('migration selection command ordering', () => {
    const setup = () => {
        const mutate = vi
            .fn<(input: { commandName: string; params: unknown[] }) => Promise<unknown>>()
            .mockResolvedValue(undefined);
        const channel = new MigrationChannel({
            migration: { events: { subscribe: () => ({ unsubscribe: () => {} }) }, command: { mutate } },
        } as unknown as ConstructorParameters<typeof MigrationChannel>[0]);
        const post = (commandName: string, ...params: unknown[]) =>
            channel.postMessage({
                type: 'event',
                name: 'command',
                params: [{ commandName, params }],
            });
        return { channel, mutate, post };
    };

    it('waits for a model save before dispatching or estimating', async () => {
        const { channel, mutate, post } = setup();
        let finish!: () => void;
        mutate.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
        );
        const selection = post('setSelectedModel', 'auto');
        const dispatch = post('runDiscovery');
        const estimate = post('estimateContextTokens');
        await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        expect(mutate).toHaveBeenCalledWith({ commandName: 'setSelectedModel', params: ['auto'] });
        finish();
        await Promise.all([selection, dispatch, estimate]);
        expect(mutate.mock.calls.map(([input]) => input.commandName)).toEqual([
            'setSelectedModel',
            'runDiscovery',
            'estimateContextTokens',
        ]);
        channel.dispose();
    });

    it('blocks dispatch after a failed save and recovers on an explicit new choice', async () => {
        const { channel, mutate, post } = setup();
        mutate.mockRejectedValueOnce(new Error('save failed'));
        await expect(post('setSelectedModel', 'auto')).rejects.toThrow('save failed');
        await expect(post('runDiscovery')).rejects.toThrow('save failed');
        expect(mutate).toHaveBeenCalledTimes(1);
        await post('setSelectedModel', 'first');
        await post('runDiscovery');
        expect(mutate).toHaveBeenCalledTimes(3);
        channel.dispose();
    });
});

function completion(overrides: Partial<Record<MigrationPhaseName, boolean>> = {}): MigrationCompletionMap {
    const phase = (name: MigrationPhaseName): MigrationCompletionMap[MigrationPhaseName] => ({
        phase: name,
        status: overrides[name] ? 'complete' : 'not-started',
        complete: overrides[name] ?? false,
        artifacts: [],
        errors: [],
    });
    return {
        preflight: phase('preflight'),
        discovery: phase('discovery'),
        assessment: phase('assessment'),
        'schema-conversion': phase('schema-conversion'),
        provisioning: phase('provisioning'),
        'code-migration': phase('code-migration'),
    };
}

describe('deriveMigrationPhaseStates', () => {
    it('uses accepted-model readiness independently of live phases and past migration completion', () => {
        const phases = completion();
        phases['code-migration'].ready = true;
        expect(isCodeMigrationReady(phases)).toBe(true);
        expect(deriveMigrationPhaseStates(phases).schemaConversionState).toBe('locked');
        phases['code-migration'].complete = true;
        phases['code-migration'].ready = false;
        expect(isCodeMigrationReady(phases)).toBe(false);
        expect(isCodeMigrationReady(undefined)).toBe(false);
        expect(isCodeMigrationReady(completion({ 'schema-conversion': true }))).toBe(false);
    });

    it('makes Skill Discovery available before preflight validates', () => {
        expect(deriveMigrationPhaseStates(completion()).discoveryState).toBe('available');
        expect(deriveMigrationPhaseStates(completion({ preflight: true })).discoveryState).toBe('available');
    });

    it('preserves the preflight gate for the legacy runner', () => {
        expect(deriveMigrationPhaseStates(completion(), true).discoveryState).toBe('locked');
        expect(deriveMigrationPhaseStates(completion({ preflight: true }), true).discoveryState).toBe('available');
    });

    it('treats missing completion entries as incomplete', () => {
        expect(deriveMigrationPhaseStates(undefined)).toEqual({
            discoveryState: 'available',
            assessmentState: 'locked',
            schemaConversionState: 'locked',
            provisioningState: 'locked',
        });
        expect(deriveMigrationPhaseStates({ discovery: completion().discovery })).toMatchObject({
            discoveryState: 'available',
            assessmentState: 'locked',
            schemaConversionState: 'locked',
            provisioningState: 'locked',
        });
    });

    it('unlocks each phase only after its validated prerequisite', () => {
        expect(deriveMigrationPhaseStates(completion({ discovery: true }))).toMatchObject({
            discoveryState: 'complete',
            assessmentState: 'available',
            schemaConversionState: 'locked',
        });
        expect(deriveMigrationPhaseStates(completion({ discovery: true, assessment: true }))).toMatchObject({
            assessmentState: 'complete',
            schemaConversionState: 'available',
        });
    });

    it('keeps previously completed phases actionable when their current evidence is stale', () => {
        const phases = completion();
        phases.discovery.status = 'complete';
        phases.assessment.status = 'complete';
        phases['schema-conversion'].status = 'complete';
        phases.provisioning.status = 'complete';
        phases['code-migration'].ready = false;

        expect(deriveMigrationPhaseStates(phases)).toEqual({
            discoveryState: 'available',
            assessmentState: 'available',
            schemaConversionState: 'available',
            provisioningState: 'available',
        });
    });

    it('restores prior completed phases when the terminal code migration still validates', () => {
        const phases = completion({ 'code-migration': true });
        phases.discovery.status = 'complete';
        phases.assessment.status = 'complete';
        phases['schema-conversion'].status = 'complete';
        phases.provisioning.status = 'complete';

        expect(deriveMigrationPhaseStates(phases)).toEqual({
            discoveryState: 'complete',
            assessmentState: 'complete',
            schemaConversionState: 'complete',
            provisioningState: 'complete',
        });
    });

    it('restores completed phases when a blocked code migration still has a validated accepted model', () => {
        const phases = completion();
        phases.discovery.status = 'complete';
        phases.assessment.status = 'complete';
        phases['schema-conversion'].status = 'complete';
        phases.provisioning.status = 'complete';
        phases['code-migration'].status = 'in-progress';
        phases['code-migration'].ready = true;

        expect(deriveMigrationPhaseStates(phases)).toEqual({
            discoveryState: 'complete',
            assessmentState: 'complete',
            schemaConversionState: 'complete',
            provisioningState: 'complete',
        });
        expect(phases['code-migration'].complete).toBe(false);
        expect(phases.discovery.complete).toBe(false);
    });

    it.each(['not-started', 'in-progress'] as const)(
        'does not mark %s phases complete solely from accepted-model readiness',
        (status) => {
            const phases = completion();
            phases.discovery.status = status;
            phases.assessment.status = status;
            phases['schema-conversion'].status = status;
            phases.provisioning.status = status;
            phases['code-migration'].ready = true;

            expect(deriveMigrationPhaseStates(phases)).toEqual({
                discoveryState: 'available',
                assessmentState: 'locked',
                schemaConversionState: 'locked',
                provisioningState: 'locked',
            });
        },
    );

    it('marks only checker-confirmed phases complete', () => {
        expect(
            deriveMigrationPhaseStates(
                completion({
                    preflight: true,
                    discovery: true,
                    assessment: true,
                    'schema-conversion': true,
                    provisioning: true,
                }),
            ),
        ).toEqual({
            discoveryState: 'complete',
            assessmentState: 'complete',
            schemaConversionState: 'complete',
            provisioningState: 'complete',
        });
    });
});
