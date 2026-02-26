/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as React from 'react';
import { createContext, useContext, useEffect, useReducer, type Dispatch } from 'react';
import { type Channel } from '../../../../panels/Communication/Channel/Channel';
import { resolveSelectedModelId, type ModelInfo } from '../../../../utils/modelUtils';

export type { ModelInfo };

export type PhaseState = 'locked' | 'available' | 'in-progress' | 'complete' | 'error';

export interface MigrationState {
    workspacePath: string;
    projectName: string;
    isLoaded: boolean;

    // Model selection
    availableModels: ModelInfo[];
    selectedModelId: string | null;

    // Consent
    consentGiven: boolean;

    // Phase 1: Schema Inventory & Application Analysis
    schemaFiles: string[];
    volumetricFiles: string[];
    accessPatternFiles: string[];

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
    analysisError: string | null;

    // Phase 2: Assessment
    assessmentState: PhaseState;
    assessmentResult: {
        domainFiles: {
            name: string;
            tables: string[];
            filePath: string;
            isMapped: boolean;
            estimatedTokens: number;
        }[];
        summaryFilePath: string;
    } | null;
    assessmentError: string | null;
    assessmentProgress: string | null;

    // Phase 3: Schema Conversion
    schemaConversionState: PhaseState;
    schemaConversionResult: {
        domains: string[];
    } | null;
    schemaConversionError: string | null;
    schemaConversionProgress: string | null;
    includeUnmappedDomains: boolean;

    // Phase 4: Target Environment
    targetType: 'emulator' | 'azure' | null;
    targetEndpoint: string;
    connectionTestState: PhaseState;
    connectionTestError: string | null;
    connectionVerified: boolean;

    // Git
    hasGitRepo: boolean | null;

    // AI features
    isAIFeaturesEnabled: boolean;

    // Token estimate for context
    tokenEstimate: { tokens: number; maxTokens: number } | null;
}

export type MigrationAction =
    | { type: 'SET_LOADED'; payload: Partial<MigrationState> }
    | { type: 'SET_PROJECT_NAME'; payload: string }
    | { type: 'SET_CONSENT'; payload: boolean }
    | { type: 'SET_MODELS'; payload: { models: ModelInfo[]; savedModelId: string | null } }
    | { type: 'SET_SELECTED_MODEL'; payload: string }
    | { type: 'SET_ANALYSIS_STATE'; payload: PhaseState }
    | {
          type: 'SET_ANALYSIS_RESULT';
          payload: {
              projectName?: string;
              projectType?: string;
              language?: string;
              frameworks?: string[];
              databaseType?: string;
              databaseAccess?: string;
          };
      }
    | { type: 'SET_ANALYSIS_ERROR'; payload: string }
    | { type: 'UPDATE_ANALYSIS_FIELD'; payload: { field: string; value: string } }
    | { type: 'SET_ASSESSMENT_STATE'; payload: PhaseState }
    | {
          type: 'SET_ASSESSMENT_RESULT';
          payload: NonNullable<MigrationState['assessmentResult']>;
      }
    | { type: 'SET_ASSESSMENT_ERROR'; payload: string }
    | { type: 'SET_ASSESSMENT_PROGRESS'; payload: string | null }
    | { type: 'SET_SCHEMA_CONVERSION_STATE'; payload: PhaseState }
    | { type: 'SET_SCHEMA_CONVERSION_RESULT'; payload: { domains: string[] } }
    | { type: 'SET_SCHEMA_CONVERSION_ERROR'; payload: string }
    | { type: 'SET_SCHEMA_CONVERSION_PROGRESS'; payload: string | null }
    | { type: 'SET_INCLUDE_UNMAPPED_DOMAINS'; payload: boolean }
    | { type: 'SET_TARGET_TYPE'; payload: 'emulator' | 'azure' | null }
    | { type: 'SET_TARGET_ENDPOINT'; payload: string }
    | { type: 'SET_CONNECTION_TEST_STATE'; payload: PhaseState }
    | { type: 'SET_CONNECTION_TEST_ERROR'; payload: string | null }
    | { type: 'SET_CONNECTION_VERIFIED'; payload: boolean }
    | { type: 'SET_GIT_STATUS'; payload: boolean }
    | { type: 'SET_AI_FEATURES_ENABLED'; payload: boolean }
    | { type: 'SET_TOKEN_ESTIMATE'; payload: { tokens: number; maxTokens: number } | null };

const initialState: MigrationState = {
    workspacePath: '',
    projectName: '',
    isLoaded: false,
    availableModels: [],
    selectedModelId: null,
    consentGiven: false,
    schemaFiles: [],
    volumetricFiles: [],
    accessPatternFiles: [],
    analysisState: 'locked',
    analysisResult: null,
    analysisError: null,
    assessmentState: 'locked',
    assessmentResult: null,
    assessmentError: null,
    assessmentProgress: null,
    schemaConversionState: 'locked',
    schemaConversionResult: null,
    schemaConversionError: null,
    schemaConversionProgress: null,
    includeUnmappedDomains: false,
    targetType: null,
    targetEndpoint: '',
    connectionTestState: 'locked',
    connectionTestError: null,
    connectionVerified: false,
    hasGitRepo: null,
    isAIFeaturesEnabled: false,
    tokenEstimate: null,
};

function migrationReducer(state: MigrationState, action: MigrationAction): MigrationState {
    switch (action.type) {
        case 'SET_LOADED':
            return { ...state, ...action.payload, isLoaded: true };
        case 'SET_PROJECT_NAME':
            return { ...state, projectName: action.payload };
        case 'SET_CONSENT':
            return { ...state, consentGiven: action.payload };
        case 'SET_MODELS':
            return {
                ...state,
                availableModels: action.payload.models,
                selectedModelId: action.payload.savedModelId ?? action.payload.models[0]?.id ?? null,
            };
        case 'SET_SELECTED_MODEL':
            return { ...state, selectedModelId: action.payload };
        case 'SET_ANALYSIS_STATE':
            return {
                ...state,
                analysisState: action.payload,
                analysisError: action.payload === 'error' ? state.analysisError : null,
            };
        case 'SET_ANALYSIS_RESULT':
            return { ...state, analysisResult: action.payload, analysisState: 'complete' };
        case 'SET_ANALYSIS_ERROR':
            return { ...state, analysisError: action.payload, analysisState: 'error' };
        case 'UPDATE_ANALYSIS_FIELD': {
            if (!state.analysisResult) return state;
            const { field, value } = action.payload;
            const updated = { ...state.analysisResult };
            if (field === 'frameworks') {
                updated.frameworks = value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
            } else {
                (updated as Record<string, unknown>)[field] = value;
            }
            return { ...state, analysisResult: updated };
        }
        case 'SET_ASSESSMENT_STATE':
            return {
                ...state,
                assessmentState: action.payload,
                assessmentError: action.payload === 'error' ? state.assessmentError : null,
                assessmentProgress: null,
            };
        case 'SET_ASSESSMENT_RESULT':
            return {
                ...state,
                assessmentResult: action.payload,
                assessmentState: 'complete',
                assessmentProgress: null,
            };
        case 'SET_ASSESSMENT_ERROR':
            return { ...state, assessmentError: action.payload, assessmentState: 'error', assessmentProgress: null };
        case 'SET_ASSESSMENT_PROGRESS':
            return { ...state, assessmentProgress: action.payload };
        case 'SET_SCHEMA_CONVERSION_STATE':
            return {
                ...state,
                schemaConversionState: action.payload,
                schemaConversionError: action.payload === 'error' ? state.schemaConversionError : null,
                schemaConversionProgress: null,
            };
        case 'SET_SCHEMA_CONVERSION_RESULT':
            return {
                ...state,
                schemaConversionResult: action.payload,
                schemaConversionState: 'complete',
                schemaConversionProgress: null,
            };
        case 'SET_SCHEMA_CONVERSION_ERROR':
            return {
                ...state,
                schemaConversionError: action.payload,
                schemaConversionState: 'error',
                schemaConversionProgress: null,
            };
        case 'SET_SCHEMA_CONVERSION_PROGRESS':
            return { ...state, schemaConversionProgress: action.payload };
        case 'SET_INCLUDE_UNMAPPED_DOMAINS':
            return { ...state, includeUnmappedDomains: action.payload };
        case 'SET_TARGET_TYPE':
            return {
                ...state,
                targetType: action.payload,
                connectionVerified: false,
                connectionTestState: 'available',
                connectionTestError: null,
            };
        case 'SET_TARGET_ENDPOINT':
            return { ...state, targetEndpoint: action.payload };
        case 'SET_CONNECTION_TEST_STATE':
            return { ...state, connectionTestState: action.payload };
        case 'SET_CONNECTION_TEST_ERROR':
            return { ...state, connectionTestError: action.payload };
        case 'SET_CONNECTION_VERIFIED':
            return {
                ...state,
                connectionVerified: action.payload,
                connectionTestState: action.payload ? 'complete' : 'error',
            };
        case 'SET_GIT_STATUS':
            return { ...state, hasGitRepo: action.payload };
        case 'SET_AI_FEATURES_ENABLED':
            return { ...state, isAIFeaturesEnabled: action.payload };
        case 'SET_TOKEN_ESTIMATE':
            return { ...state, tokenEstimate: action.payload };
        default:
            return state;
    }
}

const MigrationStateContext = createContext<MigrationState>(initialState);
const MigrationDispatchContext = createContext<Dispatch<MigrationAction>>(() => {});

export const useMigrationState = () => useContext(MigrationStateContext);
export const useMigrationDispatch = () => useContext(MigrationDispatchContext);

export function WithMigrationContext({ channel, children }: { channel: Channel; children: React.ReactNode }) {
    const [state, dispatch] = useReducer(migrationReducer, initialState);

    useEffect(() => {
        const disposables: { dispose: () => void }[] = [];

        disposables.push(
            channel.on(
                'projectLoaded',
                (data: {
                    project: { name: string; phases: { discovery: Record<string, unknown> } };
                    workspacePath: string;
                    schemaFiles: string[];
                    volumetricFiles: string[];
                    accessPatternFiles: string[];
                    hasDiscoveryReport: boolean;
                    hasAssessmentSummary: boolean;
                    assessmentResult: MigrationState['assessmentResult'];
                    hasSchemaConversion: boolean;
                    isAIFeaturesEnabled: boolean;
                }) => {
                    const discovery = data.project.phases.discovery;
                    const analysis = discovery.applicationAnalysis as MigrationState['analysisResult'] | undefined;
                    const target = discovery.targetEnvironment as
                        | {
                              type: 'emulator' | 'azure';
                              connectionString?: string;
                              verified?: boolean;
                          }
                        | undefined;

                    // Phase 1 is complete when schema files exist AND discovery-report.md exists
                    const stepComplete = data.schemaFiles.length > 0 && data.hasDiscoveryReport;
                    const assessmentComplete = data.hasAssessmentSummary;
                    const schemaConversionComplete = data.hasSchemaConversion;

                    dispatch({
                        type: 'SET_LOADED',
                        payload: {
                            workspacePath: data.workspacePath,
                            projectName: data.project.name,
                            schemaFiles: data.schemaFiles,
                            volumetricFiles: data.volumetricFiles,
                            accessPatternFiles: data.accessPatternFiles,
                            analysisResult: analysis ?? null,
                            analysisState: stepComplete ? 'complete' : 'available',
                            assessmentState: assessmentComplete ? 'complete' : stepComplete ? 'available' : 'locked',
                            assessmentResult: data.assessmentResult ?? null,
                            assessmentError: null,
                            schemaConversionState: schemaConversionComplete
                                ? 'complete'
                                : assessmentComplete
                                  ? 'available'
                                  : 'locked',
                            schemaConversionResult: null,
                            schemaConversionError: null,
                            targetType: target?.type ?? null,
                            targetEndpoint: target?.connectionString ?? '',
                            connectionVerified: false,
                            connectionTestState: stepComplete ? 'available' : 'locked',
                            isAIFeaturesEnabled: data.isAIFeaturesEnabled,
                        },
                    });
                },
            ),
        );

        disposables.push(
            channel.on('availableModels', (models: ModelInfo[], savedModelId: string | null) => {
                dispatch({
                    type: 'SET_MODELS',
                    payload: { models, savedModelId: resolveSelectedModelId(models, savedModelId) },
                });
            }),
        );

        disposables.push(
            channel.on('analysisStarted', () => {
                dispatch({ type: 'SET_ANALYSIS_STATE', payload: 'in-progress' });
            }),
        );

        disposables.push(
            channel.on('analysisCompleted', (result: MigrationState['analysisResult']) => {
                if (result) {
                    dispatch({ type: 'SET_ANALYSIS_RESULT', payload: result });
                }
            }),
        );

        disposables.push(
            channel.on('analysisError', (error: string) => {
                dispatch({ type: 'SET_ANALYSIS_ERROR', payload: error });
            }),
        );

        disposables.push(
            channel.on('analysisCancelled', () => {
                dispatch({ type: 'SET_ANALYSIS_STATE', payload: 'available' });
            }),
        );

        disposables.push(
            channel.on('assessmentStarted', () => {
                dispatch({ type: 'SET_ASSESSMENT_STATE', payload: 'in-progress' });
            }),
        );

        disposables.push(
            channel.on('assessmentProgress', (progress: string) => {
                dispatch({ type: 'SET_ASSESSMENT_PROGRESS', payload: progress });
            }),
        );

        disposables.push(
            channel.on('assessmentCompleted', (result: NonNullable<MigrationState['assessmentResult']>) => {
                dispatch({ type: 'SET_ASSESSMENT_RESULT', payload: result });
            }),
        );

        disposables.push(
            channel.on('assessmentError', (error: string) => {
                dispatch({ type: 'SET_ASSESSMENT_ERROR', payload: error });
            }),
        );

        disposables.push(
            channel.on('assessmentCancelled', () => {
                dispatch({ type: 'SET_ASSESSMENT_STATE', payload: 'available' });
            }),
        );

        disposables.push(
            channel.on('schemaConversionStarted', () => {
                dispatch({ type: 'SET_SCHEMA_CONVERSION_STATE', payload: 'in-progress' });
            }),
        );

        disposables.push(
            channel.on('schemaConversionProgress', (progress: string) => {
                dispatch({ type: 'SET_SCHEMA_CONVERSION_PROGRESS', payload: progress });
            }),
        );

        disposables.push(
            channel.on('schemaConversionCompleted', (result: { domains: string[] }) => {
                dispatch({ type: 'SET_SCHEMA_CONVERSION_RESULT', payload: result });
            }),
        );

        disposables.push(
            channel.on('schemaConversionError', (error: string) => {
                dispatch({ type: 'SET_SCHEMA_CONVERSION_ERROR', payload: error });
            }),
        );

        disposables.push(
            channel.on('schemaConversionCancelled', () => {
                dispatch({ type: 'SET_SCHEMA_CONVERSION_STATE', payload: 'available' });
            }),
        );

        disposables.push(
            channel.on('tokenEstimate', (estimate: { tokens: number; maxTokens: number } | null) => {
                dispatch({ type: 'SET_TOKEN_ESTIMATE', payload: estimate });
            }),
        );

        disposables.push(
            channel.on('connectionTestStarted', () => {
                dispatch({ type: 'SET_CONNECTION_TEST_STATE', payload: 'in-progress' });
            }),
        );

        disposables.push(
            channel.on('connectionTestResult', (result: { success: boolean; error?: string }) => {
                dispatch({ type: 'SET_CONNECTION_VERIFIED', payload: result.success });
                if (!result.success && result.error) {
                    dispatch({ type: 'SET_CONNECTION_TEST_ERROR', payload: result.error });
                }
            }),
        );

        disposables.push(
            channel.on('gitStatus', (hasGit: boolean) => {
                dispatch({ type: 'SET_GIT_STATUS', payload: hasGit });
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
