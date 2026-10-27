/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as React from 'react';
import { createContext, useContext, useEffect, useReducer, type Dispatch } from 'react';
import { type ProjectLoadedPayload } from '../../../../panels/trpc/routers/migrationEventsRouter';
import { sanitizeCosmosDBAccountName } from '../../../../utils/cosmosDBAccountName';
import { getMigrationModels, resolveSelectedModelId, type ModelInfo } from '../../../../utils/modelUtils';
import {
    deriveMigrationPhaseStates,
    shouldResetMigrationTargetEndpoint,
    type MigrationCompletionMap,
    type MigrationRunActivity,
} from './deriveMigrationPhaseStates';
import { type Channel } from './MigrationChannel';

export type { ModelInfo };

export type PhaseState = 'locked' | 'available' | 'in-progress' | 'complete' | 'error';

export interface MigrationState {
    workspacePath: string;
    projectName: string;
    isLoaded: boolean;
    phaseCompletion: MigrationCompletionMap | null;
    runActivity: MigrationRunActivity | null;

    // Model selection
    availableModels: ModelInfo[];
    selectedModelId: string | null;
    savedModelId: string | null;

    // Consent
    consentGiven: boolean;

    // Phase 1: Schema Inventory & Application Analysis
    schemaFiles: string[];
    volumetricFiles: string[];
    accessPatternFiles: string[];
    excludedSchemaFiles: string[];
    excludedVolumetricFiles: string[];
    excludedAccessPatternFiles: string[];
    hasVolumetricsTemplate: boolean;
    hasAccessPatternsTemplate: boolean;

    // Phase 1 (continued): Application Analysis
    analysisState: PhaseState;
    analysisResult: {
        projectName?: string;
        projectType?: string;
        language?: string;
        frameworks?: string[];
        databaseType?: string;
        databaseAccess?: string;
    } | null;

    // Phase 1: Discovery Report
    discoveryState: PhaseState;

    // Phase 2: Assessment
    assessmentState: PhaseState;
    assessmentInstructions: string;
    assessmentResult: {
        domainFiles: {
            name: string;
            tables: string[];
            filePath: string;
            isMapped: boolean;
        }[];
        summaryFilePath: string;
    } | null;

    // Phase 3: Schema Conversion
    schemaConversionState: PhaseState;
    schemaConversionResult: {
        domains: {
            name: string;
            containers: number;
            entities: number;
            summaryFilePath: string;
            modelFilePath: string;
        }[];
        mergedModelFilePath: string;
        summaryFilePath: string;
    } | null;
    schemaConversionInstructions: string;
    includeUnmappedDomains: boolean;

    // Phase 4: Target Environment
    targetType: 'emulator' | 'azure' | 'provision' | null;
    targetEndpoint: string;
    targetAccountName: string | null;
    targetSubscriptionId: string;
    targetSubscriptionName: string;
    targetResourceGroup: string;
    targetLocation: string;
    availableLocations: { name: string; displayName: string }[];
    accountProvisioningState: PhaseState;
    connectionTestState: PhaseState;
    connectionTestError: string | null;
    connectionTestDocumentationUrl: string | null;
    connectionVerified: boolean;

    // Phase 4 (continued): Provisioning
    provisioningState: PhaseState;
    hasSampleData: boolean;

    // Phase 4: Bicep export availability (informational artifact, never executed by the extension)
    bicepGenerated: boolean;

    // Git
    hasGitRepo: boolean | null;
    isInGitignore: boolean | null;

    // AI features
    isAIFeaturesEnabled: boolean;

    // Discovery instructions
    discoveryInstructions: string;

    // Additional migration instructions
    migrationInstructions: string;

    // Code migration plan
    hasCodeMigrationPlan: boolean;
    codeMigrationPlanPath: string;
    codeMigrationAction: 'plan' | 'migrate';
}

export type MigrationAction =
    | { type: 'SET_LOADED'; payload: Partial<MigrationState> }
    | { type: 'SET_PROJECT_NAME'; payload: string }
    | { type: 'SET_CONSENT'; payload: boolean }
    | {
          type: 'SET_MODELS';
          payload: { models: ModelInfo[]; savedModelId: string | null };
      }
    | { type: 'SET_SELECTED_MODEL'; payload: string }
    | { type: 'UPDATE_ANALYSIS_FIELD'; payload: { field: string; value: string } }
    | { type: 'UPDATE_FRAMEWORKS'; payload: string[] }
    | { type: 'SET_ASSESSMENT_INSTRUCTIONS'; payload: string }
    | { type: 'SET_SCHEMA_CONVERSION_INSTRUCTIONS'; payload: string }
    | { type: 'SET_INCLUDE_UNMAPPED_DOMAINS'; payload: boolean }
    | { type: 'SET_TARGET_TYPE'; payload: 'emulator' | 'azure' | 'provision' | null }
    | { type: 'SET_TARGET_ENDPOINT'; payload: string }
    | { type: 'SET_TARGET_ACCOUNT_NAME'; payload: string | null }
    | { type: 'SET_TARGET_SUBSCRIPTION'; payload: { id: string; name: string } }
    | { type: 'SET_TARGET_RESOURCE_GROUP'; payload: string }
    | { type: 'SET_TARGET_LOCATION'; payload: string }
    | { type: 'SET_AVAILABLE_LOCATIONS'; payload: { name: string; displayName: string }[] }
    | { type: 'SET_CONNECTION_TEST_STATE'; payload: PhaseState }
    | { type: 'SET_CONNECTION_TEST_ERROR'; payload: string | null }
    | { type: 'SET_CONNECTION_TEST_DOCUMENTATION_URL'; payload: string | null }
    | { type: 'SET_CONNECTION_VERIFIED'; payload: boolean }
    | { type: 'SET_GIT_STATUS'; payload: boolean }
    | { type: 'SET_GITIGNORE_STATUS'; payload: boolean }
    | { type: 'SET_AI_FEATURES_ENABLED'; payload: boolean }
    | { type: 'SET_DISCOVERY_INSTRUCTIONS'; payload: string }
    | { type: 'SET_MIGRATION_INSTRUCTIONS'; payload: string }
    | { type: 'SET_CODE_MIGRATION_ACTION'; payload: 'plan' | 'migrate' }
    | { type: 'SET_RUN_ACTIVITY'; payload: MigrationRunActivity | null };

const initialState: MigrationState = {
    workspacePath: '',
    projectName: '',
    isLoaded: false,
    phaseCompletion: null,
    runActivity: null,
    availableModels: [],
    selectedModelId: null,
    savedModelId: null,
    consentGiven: false,
    schemaFiles: [],
    volumetricFiles: [],
    accessPatternFiles: [],
    excludedSchemaFiles: [],
    excludedVolumetricFiles: [],
    excludedAccessPatternFiles: [],
    hasVolumetricsTemplate: false,
    hasAccessPatternsTemplate: false,
    analysisState: 'locked',
    analysisResult: null,
    discoveryState: 'locked',
    assessmentState: 'locked',
    assessmentInstructions: '',
    assessmentResult: null,
    schemaConversionState: 'locked',
    schemaConversionResult: null,
    schemaConversionInstructions: '',
    includeUnmappedDomains: false,
    targetType: null,
    targetEndpoint: '',
    targetAccountName: null,
    targetSubscriptionId: '',
    targetSubscriptionName: '',
    targetResourceGroup: '',
    targetLocation: 'eastus',
    availableLocations: [],
    accountProvisioningState: 'locked',
    connectionTestState: 'locked',
    connectionTestError: null,
    connectionTestDocumentationUrl: null,
    connectionVerified: false,
    provisioningState: 'locked',
    hasSampleData: false,
    bicepGenerated: false,
    hasGitRepo: null,
    isInGitignore: null,
    isAIFeaturesEnabled: false,
    discoveryInstructions: '',
    migrationInstructions: '',
    hasCodeMigrationPlan: false,
    codeMigrationPlanPath: '',
    codeMigrationAction: 'plan',
};

function migrationReducer(state: MigrationState, action: MigrationAction): MigrationState {
    switch (action.type) {
        case 'SET_RUN_ACTIVITY':
            return { ...state, runActivity: action.payload };
        case 'SET_LOADED':
            return { ...state, ...action.payload, isLoaded: true };
        case 'SET_PROJECT_NAME':
            return { ...state, projectName: action.payload };
        case 'SET_CONSENT':
            return { ...state, consentGiven: action.payload };
        case 'SET_MODELS': {
            const models = getMigrationModels(action.payload.models);
            const selectedModelId = resolveSelectedModelId(models, action.payload.savedModelId);
            return {
                ...state,
                availableModels: models,
                savedModelId: action.payload.savedModelId,
                selectedModelId,
            };
        }
        case 'SET_SELECTED_MODEL':
            return { ...state, selectedModelId: action.payload, savedModelId: action.payload };
        case 'UPDATE_ANALYSIS_FIELD': {
            const current = state.analysisResult ?? {};
            const { field, value } = action.payload;
            const updated = { ...current };
            (updated as Record<string, unknown>)[field] = value;
            return { ...state, analysisResult: updated };
        }
        case 'UPDATE_FRAMEWORKS': {
            const current = state.analysisResult ?? {};
            return { ...state, analysisResult: { ...current, frameworks: action.payload } };
        }
        case 'SET_ASSESSMENT_INSTRUCTIONS':
            return { ...state, assessmentInstructions: action.payload };
        case 'SET_SCHEMA_CONVERSION_INSTRUCTIONS':
            return { ...state, schemaConversionInstructions: action.payload };
        case 'SET_INCLUDE_UNMAPPED_DOMAINS':
            return { ...state, includeUnmappedDomains: action.payload };
        case 'SET_TARGET_TYPE': {
            const resetEndpoint = shouldResetMigrationTargetEndpoint(state.targetType, action.payload);
            return {
                ...state,
                targetType: action.payload,
                targetEndpoint: resetEndpoint ? '' : state.targetEndpoint,
                connectionVerified: false,
                connectionTestState: 'available',
                connectionTestError: null,
                connectionTestDocumentationUrl: null,
                // Preserve the account name across type switches. When switching into
                // `provision` for the first time (no name set yet), default to a
                // sanitized project-name-based suggestion.
                targetAccountName:
                    action.payload === 'provision' && !state.targetAccountName
                        ? (sanitizeCosmosDBAccountName(state.projectName) ?? null)
                        : state.targetAccountName,
                accountProvisioningState: !resetEndpoint && state.targetEndpoint ? 'complete' : 'available',
            };
        }
        case 'SET_TARGET_ENDPOINT':
            return { ...state, targetEndpoint: action.payload };
        case 'SET_TARGET_ACCOUNT_NAME': {
            const resetEndpoint =
                state.targetType === 'provision' &&
                shouldResetMigrationTargetEndpoint(
                    state.targetType,
                    state.targetType,
                    state.targetAccountName,
                    action.payload,
                );
            return {
                ...state,
                targetAccountName: action.payload,
                ...(resetEndpoint && {
                    targetEndpoint: '',
                    connectionVerified: false,
                    connectionTestState: 'available',
                    accountProvisioningState: 'available',
                }),
            };
        }
        case 'SET_TARGET_SUBSCRIPTION':
            return {
                ...state,
                targetSubscriptionId: action.payload.id,
                targetSubscriptionName: action.payload.name,
            };
        case 'SET_TARGET_RESOURCE_GROUP':
            return { ...state, targetResourceGroup: action.payload };
        case 'SET_TARGET_LOCATION':
            return { ...state, targetLocation: action.payload };
        case 'SET_AVAILABLE_LOCATIONS':
            return { ...state, availableLocations: action.payload };
        case 'SET_CONNECTION_TEST_STATE':
            return { ...state, connectionTestState: action.payload };
        case 'SET_CONNECTION_TEST_ERROR':
            return { ...state, connectionTestError: action.payload };
        case 'SET_CONNECTION_TEST_DOCUMENTATION_URL':
            return { ...state, connectionTestDocumentationUrl: action.payload };
        case 'SET_CONNECTION_VERIFIED':
            return {
                ...state,
                connectionVerified: action.payload,
                connectionTestState: action.payload ? 'complete' : 'error',
            };
        case 'SET_GIT_STATUS':
            return { ...state, hasGitRepo: action.payload };
        case 'SET_GITIGNORE_STATUS':
            return { ...state, isInGitignore: action.payload };
        case 'SET_AI_FEATURES_ENABLED':
            return { ...state, isAIFeaturesEnabled: action.payload };
        case 'SET_DISCOVERY_INSTRUCTIONS':
            return { ...state, discoveryInstructions: action.payload };
        case 'SET_MIGRATION_INSTRUCTIONS':
            return { ...state, migrationInstructions: action.payload };
        case 'SET_CODE_MIGRATION_ACTION':
            return { ...state, codeMigrationAction: action.payload };
        default:
            return state;
    }
}

const MigrationStateContext = createContext<MigrationState>(initialState);
const MigrationDispatchContext = createContext<Dispatch<MigrationAction>>(() => {});

export const useMigrationState = () => useContext(MigrationStateContext);
export const useMigrationDispatch = () => useContext(MigrationDispatchContext);

export function WithMigrationContext({ channel, children }: { channel: Channel; children?: React.ReactNode }) {
    const [state, dispatch] = useReducer(migrationReducer, initialState);

    useEffect(() => {
        const disposables: { dispose: () => void }[] = [];

        disposables.push(
            channel.on(
                'projectLoaded',
                (data: {
                    project: ProjectLoadedPayload['project'];
                    workspacePath: string;
                    schemaFiles: string[];
                    volumetricFiles: string[];
                    accessPatternFiles: string[];
                    excludedSchemaFiles: string[];
                    excludedVolumetricFiles: string[];
                    excludedAccessPatternFiles: string[];
                    hasDiscoveryReport: boolean;
                    hasAssessmentSummary: boolean;
                    assessmentResult: MigrationState['assessmentResult'];
                    hasSchemaConversion: boolean;
                    schemaConversionResult: MigrationState['schemaConversionResult'];
                    hasSampleData: boolean;
                    hasBicep: boolean;
                    hasVolumetricsTemplate: boolean;
                    hasAccessPatternsTemplate: boolean;
                    isAIFeaturesEnabled: boolean;
                    consentGiven: boolean;
                    hasCodeMigrationPlan: boolean;
                    codeMigrationPlanPath: string;
                    phaseCompletion: MigrationCompletionMap;
                    runActivity: MigrationRunActivity | null;
                }) => {
                    const discovery = data.project.phases.discovery;
                    const assessment = data.project.phases.assessment;
                    const rawAnalysis = discovery.applicationAnalysis;
                    const analysis =
                        rawAnalysis && typeof rawAnalysis === 'object' && !Array.isArray(rawAnalysis)
                            ? (rawAnalysis as Record<string, unknown>)
                            : undefined;
                    const target = data.project.phases.targetEnvironment as
                        | {
                              type: 'emulator' | 'azure' | 'provision';
                              endpoint?: string;
                              accountName?: string;
                              resourceGroup?: string;
                              location?: string;
                              subscriptionId?: string;
                              subscriptionName?: string;
                              verified?: boolean;
                          }
                        | undefined;

                    const phaseStates = deriveMigrationPhaseStates(data.phaseCompletion);
                    const discoveryComplete = data.phaseCompletion?.discovery?.complete ?? false;

                    // Initialize analysisResult with projectName from top-level if not already set
                    const analysisString = (key: string): string | undefined =>
                        typeof analysis?.[key] === 'string' ? analysis[key] : undefined;
                    const effectiveAnalysis: NonNullable<MigrationState['analysisResult']> = {
                        projectName: analysisString('projectName') || data.project.name,
                        projectType: analysisString('projectType'),
                        language: analysisString('language'),
                        frameworks: Array.isArray(analysis?.frameworks)
                            ? analysis.frameworks.filter(
                                  (framework): framework is string => typeof framework === 'string',
                              )
                            : [],
                        databaseType: analysisString('databaseType'),
                        databaseAccess: analysisString('databaseAccess'),
                    };

                    // Discovery report state is independent of analysis (auto-detect) state
                    const hasAnalysis = !!analysis;
                    dispatch({
                        type: 'SET_LOADED',
                        payload: {
                            workspacePath: data.workspacePath,
                            projectName: data.project.name,
                            schemaFiles: data.schemaFiles,
                            volumetricFiles: data.volumetricFiles,
                            accessPatternFiles: data.accessPatternFiles,
                            excludedSchemaFiles: data.excludedSchemaFiles,
                            excludedVolumetricFiles: data.excludedVolumetricFiles,
                            excludedAccessPatternFiles: data.excludedAccessPatternFiles,
                            hasVolumetricsTemplate: data.hasVolumetricsTemplate,
                            hasAccessPatternsTemplate: data.hasAccessPatternsTemplate,
                            analysisResult: effectiveAnalysis,
                            analysisState: hasAnalysis ? 'complete' : 'available',
                            discoveryState: phaseStates.discoveryState,
                            assessmentState: phaseStates.assessmentState,
                            assessmentInstructions: assessment?.assessmentInstructions ?? '',
                            assessmentResult: data.assessmentResult ?? null,
                            schemaConversionState: phaseStates.schemaConversionState,
                            schemaConversionResult: data.schemaConversionResult ?? null,
                            schemaConversionInstructions:
                                data.project.phases.schemaConversion?.schemaConversionInstructions ?? '',
                            targetType: target?.type ?? null,
                            targetEndpoint: target?.endpoint ?? '',
                            targetAccountName:
                                target?.accountName ?? sanitizeCosmosDBAccountName(data.project.name) ?? null,
                            targetSubscriptionId: target?.subscriptionId ?? '',
                            targetSubscriptionName: target?.subscriptionName ?? '',
                            targetResourceGroup: target?.resourceGroup ?? '',
                            targetLocation: target?.location ?? 'eastus',
                            accountProvisioningState: target?.endpoint ? 'complete' : 'available',
                            connectionVerified: target?.verified ?? false,
                            connectionTestState: target?.verified
                                ? 'complete'
                                : discoveryComplete
                                  ? 'available'
                                  : 'locked',
                            provisioningState: phaseStates.provisioningState,
                            hasSampleData: data.hasSampleData,
                            bicepGenerated: data.hasBicep,
                            isAIFeaturesEnabled: data.isAIFeaturesEnabled,
                            consentGiven: data.consentGiven,
                            discoveryInstructions: discovery.discoveryInstructions ?? '',
                            migrationInstructions: data.project.migrationInstructions ?? '',
                            hasCodeMigrationPlan: data.hasCodeMigrationPlan,
                            codeMigrationPlanPath: data.codeMigrationPlanPath,
                            codeMigrationAction: data.phaseCompletion?.['code-migration']?.complete
                                ? 'migrate'
                                : 'plan',
                            phaseCompletion: data.phaseCompletion,
                            runActivity: data.runActivity ?? null,
                        },
                    });
                },
            ),
        );

        disposables.push(
            channel.on('runActivityChanged', (activity: MigrationRunActivity | null) => {
                dispatch({ type: 'SET_RUN_ACTIVITY', payload: activity });
            }),
        );

        disposables.push(
            channel.on('availableModels', (models: ModelInfo[], savedModelId: string | null) => {
                dispatch({
                    type: 'SET_MODELS',
                    payload: { models, savedModelId },
                });
            }),
        );

        disposables.push(
            channel.on('accountSelected', (data: { endpoint: string; accountName: string }) => {
                dispatch({ type: 'SET_TARGET_TYPE', payload: 'azure' });
                dispatch({ type: 'SET_TARGET_ENDPOINT', payload: data.endpoint });
                dispatch({ type: 'SET_TARGET_ACCOUNT_NAME', payload: data.accountName });
            }),
        );

        disposables.push(
            channel.on(
                'resourceGroupSelected',
                (data: {
                    subscriptionId: string;
                    subscriptionName: string;
                    resourceGroup: string;
                    location: string;
                    locationDisplayName?: string;
                }) => {
                    dispatch({
                        type: 'SET_TARGET_SUBSCRIPTION',
                        payload: { id: data.subscriptionId, name: data.subscriptionName },
                    });
                    dispatch({ type: 'SET_TARGET_RESOURCE_GROUP', payload: data.resourceGroup });
                    dispatch({ type: 'SET_TARGET_LOCATION', payload: data.location });
                    // Seed the available-locations list with a single entry so the
                    // dropdown shows the friendly display name ("East US") right
                    // away, instead of briefly flashing the canonical short name
                    // ("eastus") until `listCosmosDBLocations` returns and replaces
                    // the list with the full set of regions.
                    if (data.location) {
                        dispatch({
                            type: 'SET_AVAILABLE_LOCATIONS',
                            payload: [
                                {
                                    name: data.location,
                                    displayName: data.locationDisplayName ?? data.location,
                                },
                            ],
                        });
                    }
                },
            ),
        );

        disposables.push(
            channel.on('locationsList', (locations: { name: string; displayName: string }[]) => {
                dispatch({ type: 'SET_AVAILABLE_LOCATIONS', payload: locations });
            }),
        );

        disposables.push(
            channel.on('connectionTestStarted', () => {
                dispatch({ type: 'SET_CONNECTION_TEST_STATE', payload: 'in-progress' });
                dispatch({ type: 'SET_CONNECTION_TEST_ERROR', payload: null });
            }),
        );

        disposables.push(
            channel.on(
                'connectionTestResult',
                (result: { success: boolean; error?: string; documentationUrl?: string }) => {
                    dispatch({ type: 'SET_CONNECTION_VERIFIED', payload: result.success });
                    if (!result.success) {
                        const errorMessage = result.error || 'Connection test failed.';
                        console.error('[Migration] Connection test failed:', errorMessage);
                        dispatch({ type: 'SET_CONNECTION_TEST_ERROR', payload: errorMessage });
                        dispatch({
                            type: 'SET_CONNECTION_TEST_DOCUMENTATION_URL',
                            payload: result.documentationUrl ?? null,
                        });
                    } else {
                        dispatch({ type: 'SET_CONNECTION_TEST_DOCUMENTATION_URL', payload: null });
                    }
                },
            ),
        );

        disposables.push(
            channel.on('gitStatus', (hasGit: boolean) => {
                dispatch({ type: 'SET_GIT_STATUS', payload: hasGit });
            }),
        );

        disposables.push(
            channel.on('gitignoreStatus', (isInGitignore: boolean) => {
                dispatch({ type: 'SET_GITIGNORE_STATUS', payload: isInGitignore });
            }),
        );

        disposables.push(
            channel.on('aiFeaturesEnabledChanged', (available: boolean) => {
                dispatch({ type: 'SET_AI_FEATURES_ENABLED', payload: available });
            }),
        );

        return () => {
            disposables.forEach((d) => d.dispose());
        };
    }, [channel]);

    return (
        <MigrationStateContext.Provider value={state}>
            <MigrationDispatchContext.Provider value={dispatch}>{children}</MigrationDispatchContext.Provider>
        </MigrationStateContext.Provider>
    );
}
