/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as React from 'react';
import { createContext, useContext, useEffect, useReducer, type Dispatch } from 'react';
import { type Channel } from '../../../../panels/Communication/Channel/Channel';
import { sanitizeCosmosDBAccountName } from '../../../../utils/cosmosDBAccountName';
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
    analysisError: string | null;

    // Phase 1: Discovery Report
    discoveryState: PhaseState;
    discoveryError: string | null;

    // Phase 2: Assessment
    assessmentState: PhaseState;
    assessmentInstructions: string;
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
    schemaConversionError: string | null;
    schemaConversionProgress: string | null;
    schemaConversionInstructions: string;
    includeUnmappedDomains: boolean;
    thoroughAnalysis: boolean;

    // Phase 4: Target Environment
    targetType: 'emulator' | 'azure' | 'provision' | null;
    targetEndpoint: string;
    targetAccountName: string | null;
    targetSubscriptionId: string;
    targetSubscriptionName: string;
    targetResourceGroup: string;
    targetLocation: string;
    accountProvisioningState: PhaseState;
    accountProvisioningProgress: string | null;
    accountProvisioningError: string | null;
    connectionTestState: PhaseState;
    connectionTestError: string | null;
    connectionTestDocumentationUrl: string | null;
    connectionVerified: boolean;

    // Phase 4 (continued): Provisioning
    provisioningState: PhaseState;
    provisioningProgress: string | null;
    provisioningError: string | null;
    provisioningResult: {
        databaseName: string;
        containersCreated: string[];
        seedScriptPath: string;
        warnings: string[];
    } | null;
    hasSampleData: boolean;

    // Phase 4: Bicep export availability (informational artifact, never executed by the extension)
    bicepGenerated: boolean;

    // Git
    hasGitRepo: boolean | null;
    isInGitignore: boolean | null;

    // AI features
    isAIFeaturesEnabled: boolean;

    // Monotonic counter incremented on every file-watcher event (create/change/delete)
    fileStateGeneration: number;

    // Token estimate for context
    tokenEstimate: { minTokens: number; maxTokens: number; modelMaxTokens: number; estimateGeneration: number } | null;

    // Discovery instructions
    discoveryInstructions: string;

    // Additional migration instructions
    migrationInstructions: string;

    // Code migration plan
    hasCodeMigrationPlan: boolean;
    codeMigrationPlanPath: string;
    migrationMode: 'plan' | 'start';

    // Whether Phase 4 (Target Environment) must be completed before migration can start
    isPhase4Required: boolean;
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
    | { type: 'UPDATE_FRAMEWORKS'; payload: string[] }
    | { type: 'SET_DISCOVERY_STATE'; payload: PhaseState }
    | { type: 'SET_DISCOVERY_ERROR'; payload: string }
    | { type: 'SET_ASSESSMENT_INSTRUCTIONS'; payload: string }
    | { type: 'SET_ASSESSMENT_STATE'; payload: PhaseState }
    | {
          type: 'SET_ASSESSMENT_RESULT';
          payload: NonNullable<MigrationState['assessmentResult']>;
      }
    | { type: 'SET_ASSESSMENT_ERROR'; payload: string }
    | { type: 'SET_ASSESSMENT_PROGRESS'; payload: string | null }
    | { type: 'SET_SCHEMA_CONVERSION_STATE'; payload: PhaseState }
    | { type: 'SET_SCHEMA_CONVERSION_RESULT'; payload: NonNullable<MigrationState['schemaConversionResult']> }
    | { type: 'SET_SCHEMA_CONVERSION_ERROR'; payload: string }
    | { type: 'SET_SCHEMA_CONVERSION_PROGRESS'; payload: string | null }
    | { type: 'SET_SCHEMA_CONVERSION_INSTRUCTIONS'; payload: string }
    | { type: 'SET_INCLUDE_UNMAPPED_DOMAINS'; payload: boolean }
    | { type: 'SET_THOROUGH_ANALYSIS'; payload: boolean }
    | { type: 'SET_TARGET_TYPE'; payload: 'emulator' | 'azure' | 'provision' | null }
    | { type: 'SET_TARGET_ENDPOINT'; payload: string }
    | { type: 'SET_TARGET_ACCOUNT_NAME'; payload: string | null }
    | { type: 'SET_TARGET_SUBSCRIPTION'; payload: { id: string; name: string } }
    | { type: 'SET_TARGET_RESOURCE_GROUP'; payload: string }
    | { type: 'SET_TARGET_LOCATION'; payload: string }
    | { type: 'SET_ACCOUNT_PROVISIONING_STATE'; payload: PhaseState }
    | { type: 'SET_ACCOUNT_PROVISIONING_PROGRESS'; payload: string | null }
    | { type: 'SET_ACCOUNT_PROVISIONING_ERROR'; payload: string | null }
    | { type: 'SET_CONNECTION_TEST_STATE'; payload: PhaseState }
    | { type: 'SET_CONNECTION_TEST_ERROR'; payload: string | null }
    | { type: 'SET_CONNECTION_TEST_DOCUMENTATION_URL'; payload: string | null }
    | { type: 'SET_CONNECTION_VERIFIED'; payload: boolean }
    | { type: 'SET_PROVISIONING_STATE'; payload: PhaseState }
    | {
          type: 'SET_PROVISIONING_RESULT';
          payload: NonNullable<MigrationState['provisioningResult']>;
      }
    | { type: 'SET_PROVISIONING_ERROR'; payload: string }
    | { type: 'SET_PROVISIONING_PROGRESS'; payload: string | null }
    | { type: 'SET_GIT_STATUS'; payload: boolean }
    | { type: 'SET_GITIGNORE_STATUS'; payload: boolean }
    | { type: 'SET_AI_FEATURES_ENABLED'; payload: boolean }
    | {
          type: 'SET_TOKEN_ESTIMATE';
          payload: { minTokens: number; maxTokens: number; modelMaxTokens: number; estimateGeneration: number } | null;
      }
    | { type: 'SET_DISCOVERY_INSTRUCTIONS'; payload: string }
    | { type: 'SET_MIGRATION_INSTRUCTIONS'; payload: string }
    | { type: 'SET_MIGRATION_MODE'; payload: 'plan' | 'start' }
    | {
          type: 'SET_FILE_STATE';
          payload: {
              schemaFiles: string[];
              volumetricFiles: string[];
              accessPatternFiles: string[];
              hasVolumetricsTemplate: boolean;
              hasAccessPatternsTemplate: boolean;
              hasDiscoveryReport: boolean;
              hasAssessmentSummary: boolean;
              hasSchemaConversion: boolean;
              hasSampleData: boolean;
              hasBicep: boolean;
              hasCodeMigrationPlan: boolean;
              codeMigrationPlanPath: string;
              fileStateGeneration: number;
          };
      };

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
    hasVolumetricsTemplate: false,
    hasAccessPatternsTemplate: false,
    analysisState: 'locked',
    analysisResult: null,
    analysisError: null,
    discoveryState: 'locked',
    discoveryError: null,
    assessmentState: 'locked',
    assessmentInstructions: '',
    assessmentResult: null,
    assessmentError: null,
    assessmentProgress: null,
    schemaConversionState: 'locked',
    schemaConversionResult: null,
    schemaConversionError: null,
    schemaConversionProgress: null,
    schemaConversionInstructions: '',
    includeUnmappedDomains: false,
    thoroughAnalysis: false,
    targetType: null,
    targetEndpoint: '',
    targetAccountName: null,
    targetSubscriptionId: '',
    targetSubscriptionName: '',
    targetResourceGroup: '',
    targetLocation: 'eastus',
    accountProvisioningState: 'locked',
    accountProvisioningProgress: null,
    accountProvisioningError: null,
    connectionTestState: 'locked',
    connectionTestError: null,
    connectionTestDocumentationUrl: null,
    connectionVerified: false,
    provisioningState: 'locked',
    provisioningProgress: null,
    provisioningError: null,
    provisioningResult: null,
    hasSampleData: false,
    bicepGenerated: false,
    hasGitRepo: null,
    isInGitignore: null,
    isAIFeaturesEnabled: false,
    fileStateGeneration: 0,
    tokenEstimate: null,
    discoveryInstructions: '',
    migrationInstructions: '',
    hasCodeMigrationPlan: false,
    codeMigrationPlanPath: '',
    migrationMode: 'start',
    isPhase4Required: false,
};

function migrationReducer(state: MigrationState, action: MigrationAction): MigrationState {
    switch (action.type) {
        case 'SET_LOADED': {
            // Derive phase states from the payload (disk artifacts) but never overwrite
            // 'in-progress' or 'error' — mirrors the guard used in SET_FILE_STATE.
            const canDerive = (current: PhaseState): boolean => current !== 'in-progress' && current !== 'error';

            return {
                ...state,
                ...action.payload,
                isLoaded: true,
                // Reset transient error by default; preserved below if phase is errored.
                analysisError: null,
                // When a phase is currently running or errored, restore its state fields
                // so that disk-derived values from the payload don't clobber live progress.
                ...(!canDerive(state.analysisState) && {
                    analysisState: state.analysisState,
                    analysisError: state.analysisError,
                }),
                ...(!canDerive(state.discoveryState) && {
                    discoveryState: state.discoveryState,
                    discoveryError: state.discoveryError,
                }),
                ...(!canDerive(state.assessmentState) && {
                    assessmentState: state.assessmentState,
                    assessmentError: state.assessmentError,
                }),
                ...(!canDerive(state.schemaConversionState) && {
                    schemaConversionState: state.schemaConversionState,
                    schemaConversionError: state.schemaConversionError,
                }),
                ...(!canDerive(state.provisioningState) && {
                    provisioningState: state.provisioningState,
                    provisioningProgress: state.provisioningProgress,
                    provisioningError: state.provisioningError,
                    provisioningResult: state.provisioningResult,
                }),
            };
        }
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

        case 'SET_DISCOVERY_STATE':
            return {
                ...state,
                discoveryState: action.payload,
                discoveryError: action.payload === 'error' ? state.discoveryError : null,
            };
        case 'SET_DISCOVERY_ERROR':
            return { ...state, discoveryError: action.payload, discoveryState: 'error' };
        case 'SET_ASSESSMENT_INSTRUCTIONS':
            return { ...state, assessmentInstructions: action.payload };
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
        case 'SET_SCHEMA_CONVERSION_INSTRUCTIONS':
            return { ...state, schemaConversionInstructions: action.payload };
        case 'SET_INCLUDE_UNMAPPED_DOMAINS':
            return { ...state, includeUnmappedDomains: action.payload };
        case 'SET_THOROUGH_ANALYSIS':
            return { ...state, thoroughAnalysis: action.payload };
        case 'SET_TARGET_TYPE':
            return {
                ...state,
                targetType: action.payload,
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
                // "Azure Cosmos DB Account" and "Provision new…" share the endpoint:
                // if one was already captured (e.g. from a prior provisioning), mark the
                // provisioning sub-step as complete so the user sees the endpoint prefilled
                // when switching between these options.
                accountProvisioningState: state.targetEndpoint ? 'complete' : 'available',
                accountProvisioningProgress: null,
                accountProvisioningError: null,
            };
        case 'SET_TARGET_ENDPOINT':
            return { ...state, targetEndpoint: action.payload };
        case 'SET_TARGET_ACCOUNT_NAME':
            return { ...state, targetAccountName: action.payload };
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
        case 'SET_ACCOUNT_PROVISIONING_STATE':
            return { ...state, accountProvisioningState: action.payload };
        case 'SET_ACCOUNT_PROVISIONING_PROGRESS':
            return { ...state, accountProvisioningProgress: action.payload };
        case 'SET_ACCOUNT_PROVISIONING_ERROR':
            return { ...state, accountProvisioningError: action.payload };
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
        case 'SET_PROVISIONING_STATE':
            return {
                ...state,
                provisioningState: action.payload,
                provisioningError: action.payload === 'error' ? state.provisioningError : null,
                provisioningProgress: null,
            };
        case 'SET_PROVISIONING_RESULT':
            return {
                ...state,
                provisioningResult: action.payload,
                provisioningState: 'complete',
                provisioningProgress: null,
                hasSampleData: true,
            };
        case 'SET_PROVISIONING_ERROR':
            return {
                ...state,
                provisioningError: action.payload,
                provisioningState: 'error',
                provisioningProgress: null,
            };
        case 'SET_PROVISIONING_PROGRESS':
            return { ...state, provisioningProgress: action.payload };
        case 'SET_GIT_STATUS':
            return { ...state, hasGitRepo: action.payload };
        case 'SET_GITIGNORE_STATUS':
            return { ...state, isInGitignore: action.payload };
        case 'SET_AI_FEATURES_ENABLED':
            return { ...state, isAIFeaturesEnabled: action.payload };
        case 'SET_TOKEN_ESTIMATE':
            return { ...state, tokenEstimate: action.payload };
        case 'SET_DISCOVERY_INSTRUCTIONS':
            return { ...state, discoveryInstructions: action.payload };
        case 'SET_MIGRATION_INSTRUCTIONS':
            return { ...state, migrationInstructions: action.payload };
        case 'SET_MIGRATION_MODE':
            return { ...state, migrationMode: action.payload };
        case 'SET_FILE_STATE': {
            const p = action.payload;

            // Derive phase states from disk artifacts.
            // Never overwrite 'in-progress' or 'error' — only update 'locked'/'available'/'complete'.
            const canDerive = (current: PhaseState): boolean => current !== 'in-progress' && current !== 'error';

            const discoveryState = canDerive(state.discoveryState)
                ? p.hasDiscoveryReport
                    ? 'complete'
                    : 'available'
                : state.discoveryState;

            const discoveryComplete = discoveryState === 'complete';

            const assessmentState = canDerive(state.assessmentState)
                ? p.hasAssessmentSummary
                    ? 'complete'
                    : discoveryComplete
                      ? 'available'
                      : 'locked'
                : state.assessmentState;

            const assessmentComplete = assessmentState === 'complete';

            const schemaConversionState = canDerive(state.schemaConversionState)
                ? p.hasSchemaConversion
                    ? 'complete'
                    : assessmentComplete
                      ? 'available'
                      : 'locked'
                : state.schemaConversionState;

            const provisioningState = canDerive(state.provisioningState)
                ? p.hasSampleData
                    ? 'complete'
                    : 'locked'
                : state.provisioningState;

            return {
                ...state,
                schemaFiles: p.schemaFiles,
                volumetricFiles: p.volumetricFiles,
                accessPatternFiles: p.accessPatternFiles,
                hasVolumetricsTemplate: p.hasVolumetricsTemplate,
                hasAccessPatternsTemplate: p.hasAccessPatternsTemplate,
                hasSampleData: p.hasSampleData,
                bicepGenerated: p.hasBicep,
                hasCodeMigrationPlan: p.hasCodeMigrationPlan,
                codeMigrationPlanPath: p.codeMigrationPlanPath,
                fileStateGeneration: p.fileStateGeneration,
                discoveryState,
                assessmentState,
                schemaConversionState,
                provisioningState,
            };
        }
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
                    project: {
                        name: string;
                        migrationInstructions?: string;
                        migrationMode?: 'plan' | 'start';
                        phases: {
                            discovery: Record<string, unknown>;
                            assessment?: Record<string, unknown>;
                            schemaConversion?: Record<string, unknown>;
                            targetEnvironment?: Record<string, unknown>;
                        };
                    };
                    workspacePath: string;
                    schemaFiles: string[];
                    volumetricFiles: string[];
                    accessPatternFiles: string[];
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
                    isPhase4Required: boolean;
                }) => {
                    const discovery = data.project.phases.discovery;
                    const assessment = data.project.phases.assessment;
                    const analysis = discovery.applicationAnalysis as MigrationState['analysisResult'] | undefined;
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

                    // Phase 1 is complete when schema files exist AND discovery-report.md exists
                    const assessmentComplete = data.hasAssessmentSummary;
                    const schemaConversionComplete = data.hasSchemaConversion;

                    // Initialize analysisResult with projectName from top-level if not already set
                    const effectiveAnalysis = analysis ?? { projectName: data.project.name };
                    if (!effectiveAnalysis.projectName) {
                        effectiveAnalysis.projectName = data.project.name;
                    }

                    // Discovery report state is independent of analysis (auto-detect) state
                    const hasAnalysis = !!analysis;
                    const discoveryComplete = data.hasDiscoveryReport;

                    dispatch({
                        type: 'SET_LOADED',
                        payload: {
                            workspacePath: data.workspacePath,
                            projectName: data.project.name,
                            schemaFiles: data.schemaFiles,
                            volumetricFiles: data.volumetricFiles,
                            accessPatternFiles: data.accessPatternFiles,
                            hasVolumetricsTemplate: data.hasVolumetricsTemplate,
                            hasAccessPatternsTemplate: data.hasAccessPatternsTemplate,
                            analysisResult: effectiveAnalysis,
                            analysisState: hasAnalysis ? 'complete' : 'available',
                            discoveryState: discoveryComplete ? 'complete' : 'available',
                            discoveryError: null,
                            assessmentState: assessmentComplete
                                ? 'complete'
                                : discoveryComplete
                                  ? 'available'
                                  : 'locked',
                            assessmentInstructions:
                                ((assessment as Record<string, unknown> | undefined)
                                    ?.assessmentInstructions as string) ?? '',
                            assessmentResult: data.assessmentResult ?? null,
                            assessmentError: null,
                            schemaConversionState: schemaConversionComplete
                                ? 'complete'
                                : assessmentComplete
                                  ? 'available'
                                  : 'locked',
                            schemaConversionResult: data.schemaConversionResult ?? null,
                            schemaConversionInstructions:
                                ((data.project.phases.schemaConversion as Record<string, unknown> | undefined)
                                    ?.schemaConversionInstructions as string) ?? '',
                            schemaConversionError: null,
                            targetType: target?.type ?? null,
                            targetEndpoint: target?.endpoint ?? '',
                            targetAccountName:
                                target?.accountName ?? sanitizeCosmosDBAccountName(data.project.name) ?? null,
                            targetSubscriptionId: target?.subscriptionId ?? '',
                            targetSubscriptionName: target?.subscriptionName ?? '',
                            targetResourceGroup: target?.resourceGroup ?? '',
                            targetLocation: target?.location ?? 'eastus',
                            accountProvisioningState: target?.endpoint ? 'complete' : 'available',
                            accountProvisioningProgress: null,
                            accountProvisioningError: null,
                            connectionVerified: target?.verified ?? false,
                            connectionTestState: target?.verified
                                ? 'complete'
                                : discoveryComplete
                                  ? 'available'
                                  : 'locked',
                            provisioningState: data.hasSampleData ? 'complete' : 'locked',
                            provisioningProgress: null,
                            provisioningError: null,
                            provisioningResult: null,
                            hasSampleData: data.hasSampleData,
                            bicepGenerated: data.hasBicep,
                            isAIFeaturesEnabled: data.isAIFeaturesEnabled,
                            consentGiven: data.consentGiven,
                            discoveryInstructions:
                                ((discovery as Record<string, unknown>).discoveryInstructions as string) ?? '',
                            migrationInstructions: data.project.migrationInstructions ?? '',
                            hasCodeMigrationPlan: data.hasCodeMigrationPlan,
                            codeMigrationPlanPath: data.codeMigrationPlanPath,
                            // Respect the user's persisted choice if set; otherwise default based on whether
                            // the plan file exists ('start' if present, 'plan' if not).
                            migrationMode: data.project.migrationMode ?? (data.hasCodeMigrationPlan ? 'start' : 'plan'),
                            isPhase4Required: data.isPhase4Required,
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
                }) => {
                    dispatch({
                        type: 'SET_TARGET_SUBSCRIPTION',
                        payload: { id: data.subscriptionId, name: data.subscriptionName },
                    });
                    dispatch({ type: 'SET_TARGET_RESOURCE_GROUP', payload: data.resourceGroup });
                    dispatch({ type: 'SET_TARGET_LOCATION', payload: data.location });
                },
            ),
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
            channel.on('discoveryStarted', () => {
                dispatch({ type: 'SET_DISCOVERY_STATE', payload: 'in-progress' });
            }),
        );

        disposables.push(
            channel.on('discoveryCompleted', () => {
                dispatch({ type: 'SET_DISCOVERY_STATE', payload: 'complete' });
            }),
        );

        disposables.push(
            channel.on('discoveryError', (error: string) => {
                dispatch({ type: 'SET_DISCOVERY_ERROR', payload: error });
            }),
        );

        disposables.push(
            channel.on('discoveryCancelled', () => {
                dispatch({ type: 'SET_DISCOVERY_STATE', payload: 'available' });
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
            channel.on('schemaConversionCompleted', (result: NonNullable<MigrationState['schemaConversionResult']>) => {
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
            channel.on(
                'tokenEstimate',
                (
                    estimate: {
                        minTokens: number;
                        maxTokens: number;
                        modelMaxTokens: number;
                        estimateGeneration: number;
                    } | null,
                ) => {
                    dispatch({ type: 'SET_TOKEN_ESTIMATE', payload: estimate });
                },
            ),
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
            channel.on('provisioningStarted', () => {
                dispatch({ type: 'SET_PROVISIONING_STATE', payload: 'in-progress' });
            }),
        );

        disposables.push(
            channel.on('provisioningProgress', (progress: string) => {
                dispatch({ type: 'SET_PROVISIONING_PROGRESS', payload: progress });
            }),
        );

        disposables.push(
            channel.on('provisioningCompleted', (result: NonNullable<MigrationState['provisioningResult']>) => {
                dispatch({ type: 'SET_PROVISIONING_RESULT', payload: result });
            }),
        );

        disposables.push(
            channel.on('provisioningError', (error: string) => {
                dispatch({ type: 'SET_PROVISIONING_ERROR', payload: error });
            }),
        );

        disposables.push(
            channel.on('accountProvisioningStarted', () => {
                dispatch({ type: 'SET_ACCOUNT_PROVISIONING_STATE', payload: 'in-progress' });
                dispatch({ type: 'SET_ACCOUNT_PROVISIONING_ERROR', payload: null });
            }),
        );

        disposables.push(
            channel.on('accountProvisioningProgress', (message: string) => {
                dispatch({ type: 'SET_ACCOUNT_PROVISIONING_PROGRESS', payload: message });
            }),
        );

        disposables.push(
            channel.on('accountProvisioningCompleted', (result: { endpoint: string }) => {
                dispatch({ type: 'SET_ACCOUNT_PROVISIONING_STATE', payload: 'complete' });
                dispatch({ type: 'SET_TARGET_ENDPOINT', payload: result.endpoint });
            }),
        );

        disposables.push(
            channel.on('accountProvisioningError', (error: string) => {
                dispatch({ type: 'SET_ACCOUNT_PROVISIONING_STATE', payload: 'available' });
                dispatch({ type: 'SET_ACCOUNT_PROVISIONING_ERROR', payload: error });
            }),
        );

        disposables.push(
            channel.on('accountProvisioningCancelled', () => {
                dispatch({ type: 'SET_ACCOUNT_PROVISIONING_STATE', payload: 'available' });
            }),
        );

        disposables.push(
            channel.on('provisioningCancelled', () => {
                dispatch({ type: 'SET_PROVISIONING_STATE', payload: 'available' });
            }),
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

        disposables.push(
            channel.on(
                'filesChanged',
                (data: {
                    schemaFiles: string[];
                    volumetricFiles: string[];
                    accessPatternFiles: string[];
                    hasVolumetricsTemplate: boolean;
                    hasAccessPatternsTemplate: boolean;
                    hasDiscoveryReport: boolean;
                    hasAssessmentSummary: boolean;
                    hasSchemaConversion: boolean;
                    hasSampleData: boolean;
                    hasBicep: boolean;
                    hasCodeMigrationPlan: boolean;
                    codeMigrationPlanPath: string;
                    fileStateGeneration: number;
                }) => {
                    dispatch({ type: 'SET_FILE_STATE', payload: data });
                },
            ),
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
