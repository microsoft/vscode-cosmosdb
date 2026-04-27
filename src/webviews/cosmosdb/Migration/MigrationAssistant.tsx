/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Button,
    Checkbox,
    Dropdown,
    Field,
    Input,
    Label,
    Link,
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Option,
    OptionGroup,
    ProgressBar,
    Radio,
    RadioGroup,
    SplitButton,
    Text,
    Textarea,
    Tooltip,
    type MenuButtonProps,
    type OptionOnSelectData,
} from '@fluentui/react-components';
import {
    CheckmarkCircleFilled,
    ChevronDownRegular,
    ChevronRightRegular,
    CircleRegular,
    CloudAddRegular,
    DatabaseRegular,
    DismissCircleRegular,
    DocumentRegular,
    ErrorCircleFilled,
    InfoRegular,
    LockClosedRegular,
    PlayRegular,
    PlugConnectedRegular,
    SparkleRegular,
    StopRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useContext, useEffect, useMemo, useState, type ReactElement } from 'react';
import { sanitizeCosmosDBAccountName, validateCosmosDBAccountName } from '../../../utils/cosmosDBAccountName';
import { formatTokenCount, partitionModelsByCapability } from '../../../utils/modelUtils';
import { CosmosDBIcon } from '../../icons/CosmosDBIcon';
import { WebviewContext } from '../../WebviewContext';
import {
    useMigrationDispatch,
    useMigrationState,
    WithMigrationContext,
    type ModelInfo,
    type PhaseState,
} from './state/MigrationContext';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'auto',
        padding: '12px',
        paddingBottom: '52px',
        gap: '10px',
        boxSizing: 'border-box',
    },
    configSection: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        borderRadius: '6px',
        border: '1px solid var(--vscode-panel-border)',
        backgroundColor: 'var(--vscode-editor-background)',
    },
    configRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
    },
    buttonRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
    },
    stepContent: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '4px 0 4px 24px',
    },
    detailsColumns: {
        display: 'flex',
        gap: '24px',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
    },
    analysisPanel: {
        flex: '1 1 280px',
        minWidth: '0',
    },
    filePickerGrid: {
        display: 'grid',
        gridTemplateColumns: 'max-content max-content max-content',
        gap: '6px 8px',
        alignItems: 'center',
        flex: '0 0 auto',
    },
    filePickerExpanderRow: {
        gridColumn: '1 / -1',
    },
    fileList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        paddingLeft: '6px',
        fontSize: '12px',
        color: 'var(--vscode-descriptionForeground)',
    },
    fileLink: {
        fontSize: '12px',
        cursor: 'pointer',
        display: 'block',
        paddingLeft: '8px',
    },
    fileExpander: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        cursor: 'pointer',
        fontSize: '12px',
        color: 'var(--vscode-descriptionForeground)',
        userSelect: 'none',
    },
    infoIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        verticalAlign: 'middle',
        marginLeft: '4px',
        fontSize: '16px',
        color: 'var(--vscode-foreground)',
        background: 'none',
        border: 'none',
        padding: '0',
        borderRadius: '4px',
        outline: 'none',
        '&:focus-visible': {
            outlineWidth: '2px',
            outlineStyle: 'solid',
            outlineColor: 'var(--vscode-focusBorder)',
            outlineOffset: '1px',
        },
    },
    analysisResult: {
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '6px 8px',
        alignItems: 'center',
        fontSize: '12px',
    },
    analysisValue: {
        color: 'var(--vscode-descriptionForeground)',
    },
    footer: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderTop: '1px solid var(--vscode-panel-border)',
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'var(--vscode-editor-background)',
        zIndex: 1,
    },
    footerRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    completedContent: {
        opacity: 0.8,
    },
    phaseInputs: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    progressRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    sectionDivider: {
        borderTop: '1px solid var(--vscode-panel-border)',
        paddingTop: '8px',
        marginTop: '2px',
    },
    phaseDivider: {
        borderTop: '1px solid var(--vscode-panel-border)',
    },
    errorText: {
        color: 'var(--vscode-errorForeground)',
        fontSize: '12px',
    },
    warningText: {
        color: 'var(--vscode-editorWarning-foreground)',
        fontSize: '12px',
    },
    tokenBudgetContainer: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    tokenBudgetTrack: {
        position: 'relative',
        width: '120px',
        height: '6px',
        borderRadius: '3px',
        backgroundColor: 'var(--vscode-panel-border)',
        flexShrink: '0',
        overflow: 'hidden',
    },
    tokenBudgetFill: {
        position: 'absolute',
        top: '0',
        left: '0',
        height: '100%',
        borderRadius: '3px',
        transitionProperty: 'width, background-color',
        transitionDuration: '0.3s',
        transitionTimingFunction: 'ease',
    },
    tokenBudgetFillAnimating: {
        animationName: {
            '0%': { opacity: '1' },
            '50%': { opacity: '0.35' },
            '100%': { opacity: '1' },
        },
        animationDuration: '1.5s',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
    },
});

function TokenBudgetBar({
    estimate,
    isEstimating,
}: {
    estimate: { minTokens: number; maxTokens: number; modelMaxTokens: number } | null;
    isEstimating: boolean;
}) {
    const styles = useStyles();

    if (!isEstimating && !estimate) return null;

    const fillPercent = estimate ? Math.min(estimate.minTokens / estimate.modelMaxTokens, 1) * 100 : 0;

    let barColor: string;
    let textColor: string;
    if (!estimate) {
        barColor = 'var(--vscode-descriptionForeground)';
        textColor = 'var(--vscode-descriptionForeground)';
    } else if (estimate.minTokens > estimate.modelMaxTokens) {
        barColor = 'var(--vscode-errorForeground)';
        textColor = 'var(--vscode-errorForeground)';
    } else if (estimate.minTokens >= estimate.modelMaxTokens * 0.75 || estimate.maxTokens > estimate.modelMaxTokens) {
        barColor = 'var(--vscode-editorWarning-foreground)';
        textColor = 'var(--vscode-editorWarning-foreground)';
    } else {
        barColor = 'var(--vscode-testing-iconPassed)';
        textColor = 'var(--vscode-descriptionForeground)';
    }

    const tokenText = estimate
        ? l10n.t(
              '~{0}\u2013{1} / {2} tokens',
              formatTokenCount(estimate.minTokens),
              formatTokenCount(estimate.maxTokens),
              formatTokenCount(estimate.modelMaxTokens),
          )
        : l10n.t('Estimating tokens\u2026');

    return (
        <div className={styles.tokenBudgetContainer}>
            <div className={styles.tokenBudgetTrack}>
                <div
                    className={
                        isEstimating
                            ? `${styles.tokenBudgetFill} ${styles.tokenBudgetFillAnimating}`
                            : styles.tokenBudgetFill
                    }
                    style={{ width: `${fillPercent}%`, backgroundColor: barColor }}
                />
            </div>
            <Text
                size={200}
                style={{
                    color: textColor,
                    opacity: isEstimating ? 0.6 : 1,
                    transition: 'opacity 0.3s',
                }}
            >
                {tokenText}
            </Text>
        </div>
    );
}

function FileListExpander({
    files,
    onOpenFile,
    styles,
}: {
    files: string[];
    onOpenFile: (filePath: string) => void;
    styles: ReturnType<typeof useStyles>;
}) {
    const [expanded, setExpanded] = useState(false);
    if (files.length === 0) return null;

    return (
        <div>
            <div
                className={styles.fileExpander}
                onClick={() => setExpanded(!expanded)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded);
                }}
            >
                {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
                <Text size={200}>{l10n.t('{count} file(s) selected', { count: files.length })}</Text>
            </div>
            {expanded && (
                <div className={styles.fileList}>
                    {files.map((f: string, i: number) => (
                        <Link key={i} className={styles.fileLink} onClick={() => onOpenFile(f)}>
                            {f.split('/').pop() ?? f}
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}

function InfoTooltipIcon({
    content,
    ariaLabel,
    styles,
}: {
    content: string;
    ariaLabel: string;
    styles: ReturnType<typeof useStyles>;
}) {
    return (
        <Tooltip content={content} relationship="description" withArrow>
            <button type="button" aria-label={ariaLabel} className={styles.infoIcon}>
                <InfoRegular />
            </button>
        </Tooltip>
    );
}

function getPhaseIcon(state: PhaseState) {
    let icon: ReactElement;
    let label: string;
    switch (state) {
        case 'locked':
            icon = <LockClosedRegular />;
            label = l10n.t('Locked');
            break;
        case 'available':
            icon = <CircleRegular />;
            label = l10n.t('Available');
            break;
        case 'in-progress':
            icon = <PlayRegular />;
            label = l10n.t('In progress');
            break;
        case 'complete':
            icon = <CheckmarkCircleFilled style={{ color: 'var(--vscode-testing-iconPassed)' }} />;
            label = l10n.t('Complete');
            break;
        case 'error':
            icon = <ErrorCircleFilled style={{ color: 'var(--vscode-errorForeground)' }} />;
            label = l10n.t('Error');
            break;
    }
    return (
        <span role="img" aria-label={label} style={{ display: 'inline-flex' }}>
            {icon}
        </span>
    );
}

function MigrationAssistantInner() {
    const styles = useStyles();
    const { channel } = useContext(WebviewContext);
    const state = useMigrationState();
    const dispatch = useMigrationDispatch();

    // Load project on mount
    useEffect(() => {
        void channel.postMessage({
            type: 'event',
            name: 'command',
            params: [{ commandName: 'loadProject', params: [] }],
        });
        void channel.postMessage({
            type: 'event',
            name: 'command',
            params: [{ commandName: 'getAvailableModels', params: [] }],
        });
        void channel.postMessage({
            type: 'event',
            name: 'command',
            params: [{ commandName: 'checkGitRepository', params: [] }],
        });
    }, [channel]);

    const sendCommand = useCallback(
        (commandName: string, ...params: unknown[]) => {
            void channel.postMessage({
                type: 'event',
                name: 'command',
                params: [{ commandName, params }],
            });
        },
        [channel],
    );

    // Derived phase states
    const phase1State: PhaseState = state.discoveryState;
    const phase2State: PhaseState = state.assessmentState;
    const phase3State: PhaseState = state.schemaConversionState;
    const phase4State: PhaseState =
        state.provisioningState === 'complete'
            ? 'complete'
            : state.connectionTestState === 'complete'
              ? state.provisioningState === 'locked'
                  ? 'available'
                  : state.provisioningState
              : state.connectionTestState;

    const allComplete =
        phase1State === 'complete' &&
        phase2State === 'complete' &&
        phase3State === 'complete' &&
        (!state.isPhase4Required || phase4State === 'complete') &&
        state.consentGiven;
    const hasAllAnalysisFields = !!(
        state.analysisResult &&
        state.analysisResult.projectName?.trim() &&
        state.analysisResult.projectType?.trim() &&
        state.analysisResult.language?.trim() &&
        state.analysisResult.frameworks?.length &&
        state.analysisResult.databaseType?.trim() &&
        state.analysisResult.databaseAccess?.trim()
    );
    const isDiscoveryDisabled =
        !hasAllAnalysisFields || state.schemaFiles.length === 0 || !state.consentGiven || !state.isAIFeaturesEnabled;
    const isPhase2Disabled = phase1State !== 'complete' || !hasAllAnalysisFields;
    const isPhase3Disabled = phase2State !== 'complete';
    const isPhase4Disabled = phase1State !== 'complete' || !hasAllAnalysisFields;

    // isEstimating: a request was sent for the current fileStateGeneration but the estimate hasn't caught up yet
    const isEstimating =
        state.isLoaded &&
        state.schemaFiles.length > 0 &&
        state.fileStateGeneration !== (state.tokenEstimate?.estimateGeneration ?? -1);

    // Request token estimation whenever schema/access-pattern/volumetric files or model change
    useEffect(() => {
        if (state.isLoaded && state.schemaFiles.length > 0) {
            sendCommand('estimateContextTokens');
        }
    }, [
        state.isLoaded,
        state.schemaFiles.length,
        state.accessPatternFiles.length,
        state.volumetricFiles.length,
        state.fileStateGeneration,
        state.selectedModelId,
        sendCommand,
    ]);

    // Handlers
    const handleProjectNameChange = useCallback(
        (value: string) => {
            dispatch({ type: 'SET_PROJECT_NAME', payload: value });
            sendCommand('updateProjectName', value);
        },
        [dispatch, sendCommand],
    );

    const handleModelChange = useCallback(
        (_e: unknown, data: OptionOnSelectData) => {
            const modelId = data.optionValue as string;
            dispatch({ type: 'SET_SELECTED_MODEL', payload: modelId });
            sendCommand('setSelectedModel', modelId);
            sendCommand('estimateContextTokens');
        },
        [dispatch, sendCommand],
    );

    const handleConsentChange = useCallback(
        (_e: unknown, data: { checked: boolean | 'mixed' }) => {
            const consent = data.checked === true;
            dispatch({ type: 'SET_CONSENT', payload: consent });
            sendCommand('updateConsent', consent);
        },
        [dispatch, sendCommand],
    );

    const handleSelectSchemaFiles = useCallback(() => sendCommand('selectSchemaFiles'), [sendCommand]);
    const handleSelectSchemaFolder = useCallback(() => sendCommand('selectSchemaFolder'), [sendCommand]);
    const handleSelectVolumetricFiles = useCallback(() => sendCommand('selectVolumetricFiles'), [sendCommand]);
    const handleSelectVolumetricFolder = useCallback(() => sendCommand('selectVolumetricFolder'), [sendCommand]);
    const handleSelectAccessPatternFiles = useCallback(() => sendCommand('selectAccessPatternFiles'), [sendCommand]);
    const handleSelectAccessPatternFolder = useCallback(() => sendCommand('selectAccessPatternFolder'), [sendCommand]);
    const handleOpenVolumetricsTemplate = useCallback(() => sendCommand('openVolumetricsTemplate'), [sendCommand]);
    const handleOpenAccessPatternsTemplate = useCallback(
        () => sendCommand('openAccessPatternsTemplate'),
        [sendCommand],
    );
    const handleAnalyzeVolumetrics = useCallback(() => sendCommand('analyzeVolumetrics'), [sendCommand]);
    const handleAnalyzeAccessPatterns = useCallback(() => sendCommand('analyzeAccessPatterns'), [sendCommand]);

    const handleAnalyze = useCallback(() => sendCommand('analyzeApplication'), [sendCommand]);
    const handleCancelAnalysis = useCallback(() => sendCommand('cancelAnalysis'), [sendCommand]);
    const handleRunDiscovery = useCallback(() => sendCommand('runDiscovery'), [sendCommand]);
    const handleCancelDiscovery = useCallback(() => sendCommand('cancelDiscovery'), [sendCommand]);
    const handleDiscoveryInstructionsChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            dispatch({ type: 'SET_DISCOVERY_INSTRUCTIONS', payload: data.value });
            sendCommand('updateDiscoveryInstructions', data.value);
        },
        [dispatch, sendCommand],
    );

    const handleAssessmentInstructionsChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            dispatch({ type: 'SET_ASSESSMENT_INSTRUCTIONS', payload: data.value });
            sendCommand('updateAssessmentInstructions', data.value);
        },
        [dispatch, sendCommand],
    );

    const handleSchemaConversionInstructionsChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            dispatch({ type: 'SET_SCHEMA_CONVERSION_INSTRUCTIONS', payload: data.value });
            sendCommand('updateSchemaConversionInstructions', data.value);
        },
        [dispatch, sendCommand],
    );

    const handleAnalysisFieldChange = useCallback(
        (field: string, value: string) => {
            dispatch({ type: 'UPDATE_ANALYSIS_FIELD', payload: { field, value } });
            sendCommand('updateAnalysisResult', { [field]: value });
        },
        [dispatch, sendCommand],
    );

    const handleRunAssessment = useCallback(() => sendCommand('runAssessment'), [sendCommand]);

    const handleFrameworksChange = useCallback(
        (value: string) => {
            const parsed = value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            // Frameworks is a required field — default to ['N/A'] when empty so
            // projects that legitimately use none can still proceed.
            const frameworks = parsed.length > 0 ? parsed : ['N/A'];
            dispatch({ type: 'UPDATE_FRAMEWORKS', payload: frameworks });
            sendCommand('updateAnalysisResult', { frameworks });
        },
        [dispatch, sendCommand],
    );

    const handleCancelAssessment = useCallback(() => sendCommand('cancelAssessment'), [sendCommand]);
    const handleRunSchemaConversion = useCallback(
        () => sendCommand('runSchemaConversion', state.includeUnmappedDomains, state.thoroughAnalysis),
        [sendCommand, state.includeUnmappedDomains, state.thoroughAnalysis],
    );
    const handleCancelSchemaConversion = useCallback(() => sendCommand('cancelSchemaConversion'), [sendCommand]);
    const handleIncludeUnmappedDomainsChange = useCallback(
        (_e: unknown, data: { checked: boolean | 'mixed' }) => {
            dispatch({ type: 'SET_INCLUDE_UNMAPPED_DOMAINS', payload: data.checked === true });
        },
        [dispatch],
    );

    const handleThoroughAnalysisChange = useCallback(
        (_e: unknown, data: { checked: boolean | 'mixed' }) => {
            dispatch({ type: 'SET_THOROUGH_ANALYSIS', payload: data.checked === true });
        },
        [dispatch],
    );

    const handleTargetTypeChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            const targetType = data.value as 'emulator' | 'azure' | 'provision';
            dispatch({ type: 'SET_TARGET_TYPE', payload: targetType });
            // Persist the type. Other fields (endpoint, resource group, account name,
            // location) are preserved server-side via merge, so switching between
            // "Azure Cosmos DB Account" and "Provision new…" retains the previously
            // captured values (e.g. a newly provisioned endpoint is prefilled for the
            // existing-account option).
            //
            // Special-case `provision`: the reducer defaults `targetAccountName` to a
            // sanitized project-name-based suggestion when switching in for the first
            // time. Mirror that default to the backend so the next `provisionAccount`
            // call has an account name to work with even if the user never edited the
            // field.
            const accountName =
                targetType === 'provision'
                    ? (state.targetAccountName ?? sanitizeCosmosDBAccountName(state.projectName) ?? undefined)
                    : undefined;
            sendCommand('setTargetEnvironment', targetType, undefined, undefined, accountName);
        },
        [dispatch, sendCommand, state.targetAccountName, state.projectName],
    );

    const handleEndpointChange = useCallback(
        (value: string) => {
            dispatch({ type: 'SET_TARGET_ENDPOINT', payload: value });
            // Persist the endpoint into project.json. `setTargetEnvironment` merges
            // undefined fields, so resource group / account name / location are not
            // clobbered when the user edits only the endpoint.
            sendCommand('setTargetEnvironment', state.targetType, value);
        },
        [dispatch, sendCommand, state.targetType],
    );

    const handleTestConnection = useCallback(
        () => sendCommand('testConnection', state.targetType, state.targetEndpoint),
        [sendCommand, state.targetType, state.targetEndpoint],
    );

    const handleSelectAccount = useCallback(() => sendCommand('selectAccount'), [sendCommand]);

    const handlePopulateSampleData = useCallback(() => sendCommand('populateSampleData'), [sendCommand]);

    const handleProvisionAccount = useCallback(() => sendCommand('provisionAccount'), [sendCommand]);

    const handleSelectResourceGroup = useCallback(() => sendCommand('selectResourceGroup'), [sendCommand]);

    const handleLocationChange = useCallback(
        (_e: unknown, data: OptionOnSelectData) => {
            const location = data.optionValue;
            if (!location) return;
            dispatch({ type: 'SET_TARGET_LOCATION', payload: location });
            sendCommand('setTargetLocation', location);
        },
        [dispatch, sendCommand],
    );

    const handleAccountNameChange = useCallback(
        (value: string) => {
            dispatch({ type: 'SET_TARGET_ACCOUNT_NAME', payload: value });
            // Persist just the account name; other provision-mode fields are preserved
            // on the backend via merge so they are not overwritten with stale values.
            sendCommand('setTargetEnvironment', 'provision', undefined, undefined, value);
        },
        [dispatch, sendCommand],
    );

    const handleCancelProvisioning = useCallback(() => sendCommand('cancelProvisioning'), [sendCommand]);

    const handleCancelAccountProvisioning = useCallback(() => sendCommand('cancelAccountProvisioning'), [sendCommand]);

    // Validate the target account name against the Cosmos DB account-name rules.
    // Only surfaced while in 'provision' mode — for existing-account flows the name
    // comes from a picker and is always valid.
    const accountNameValidationError = useMemo(
        () =>
            state.targetType === 'provision' && state.targetAccountName
                ? validateCosmosDBAccountName(state.targetAccountName)
                : undefined,
        [state.targetType, state.targetAccountName],
    );

    const handleReset = useCallback(() => sendCommand('resetProject'), [sendCommand]);
    const handleStartMigration = useCallback(
        () => sendCommand(state.migrationMode === 'plan' ? 'planMigration' : 'startMigration'),
        [sendCommand, state.migrationMode],
    );
    const handleSetMigrationMode = useCallback(
        (mode: 'plan' | 'start') => {
            dispatch({ type: 'SET_MIGRATION_MODE', payload: mode });
            sendCommand('setMigrationMode', mode);
        },
        [dispatch, sendCommand],
    );
    const handleMigrationInstructionsChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            dispatch({ type: 'SET_MIGRATION_INSTRUCTIONS', payload: data.value });
            sendCommand('updateMigrationInstructions', data.value);
        },
        [dispatch, sendCommand],
    );

    const handleInitGit = useCallback(() => sendCommand('initGitRepository'), [sendCommand]);
    const handleAddToGitignore = useCallback(() => sendCommand('addToGitignore'), [sendCommand]);
    const handleRemoveFromGitignore = useCallback(() => sendCommand('removeFromGitignore'), [sendCommand]);

    const handleOpenFile = useCallback((filePath: string) => sendCommand('openFile', filePath), [sendCommand]);
    const handleOpenGeneratedBicep = useCallback(() => sendCommand('openGeneratedBicep'), [sendCommand]);
    const handlePreviewMarkdown = useCallback(
        (filePath: string) => sendCommand('previewMarkdown', filePath),
        [sendCommand],
    );

    const isFirstVisit = useMemo(
        () => phase1State !== 'complete' && phase2State !== 'complete',
        [phase1State, phase2State],
    );
    const [descriptionExpanded, setDescriptionExpanded] = useState(false);

    if (!state.isLoaded) {
        return (
            <div className={styles.root}>
                <ProgressBar />
            </div>
        );
    }

    const selectedModel =
        state.availableModels.find((m: ModelInfo) => m.id === state.selectedModelId) ?? state.availableModels[0];

    return (
        <div className={styles.root}>
            {/* Configuration Section */}
            <div className={styles.configSection}>
                <Text size={400} weight="semibold">
                    {l10n.t('Migration Configuration')}
                </Text>
                {isFirstVisit || descriptionExpanded ? (
                    <Text size={200}>
                        {l10n.t(
                            'Migrate your application from a relational database (RDBMS) to Azure Cosmos DB NoSQL with AI-assisted analysis. Follow the phases below to inventory your schema, analyze your application, and configure your target environment.',
                        )}
                    </Text>
                ) : (
                    <Text size={200} style={{ color: 'var(--vscode-descriptionForeground)' }}>
                        {l10n.t('RDBMS → Cosmos DB NoSQL migration assistant.')}{' '}
                        <Link
                            style={{ fontSize: '12px' }}
                            aria-label={l10n.t('Show full migration assistant description')}
                            onClick={() => setDescriptionExpanded(true)}
                        >
                            {l10n.t('More…')}
                        </Link>
                    </Text>
                )}

                <Field label={l10n.t('Workspace')}>
                    <Text size={200}>{state.workspacePath}</Text>
                </Field>

                <Field
                    label={
                        <>
                            {l10n.t('Project Name')} <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                        </>
                    }
                >
                    <Input
                        value={state.projectName}
                        onChange={(_e, data) => handleProjectNameChange(data.value)}
                        placeholder={l10n.t('Enter a project name')}
                    />
                </Field>

                {state.hasGitRepo === true && state.isInGitignore !== null && (
                    <Checkbox
                        checked={state.isInGitignore === true}
                        onChange={(_e, data) => {
                            if (data.checked === true) {
                                handleAddToGitignore();
                            } else {
                                handleRemoveFromGitignore();
                            }
                        }}
                        label={
                            <>
                                {l10n.t('Exclude migration configuration from version control')}
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'Tracking migration progress in Git is recommended. Only exclude the .cosmosdb-migration folder if you prefer not to commit AI-generated migration artifacts to your repository.',
                                    )}
                                    ariaLabel={l10n.t('Exclude migration configuration help')}
                                    styles={styles}
                                />
                            </>
                        }
                    />
                )}

                {state.availableModels.length > 0 && (
                    <Field label={l10n.t('AI Model')}>
                        <Dropdown
                            onOptionSelect={handleModelChange}
                            value={selectedModel?.name ?? ''}
                            selectedOptions={state.selectedModelId ? [state.selectedModelId] : []}
                        >
                            {(() => {
                                const { recommended, others } = partitionModelsByCapability(state.availableModels);
                                const renderOption = (model: ModelInfo) => (
                                    <Option key={model.id} value={model.id} text={model.name}>
                                        {model.name}{' '}
                                        <span style={{ color: 'var(--vscode-descriptionForeground)' }}>
                                            {formatTokenCount(model.maxInputTokens)} tokens
                                        </span>
                                    </Option>
                                );
                                return (
                                    <>
                                        {recommended.map(renderOption)}
                                        {others.length > 0 && (
                                            <OptionGroup label={l10n.t('Others')}>
                                                {others.map(renderOption)}
                                            </OptionGroup>
                                        )}
                                    </>
                                );
                            })()}
                        </Dropdown>
                    </Field>
                )}

                <Checkbox
                    checked={state.consentGiven}
                    onChange={handleConsentChange}
                    label={
                        <>
                            {l10n.t(
                                'I acknowledge that this feature uses AI and that my code, schema files, and other data will be processed by GitHub Copilot using the selected AI model to assist with the migration.',
                            )}{' '}
                            <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                        </>
                    }
                />

                {!state.isAIFeaturesEnabled && (
                    <Text className={styles.warningText}>
                        {l10n.t('AI features are currently unavailable. Please ensure GitHub Copilot is active.')}
                    </Text>
                )}
            </div>

            {/* Git warning */}
            {state.hasGitRepo === false && (
                <div className={styles.configSection}>
                    <Text className={styles.warningText}>
                        {l10n.t(
                            'This workspace is not under version control. It is strongly recommended to initialize a Git repository before starting the migration.',
                        )}
                    </Text>
                    <Button appearance="secondary" size="small" onClick={handleInitGit}>
                        {l10n.t('Initialize Git Repository')}
                    </Button>
                </div>
            )}

            {/* Application Details Section */}
            <div className={styles.configSection}>
                <Text size={400} weight="semibold">
                    {l10n.t('Application Details')}
                </Text>

                <Text size={200} style={{ color: 'var(--vscode-descriptionForeground)' }}>
                    {l10n.t(
                        'Provide your database schema files and optionally volumetric data and access pattern descriptions to improve analysis accuracy.',
                    )}
                </Text>

                <div className={styles.detailsColumns}>
                    {/* Source Files — compact grid */}
                    <div className={styles.filePickerGrid}>
                        {/* Schema Files */}
                        <Text weight="semibold" size={200}>
                            {l10n.t('Database Schema Files')}{' '}
                            <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                            <InfoTooltipIcon
                                content={l10n.t(
                                    'Supported: .sql, .json, .xml, .csv, .log, .out — You can also copy files manually into the schema-ddl/ folder inside .cosmosdb-migration.',
                                )}
                                ariaLabel={l10n.t('Database schema files help')}
                                styles={styles}
                            />
                        </Text>
                        <Button appearance="secondary" size="small" onClick={handleSelectSchemaFiles}>
                            {l10n.t('Select Files…')}
                        </Button>
                        <Button appearance="secondary" size="small" onClick={handleSelectSchemaFolder}>
                            {l10n.t('Select Folder…')}
                        </Button>

                        {/* Volumetric Files */}
                        <Text weight="semibold" size={200}>
                            {l10n.t('Volumetrics')}
                            <InfoTooltipIcon
                                content={l10n.t(
                                    'Query logs, AWR reports: .txt, .csv, .json, .html, .xls — You can also copy files manually into the volumetrics/ folder inside .cosmosdb-migration.',
                                )}
                                ariaLabel={l10n.t('Volumetrics help')}
                                styles={styles}
                            />
                        </Text>
                        <Button appearance="secondary" size="small" onClick={handleSelectVolumetricFiles}>
                            {l10n.t('Select Files…')}
                        </Button>
                        <Button appearance="secondary" size="small" onClick={handleSelectVolumetricFolder}>
                            {l10n.t('Select Folder…')}
                        </Button>
                        <div
                            style={{
                                gridColumn: '2 / -1',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                            }}
                        >
                            <Button appearance="secondary" size="small" onClick={handleOpenVolumetricsTemplate}>
                                {l10n.t('Open Volumetrics Template')}
                            </Button>
                            <Tooltip
                                content={l10n.t('Update volumetrics template using AI')}
                                relationship="label"
                                withArrow
                            >
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<SparkleRegular />}
                                    onClick={handleAnalyzeVolumetrics}
                                />
                            </Tooltip>
                        </div>

                        {/* Access Pattern Files */}
                        <Text weight="semibold" size={200}>
                            {l10n.t('Access Patterns')}
                            <InfoTooltipIcon
                                content={l10n.t(
                                    'Accepts .md files describing access patterns — You can also copy files manually into the access-patterns/ folder inside .cosmosdb-migration.',
                                )}
                                ariaLabel={l10n.t('Access patterns help')}
                                styles={styles}
                            />
                        </Text>
                        <Button appearance="secondary" size="small" onClick={handleSelectAccessPatternFiles}>
                            {l10n.t('Select Files…')}
                        </Button>
                        <Button appearance="secondary" size="small" onClick={handleSelectAccessPatternFolder}>
                            {l10n.t('Select Folder…')}
                        </Button>
                        <div
                            style={{
                                gridColumn: '2 / -1',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                            }}
                        >
                            <Button appearance="secondary" size="small" onClick={handleOpenAccessPatternsTemplate}>
                                {l10n.t('Open Access-Patterns Template')}
                            </Button>
                            <Tooltip
                                content={l10n.t('Update access-patterns template using AI')}
                                relationship="label"
                                withArrow
                            >
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<SparkleRegular />}
                                    onClick={handleAnalyzeAccessPatterns}
                                />
                            </Tooltip>
                        </div>
                    </div>

                    {/* Analysis Fields */}
                    <div className={styles.analysisPanel}>
                        <div className={styles.analysisResult}>
                            <Text weight="semibold" size={200}>
                                {l10n.t('Project:')} <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'The name of your application or service. Examples: OrderService, InventoryAPI, CustomerPortal',
                                    )}
                                    ariaLabel={l10n.t('Project field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.projectName?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.projectName?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    size="small"
                                    value={state.analysisResult?.projectName ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('projectName', data.value)}
                                    placeholder={l10n.t('e.g. My Application')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                {l10n.t('Type:')} <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'The architecture or deployment style of your application. Examples: Web API, Microservice, Monolithic MVC',
                                    )}
                                    ariaLabel={l10n.t('Type field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.projectType?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.projectType?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    size="small"
                                    value={state.analysisResult?.projectType ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('projectType', data.value)}
                                    placeholder={l10n.t('e.g. Web API, Microservice')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                {l10n.t('Language:')} <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'The primary programming language of your application. Examples: C#, Java, Python',
                                    )}
                                    ariaLabel={l10n.t('Language field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.language?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.language?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    size="small"
                                    value={state.analysisResult?.language ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('language', data.value)}
                                    placeholder={l10n.t('e.g. C#, Java, Python')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                {l10n.t('Frameworks:')}{' '}
                                <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'Libraries or frameworks your app uses for data access and web serving. Multiple frameworks can be provided, separated by commas. Examples: ASP.NET Core, Spring Boot, Django',
                                    )}
                                    ariaLabel={l10n.t('Frameworks field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.frameworks?.length ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.frameworks?.length ? 'error' : 'none'}
                            >
                                <Input
                                    size="small"
                                    value={state.analysisResult?.frameworks?.join(', ') ?? ''}
                                    onChange={(_e, data) => handleFrameworksChange(data.value)}
                                    placeholder={l10n.t('e.g. ASP.NET Core, Spring Boot, Django')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                {l10n.t('Database:')} <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'The source relational database system you are migrating from. Examples: PostgreSQL, SQL Server, Oracle',
                                    )}
                                    ariaLabel={l10n.t('Database field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.databaseType?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.databaseType?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    size="small"
                                    value={state.analysisResult?.databaseType ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('databaseType', data.value)}
                                    placeholder={l10n.t('e.g. PostgreSQL, SQL Server, Oracle')}
                                />
                            </Field>
                            <Text weight="semibold" size={200}>
                                {l10n.t('Access Method:')}{' '}
                                <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                <InfoTooltipIcon
                                    content={l10n.t(
                                        'How your application connects to the database. Examples: Entity Framework, JDBC, Raw SQL queries',
                                    )}
                                    ariaLabel={l10n.t('Access method field help')}
                                    styles={styles}
                                />
                            </Text>
                            <Field
                                required
                                validationMessage={
                                    !state.analysisResult?.databaseAccess?.trim() ? l10n.t('Required') : undefined
                                }
                                validationState={!state.analysisResult?.databaseAccess?.trim() ? 'error' : 'none'}
                            >
                                <Input
                                    size="small"
                                    value={state.analysisResult?.databaseAccess ?? ''}
                                    onChange={(_e, data) => handleAnalysisFieldChange('databaseAccess', data.value)}
                                    placeholder={l10n.t('e.g. Entity Framework, JDBC')}
                                />
                            </Field>
                        </div>

                        {/* Auto-Detect Button */}
                        <div style={{ paddingTop: '8px' }}>
                            {!state.consentGiven && (
                                <Text size={200} className={styles.warningText}>
                                    {l10n.t('Please check the AI consent checkbox above before using Auto-Detect.')}
                                </Text>
                            )}

                            {state.analysisState === 'in-progress' && (
                                <div className={styles.progressRow}>
                                    <ProgressBar style={{ flex: 1 }} />
                                    <Button appearance="secondary" size="small" onClick={handleCancelAnalysis}>
                                        {l10n.t('Cancel')}
                                    </Button>
                                </div>
                            )}

                            {state.analysisState !== 'in-progress' &&
                                (() => {
                                    const autoDetectDisabled = !state.consentGiven || !state.isAIFeaturesEnabled;
                                    const autoDetectTooltip = !state.consentGiven
                                        ? l10n.t('AI consent is required to use Auto-Detect.')
                                        : !state.isAIFeaturesEnabled
                                          ? l10n.t('GitHub Copilot must be active to use Auto-Detect.')
                                          : '';
                                    const button = (
                                        <Button
                                            appearance="primary"
                                            size="small"
                                            icon={<SparkleRegular />}
                                            onClick={handleAnalyze}
                                            disabled={autoDetectDisabled}
                                            style={{ width: '100%' }}
                                        >
                                            {state.analysisState === 'complete'
                                                ? l10n.t('Re-Run Auto-Detect')
                                                : l10n.t('Auto-Detect')}
                                        </Button>
                                    );
                                    return autoDetectTooltip ? (
                                        <Tooltip content={autoDetectTooltip} relationship="description" withArrow>
                                            <span>{button}</span>
                                        </Tooltip>
                                    ) : (
                                        button
                                    );
                                })()}

                            {state.analysisError && (
                                <Text role="alert" className={styles.errorText}>
                                    <DismissCircleRegular /> {state.analysisError}
                                </Text>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Migration Phases */}
            <div className={styles.configSection}>
                <Accordion collapsible defaultOpenItems={['phase1']}>
                    {/* Phase 1: Discovery Report */}
                    <AccordionItem value="phase1">
                        <AccordionHeader icon={getPhaseIcon(phase1State)}>
                            <Text weight="semibold">{l10n.t('Phase 1: Discovery Report')}</Text>
                            {phase1State === 'complete' && (
                                <Badge appearance="filled" color="success" style={{ marginLeft: '8px' }}>
                                    {l10n.t('Complete')}
                                </Badge>
                            )}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={styles.stepContent}>
                                <Text size={200}>
                                    {l10n.t(
                                        'Generate a comprehensive discovery report using AI analysis of your schema, access patterns, and application details.',
                                    )}
                                </Text>

                                {/* Source file lists and template handling */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {/* Schema Files */}
                                    <div>
                                        <Text weight="semibold" size={200}>
                                            {l10n.t('Database Schema Files')}
                                        </Text>
                                        <FileListExpander
                                            files={state.schemaFiles}
                                            onOpenFile={handleOpenFile}
                                            styles={styles}
                                        />
                                    </div>

                                    {/* Volumetrics */}
                                    <div>
                                        <Text weight="semibold" size={200}>
                                            {l10n.t('Volumetrics')}
                                        </Text>
                                        <FileListExpander
                                            files={state.volumetricFiles}
                                            onOpenFile={handleOpenFile}
                                            styles={styles}
                                        />
                                    </div>

                                    {/* Access Patterns */}
                                    <div>
                                        <Text weight="semibold" size={200}>
                                            {l10n.t('Access Patterns')}
                                        </Text>
                                        <FileListExpander
                                            files={state.accessPatternFiles}
                                            onOpenFile={handleOpenFile}
                                            styles={styles}
                                        />
                                    </div>
                                </div>

                                <Field
                                    label={
                                        <>
                                            {l10n.t('Additional Discovery Instructions')}
                                            <InfoTooltipIcon
                                                content={l10n.t(
                                                    'Provide additional context or specific focus areas for the discovery report. These instructions will be included in the AI prompt when generating the report.',
                                                )}
                                                ariaLabel={l10n.t('Additional discovery instructions help')}
                                                styles={styles}
                                            />
                                        </>
                                    }
                                >
                                    <Textarea
                                        value={state.discoveryInstructions ?? ''}
                                        onChange={handleDiscoveryInstructionsChange}
                                        placeholder={l10n.t(
                                            'e.g., Focus on the ordering domain, ignore legacy tables prefixed with tmp_…',
                                        )}
                                        resize="vertical"
                                        rows={3}
                                    />
                                </Field>

                                {state.discoveryState === 'in-progress' && (
                                    <div className={styles.progressRow}>
                                        <ProgressBar style={{ flex: 1 }} />
                                        <Button appearance="secondary" size="small" onClick={handleCancelDiscovery}>
                                            {l10n.t('Cancel')}
                                        </Button>
                                    </div>
                                )}

                                {state.discoveryState !== 'in-progress' && (
                                    <div className={styles.buttonRow}>
                                        <Button
                                            appearance="primary"
                                            size="small"
                                            icon={<SparkleRegular />}
                                            onClick={handleRunDiscovery}
                                            disabled={isDiscoveryDisabled}
                                        >
                                            {state.discoveryState === 'complete'
                                                ? l10n.t('Re-Generate Report')
                                                : l10n.t('Generate Discovery Report')}
                                        </Button>
                                        <TokenBudgetBar estimate={state.tokenEstimate} isEstimating={isEstimating} />
                                    </div>
                                )}

                                {state.discoveryError && (
                                    <Text role="alert" className={styles.errorText}>
                                        <DismissCircleRegular /> {state.discoveryError}
                                    </Text>
                                )}

                                {phase1State === 'complete' && (
                                    <Link
                                        onClick={() =>
                                            handlePreviewMarkdown(
                                                `${state.workspacePath}/.cosmosdb-migration/phases/1-discovery/discovery-report.md`,
                                            )
                                        }
                                    >
                                        {l10n.t('View Discovery Report')}
                                    </Link>
                                )}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>

                    <div className={styles.phaseDivider} />

                    {/* Phase 2: Domain Assessment */}
                    <AccordionItem value="phase2">
                        <AccordionHeader
                            icon={getPhaseIcon(
                                phase2State === 'complete' ? 'complete' : isPhase2Disabled ? 'locked' : phase2State,
                            )}
                        >
                            <Text weight="semibold">{l10n.t('Phase 2: Domain Assessment')}</Text>
                            {phase2State === 'complete' && (
                                <Badge appearance="filled" color="success" style={{ marginLeft: '8px' }}>
                                    {l10n.t('Complete')}
                                </Badge>
                            )}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={styles.stepContent}>
                                <div
                                    className={`${styles.phaseInputs} ${phase2State === 'complete' ? styles.completedContent : ''}`}
                                >
                                    <Text size={200}>
                                        {l10n.t(
                                            'Run AI-powered domain decomposition to identify bounded contexts, group related tables, and generate Cosmos DB migration recommendations.',
                                        )}
                                    </Text>

                                    {state.assessmentState === 'in-progress' && (
                                        <>
                                            <div className={styles.progressRow}>
                                                <ProgressBar style={{ flex: 1 }} />
                                                <Button
                                                    appearance="secondary"
                                                    size="small"
                                                    onClick={handleCancelAssessment}
                                                >
                                                    {l10n.t('Cancel')}
                                                </Button>
                                            </div>
                                            {state.assessmentProgress && (
                                                <Text
                                                    role="status"
                                                    aria-live="polite"
                                                    size={200}
                                                    style={{ color: 'var(--vscode-descriptionForeground)' }}
                                                >
                                                    {state.assessmentProgress}
                                                </Text>
                                            )}
                                        </>
                                    )}

                                    {state.assessmentState !== 'in-progress' && (
                                        <>
                                            <Field
                                                label={
                                                    <>
                                                        {l10n.t('Additional Assessment Instructions')}
                                                        <InfoTooltipIcon
                                                            content={l10n.t(
                                                                'Provide additional context or specific focus areas for domain assessment. These instructions will be included in the AI prompt when running assessment.',
                                                            )}
                                                            ariaLabel={l10n.t(
                                                                'Additional assessment instructions help',
                                                            )}
                                                            styles={styles}
                                                        />
                                                    </>
                                                }
                                            >
                                                <Textarea
                                                    value={state.assessmentInstructions ?? ''}
                                                    onChange={handleAssessmentInstructionsChange}
                                                    placeholder={l10n.t(
                                                        'e.g., Prioritize minimizing cross-domain joins and keep payment-related tables isolated…',
                                                    )}
                                                    resize="vertical"
                                                    rows={3}
                                                />
                                            </Field>

                                            <Button
                                                appearance="primary"
                                                size="small"
                                                icon={<SparkleRegular />}
                                                onClick={handleRunAssessment}
                                                disabled={
                                                    isPhase2Disabled ||
                                                    !state.consentGiven ||
                                                    !state.isAIFeaturesEnabled
                                                }
                                            >
                                                {state.assessmentState === 'complete'
                                                    ? l10n.t('Re-Run Assessment')
                                                    : l10n.t('Run Assessment')}
                                            </Button>
                                        </>
                                    )}
                                </div>

                                {state.assessmentError && (
                                    <Text role="alert" className={styles.errorText}>
                                        <DismissCircleRegular /> {state.assessmentError}
                                    </Text>
                                )}

                                {state.assessmentResult && (
                                    <div className={styles.stepContent}>
                                        <Text weight="semibold">
                                            {l10n.t('{count} domain(s) identified', {
                                                count: state.assessmentResult.domainFiles.length,
                                            })}
                                        </Text>
                                        <table
                                            style={{
                                                width: '100%',
                                                borderCollapse: 'collapse',
                                                fontSize: '12px',
                                            }}
                                        >
                                            <thead>
                                                <tr
                                                    style={{
                                                        borderBottom: '1px solid var(--vscode-panel-border)',
                                                        textAlign: 'left',
                                                    }}
                                                >
                                                    <th style={{ padding: '4px 6px' }}>{l10n.t('Domain')}</th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>
                                                        {l10n.t('Tables')}
                                                    </th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>
                                                        {l10n.t('Est. Tokens')}
                                                    </th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'center' }}>
                                                        {l10n.t('Referenced in Code')}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {state.assessmentResult.domainFiles.map((domain, i) => (
                                                    <tr
                                                        key={i}
                                                        style={{
                                                            borderBottom: '1px solid var(--vscode-panel-border)',
                                                        }}
                                                    >
                                                        <td style={{ padding: '4px 6px' }}>
                                                            <Link
                                                                className={styles.fileLink}
                                                                onClick={() => handlePreviewMarkdown(domain.filePath)}
                                                            >
                                                                {domain.name}
                                                            </Link>
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'right',
                                                                color: 'var(--vscode-descriptionForeground)',
                                                            }}
                                                        >
                                                            {domain.tables.length}
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'right',
                                                                color: 'var(--vscode-descriptionForeground)',
                                                            }}
                                                        >
                                                            {formatTokenCount(domain.estimatedTokens)}
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'center',
                                                            }}
                                                        >
                                                            {domain.isMapped ? (
                                                                <CheckmarkCircleFilled
                                                                    style={{
                                                                        color: 'var(--vscode-testing-iconPassed)',
                                                                    }}
                                                                />
                                                            ) : (
                                                                <Text
                                                                    size={200}
                                                                    style={{
                                                                        color: 'var(--vscode-descriptionForeground)',
                                                                    }}
                                                                >
                                                                    —
                                                                </Text>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <Link
                                            style={{ fontSize: '12px' }}
                                            onClick={() =>
                                                handlePreviewMarkdown(state.assessmentResult!.summaryFilePath)
                                            }
                                        >
                                            {l10n.t('View full assessment summary')}
                                        </Link>
                                    </div>
                                )}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>

                    <div className={styles.phaseDivider} />

                    {/* Phase 3: Schema Conversion */}
                    <AccordionItem value="phase3">
                        <AccordionHeader
                            icon={getPhaseIcon(
                                phase3State === 'complete' ? 'complete' : isPhase3Disabled ? 'locked' : phase3State,
                            )}
                        >
                            <Text weight="semibold">{l10n.t('Phase 3: Schema Conversion')}</Text>
                            {phase3State === 'complete' && (
                                <Badge appearance="filled" color="success" style={{ marginLeft: '8px' }}>
                                    {l10n.t('Complete')}
                                </Badge>
                            )}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={styles.stepContent}>
                                <div
                                    className={`${styles.phaseInputs} ${phase3State === 'complete' ? styles.completedContent : ''}`}
                                >
                                    <Text size={200}>
                                        {l10n.t(
                                            'Transform your RDBMS schema into optimized Cosmos DB NoSQL data models. This phase designs containers, partition keys, embedding strategies, access patterns, and indexing policies for each domain.',
                                        )}
                                    </Text>

                                    <Checkbox
                                        checked={state.includeUnmappedDomains}
                                        onChange={handleIncludeUnmappedDomainsChange}
                                        disabled={state.schemaConversionState === 'in-progress'}
                                        label={l10n.t(
                                            'Include domains without detected application code access patterns (e.g. tables only referenced via stored procedures, ETL, or external systems)',
                                        )}
                                    />

                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <Checkbox
                                            checked={state.thoroughAnalysis}
                                            onChange={handleThoroughAnalysisChange}
                                            disabled={state.schemaConversionState === 'in-progress'}
                                            label={l10n.t('Enable thorough analysis')}
                                        />
                                        <InfoTooltipIcon
                                            content={
                                                l10n.t(
                                                    'Fast mode (default): Performs a single AI analysis pass per domain, producing a complete data model with containers, partition keys, embedding strategies, access pattern mappings, cross-partition analysis, and indexing policies in one step. Suitable for most migrations and significantly faster.',
                                                ) +
                                                '\n\n' +
                                                l10n.t(
                                                    'Thorough mode: Runs 7 sequential analysis steps per domain, each focusing on a specific concern (container design, partition key selection, embedding decisions, access patterns, cross-partition queries, indexing, and summary). Produces detailed per-step output files for deeper review. Recommended for complex schemas or when you need granular analysis artifacts.',
                                                )
                                            }
                                            ariaLabel={l10n.t('Thorough analysis mode help')}
                                            styles={styles}
                                        />
                                    </div>

                                    {state.schemaConversionState !== 'in-progress' && (
                                        <Field
                                            label={
                                                <>
                                                    {l10n.t('Additional Schema Conversion Instructions')}
                                                    <InfoTooltipIcon
                                                        content={l10n.t(
                                                            'Provide additional context or specific guidance for schema conversion. These instructions will be included in the AI prompt when designing containers, partition keys, embedding strategies, and other Cosmos DB schema decisions.',
                                                        )}
                                                        ariaLabel={l10n.t(
                                                            'Additional schema conversion instructions help',
                                                        )}
                                                        styles={styles}
                                                    />
                                                </>
                                            }
                                        >
                                            <Textarea
                                                value={state.schemaConversionInstructions ?? ''}
                                                onChange={handleSchemaConversionInstructionsChange}
                                                placeholder={l10n.t(
                                                    'e.g., Use serverless throughput mode, prefer embedding over referencing for 1:few relationships, keep all lookup tables in a single container…',
                                                )}
                                                resize="vertical"
                                                rows={3}
                                            />
                                        </Field>
                                    )}

                                    {state.schemaConversionState === 'in-progress' && (
                                        <>
                                            <div className={styles.progressRow}>
                                                <ProgressBar style={{ flex: 1 }} />
                                                <Button
                                                    appearance="secondary"
                                                    size="small"
                                                    onClick={handleCancelSchemaConversion}
                                                >
                                                    {l10n.t('Cancel')}
                                                </Button>
                                            </div>
                                            {state.schemaConversionProgress && (
                                                <Text
                                                    role="status"
                                                    aria-live="polite"
                                                    size={200}
                                                    style={{ color: 'var(--vscode-descriptionForeground)' }}
                                                >
                                                    {state.schemaConversionProgress}
                                                </Text>
                                            )}
                                        </>
                                    )}

                                    {state.schemaConversionState !== 'in-progress' && (
                                        <Button
                                            appearance="primary"
                                            size="small"
                                            icon={<SparkleRegular />}
                                            onClick={handleRunSchemaConversion}
                                            disabled={
                                                isPhase3Disabled || !state.consentGiven || !state.isAIFeaturesEnabled
                                            }
                                        >
                                            {state.schemaConversionState === 'complete'
                                                ? l10n.t('Re-Run Schema Conversion')
                                                : l10n.t('Run Schema Conversion')}
                                        </Button>
                                    )}
                                </div>

                                {state.schemaConversionError && (
                                    <Text role="alert" className={styles.errorText}>
                                        <DismissCircleRegular /> {state.schemaConversionError}
                                    </Text>
                                )}

                                {state.schemaConversionResult && (
                                    <div className={styles.stepContent}>
                                        <Text weight="semibold">
                                            {l10n.t('{count} domain(s) converted', {
                                                count: state.schemaConversionResult.domains.length,
                                            })}
                                        </Text>
                                        <table
                                            style={{
                                                width: '100%',
                                                borderCollapse: 'collapse',
                                                fontSize: '12px',
                                            }}
                                        >
                                            <thead>
                                                <tr
                                                    style={{
                                                        borderBottom: '1px solid var(--vscode-panel-border)',
                                                        textAlign: 'left',
                                                    }}
                                                >
                                                    <th style={{ padding: '4px 6px' }}>{l10n.t('Domain')}</th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>
                                                        {l10n.t('Containers')}
                                                    </th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>
                                                        {l10n.t('Entities')}
                                                    </th>
                                                    <th style={{ padding: '4px 6px', textAlign: 'center' }}>
                                                        {l10n.t('Model')}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {state.schemaConversionResult.domains.map((domain, i) => (
                                                    <tr
                                                        key={i}
                                                        style={{
                                                            borderBottom: '1px solid var(--vscode-panel-border)',
                                                        }}
                                                    >
                                                        <td style={{ padding: '4px 6px' }}>
                                                            <Link
                                                                className={styles.fileLink}
                                                                onClick={() =>
                                                                    handlePreviewMarkdown(domain.summaryFilePath)
                                                                }
                                                            >
                                                                {domain.name}
                                                            </Link>
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'right',
                                                                color: 'var(--vscode-descriptionForeground)',
                                                            }}
                                                        >
                                                            {domain.containers}
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'right',
                                                                color: 'var(--vscode-descriptionForeground)',
                                                            }}
                                                        >
                                                            {domain.entities}
                                                        </td>
                                                        <td
                                                            style={{
                                                                padding: '4px 6px',
                                                                textAlign: 'center',
                                                            }}
                                                        >
                                                            <Link
                                                                className={styles.fileLink}
                                                                style={{
                                                                    display: 'inline',
                                                                    paddingLeft: 0,
                                                                }}
                                                                onClick={() => handleOpenFile(domain.modelFilePath)}
                                                            >
                                                                {l10n.t('JSON')}
                                                            </Link>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <div
                                            style={{
                                                display: 'flex',
                                                gap: '12px',
                                                fontSize: '12px',
                                            }}
                                        >
                                            <Link
                                                onClick={() =>
                                                    handlePreviewMarkdown(state.schemaConversionResult!.summaryFilePath)
                                                }
                                            >
                                                {l10n.t('View merged summary')}
                                            </Link>
                                            <Link
                                                onClick={() =>
                                                    handleOpenFile(state.schemaConversionResult!.mergedModelFilePath)
                                                }
                                            >
                                                {l10n.t('View merged model')}
                                            </Link>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>

                    <div className={styles.phaseDivider} />

                    {/* Phase 4: Target Cosmos DB Environment */}
                    <AccordionItem value="phase4">
                        <AccordionHeader
                            icon={getPhaseIcon(
                                phase4State === 'complete' ? 'complete' : isPhase4Disabled ? 'locked' : phase4State,
                            )}
                        >
                            <Text weight="semibold">{l10n.t('Phase 4: Target Cosmos DB Environment')}</Text>
                            {phase4State === 'complete' && (
                                <Badge appearance="filled" color="success" style={{ marginLeft: '8px' }}>
                                    {l10n.t('Complete')}
                                </Badge>
                            )}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className={styles.stepContent}>
                                <div
                                    className={`${styles.phaseInputs} ${phase4State === 'complete' ? styles.completedContent : ''}`}
                                >
                                    <Text size={200}>
                                        {l10n.t('Select your target Cosmos DB environment and verify the connection.')}
                                    </Text>

                                    <Field
                                        label={
                                            <>
                                                {l10n.t('Target Environment')}{' '}
                                                <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                            </>
                                        }
                                    >
                                        <RadioGroup
                                            value={state.targetType ?? ''}
                                            onChange={handleTargetTypeChange}
                                            disabled={isPhase4Disabled}
                                        >
                                            <Radio value="emulator" label={l10n.t('Local Cosmos DB Emulator')} />
                                            <Radio value="azure" label={l10n.t('Azure Cosmos DB Account')} />
                                            <Radio
                                                value="provision"
                                                label={l10n.t('Provision new Azure Cosmos DB Account')}
                                            />
                                        </RadioGroup>
                                    </Field>

                                    {state.targetType === 'azure' && (
                                        <Field
                                            label={
                                                <>
                                                    {l10n.t('Account Endpoint')}{' '}
                                                    <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                                </>
                                            }
                                        >
                                            <div className={styles.buttonRow}>
                                                <Input
                                                    size="small"
                                                    style={{ flex: 1 }}
                                                    value={state.targetEndpoint}
                                                    onChange={(_e, data) => handleEndpointChange(data.value)}
                                                    placeholder={l10n.t(
                                                        'https://your-account.documents.azure.com:443/',
                                                    )}
                                                    disabled={isPhase4Disabled}
                                                />
                                                <Button
                                                    appearance="secondary"
                                                    size="small"
                                                    icon={<CosmosDBIcon />}
                                                    onClick={handleSelectAccount}
                                                    disabled={isPhase4Disabled}
                                                >
                                                    {l10n.t('Select Account')}
                                                </Button>
                                            </div>
                                        </Field>
                                    )}

                                    {state.targetType === 'provision' && (
                                        <>
                                            <Field
                                                label={
                                                    <>
                                                        {l10n.t('Resource Group')}{' '}
                                                        <span style={{ color: 'var(--vscode-errorForeground)' }}>
                                                            *
                                                        </span>
                                                    </>
                                                }
                                            >
                                                <div className={styles.buttonRow}>
                                                    <Input
                                                        size="small"
                                                        style={{ flex: 1 }}
                                                        value={state.targetResourceGroup}
                                                        readOnly
                                                        placeholder={l10n.t(
                                                            'Use the button to select or create a resource group',
                                                        )}
                                                        disabled={isPhase4Disabled}
                                                    />
                                                    <Button
                                                        appearance="secondary"
                                                        size="small"
                                                        icon={<DatabaseRegular />}
                                                        onClick={handleSelectResourceGroup}
                                                        disabled={isPhase4Disabled}
                                                    >
                                                        {l10n.t('Select Resource Group')}
                                                    </Button>
                                                </div>
                                            </Field>
                                            {state.targetSubscriptionName && (
                                                <Label size="small">
                                                    {l10n.t('Subscription: {0}', state.targetSubscriptionName)}
                                                </Label>
                                            )}
                                            <Field
                                                label={
                                                    <>
                                                        {l10n.t('Account Name')}{' '}
                                                        <span style={{ color: 'var(--vscode-errorForeground)' }}>
                                                            *
                                                        </span>
                                                    </>
                                                }
                                                validationState={accountNameValidationError ? 'error' : 'none'}
                                                validationMessage={accountNameValidationError}
                                            >
                                                <Input
                                                    size="small"
                                                    value={state.targetAccountName ?? ''}
                                                    onChange={(_e, data) => handleAccountNameChange(data.value)}
                                                    placeholder={l10n.t('my-cosmosdb-account')}
                                                    disabled={isPhase4Disabled}
                                                />
                                            </Field>
                                            <Field label={l10n.t('Location')}>
                                                {state.availableLocations.length > 0 ? (
                                                    <Dropdown
                                                        size="small"
                                                        value={
                                                            state.availableLocations.find(
                                                                (loc) => loc.name === state.targetLocation,
                                                            )?.displayName ?? state.targetLocation
                                                        }
                                                        selectedOptions={[state.targetLocation]}
                                                        onOptionSelect={handleLocationChange}
                                                        disabled={isPhase4Disabled}
                                                    >
                                                        {state.availableLocations.map((loc) => (
                                                            <Option key={loc.name} value={loc.name}>
                                                                {loc.displayName}
                                                            </Option>
                                                        ))}
                                                    </Dropdown>
                                                ) : (
                                                    <Input
                                                        size="small"
                                                        value={state.targetLocation}
                                                        readOnly
                                                        placeholder={l10n.t(
                                                            'Determined by the selected resource group',
                                                        )}
                                                        disabled={isPhase4Disabled}
                                                    />
                                                )}
                                            </Field>
                                            {state.bicepGenerated && (
                                                <Text size={200}>
                                                    {l10n.t(
                                                        'Prefer to provision manually? A Bicep template has been generated based on your schema.',
                                                    )}{' '}
                                                    <Link onClick={handleOpenGeneratedBicep}>
                                                        {l10n.t('Open generated Bicep template')}
                                                    </Link>
                                                </Text>
                                            )}
                                        </>
                                    )}

                                    {state.targetType === 'provision' && (
                                        <>
                                            {state.accountProvisioningState === 'in-progress' ? (
                                                <>
                                                    <div className={styles.progressRow}>
                                                        <ProgressBar style={{ flex: 1 }} />
                                                        <Button
                                                            appearance="secondary"
                                                            size="small"
                                                            icon={<StopRegular />}
                                                            onClick={handleCancelAccountProvisioning}
                                                        >
                                                            {l10n.t('Cancel')}
                                                        </Button>
                                                    </div>
                                                    {state.accountProvisioningProgress && (
                                                        <Text role="status" aria-live="polite" size={200}>
                                                            {state.accountProvisioningProgress}
                                                        </Text>
                                                    )}
                                                </>
                                            ) : (
                                                <Button
                                                    appearance="primary"
                                                    size="small"
                                                    icon={<CloudAddRegular />}
                                                    onClick={handleProvisionAccount}
                                                    disabled={
                                                        isPhase4Disabled ||
                                                        !state.targetResourceGroup ||
                                                        !state.targetAccountName ||
                                                        !state.targetLocation ||
                                                        !!accountNameValidationError
                                                    }
                                                >
                                                    {state.accountProvisioningState === 'complete'
                                                        ? l10n.t('Re-Provision Account')
                                                        : l10n.t('Provision New Account')}
                                                </Button>
                                            )}
                                            {state.accountProvisioningState === 'complete' && (
                                                <Text>
                                                    <CheckmarkCircleFilled
                                                        style={{ color: 'var(--vscode-testing-iconPassed)' }}
                                                    />{' '}
                                                    {l10n.t('Account provisioned successfully.')}
                                                </Text>
                                            )}
                                            {state.accountProvisioningError && (
                                                <Text role="alert" className={styles.errorText}>
                                                    <DismissCircleRegular /> {state.accountProvisioningError}
                                                </Text>
                                            )}
                                        </>
                                    )}

                                    {state.targetType &&
                                        (state.targetType !== 'provision' ||
                                            state.accountProvisioningState === 'complete') && (
                                            <>
                                                {state.connectionTestState === 'in-progress' ? (
                                                    <ProgressBar />
                                                ) : state.targetType === 'provision' ? null : (
                                                    <Button
                                                        appearance="primary"
                                                        size="small"
                                                        icon={<PlugConnectedRegular />}
                                                        onClick={handleTestConnection}
                                                        disabled={
                                                            isPhase4Disabled ||
                                                            !state.targetType ||
                                                            (state.targetType === 'azure' && !state.targetEndpoint)
                                                        }
                                                    >
                                                        {l10n.t('Test Connection')}
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                </div>

                                {state.connectionVerified && (
                                    <Text>
                                        <CheckmarkCircleFilled style={{ color: 'var(--vscode-testing-iconPassed)' }} />{' '}
                                        {l10n.t('Connection verified successfully.')}
                                    </Text>
                                )}

                                {state.connectionTestError && (
                                    <Text role="alert" className={styles.errorText}>
                                        <DismissCircleRegular /> {state.connectionTestError}
                                        {state.connectionTestDocumentationUrl && (
                                            <>
                                                {' '}
                                                <Link
                                                    href={state.connectionTestDocumentationUrl}
                                                    target="_blank"
                                                    inline
                                                >
                                                    {l10n.t('View installation instructions')}
                                                </Link>
                                            </>
                                        )}
                                    </Text>
                                )}

                                {/* Provisioning Section */}
                                {state.connectionVerified && state.schemaConversionState === 'complete' && (
                                    <>
                                        <div className={styles.sectionDivider}>
                                            <Text weight="semibold" size={300}>
                                                {l10n.t('Populate Sample Data')}
                                            </Text>
                                            <Text size={200} style={{ display: 'block', marginTop: '4px' }}>
                                                {l10n.t(
                                                    'Create database, containers, and insert AI-generated sample data based on your converted schema.',
                                                )}
                                            </Text>
                                        </div>

                                        {state.provisioningState === 'in-progress' && (
                                            <>
                                                <div className={styles.progressRow}>
                                                    <ProgressBar style={{ flex: 1 }} />
                                                    <Button
                                                        appearance="secondary"
                                                        size="small"
                                                        icon={<StopRegular />}
                                                        onClick={handleCancelProvisioning}
                                                    >
                                                        {l10n.t('Cancel')}
                                                    </Button>
                                                </div>
                                                {state.provisioningProgress && (
                                                    <Text role="status" aria-live="polite" size={200}>
                                                        {state.provisioningProgress}
                                                    </Text>
                                                )}
                                            </>
                                        )}

                                        {state.provisioningState !== 'in-progress' && (
                                            <Button
                                                appearance="primary"
                                                size="small"
                                                icon={<DatabaseRegular />}
                                                onClick={handlePopulateSampleData}
                                                disabled={
                                                    isPhase4Disabled ||
                                                    !state.consentGiven ||
                                                    !state.isAIFeaturesEnabled
                                                }
                                            >
                                                {state.provisioningState === 'complete'
                                                    ? l10n.t('Re-Populate Sample Data')
                                                    : l10n.t('Populate Sample Data')}
                                            </Button>
                                        )}

                                        {state.provisioningError && (
                                            <Text role="alert" className={styles.errorText}>
                                                <DismissCircleRegular /> {state.provisioningError}
                                            </Text>
                                        )}

                                        {state.provisioningResult && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <Text>
                                                    <CheckmarkCircleFilled
                                                        style={{ color: 'var(--vscode-testing-iconPassed)' }}
                                                    />{' '}
                                                    {l10n.t(
                                                        'Database "{0}" created with {1} container(s).',
                                                        state.provisioningResult.databaseName,
                                                        state.provisioningResult.containersCreated.length,
                                                    )}
                                                </Text>
                                                <Text size={200}>
                                                    {l10n.t(
                                                        'Containers: {0}',
                                                        state.provisioningResult.containersCreated.join(', '),
                                                    )}
                                                </Text>
                                                {state.provisioningResult.seedScriptPath && (
                                                    <Link
                                                        onClick={() =>
                                                            handleOpenFile(state.provisioningResult!.seedScriptPath)
                                                        }
                                                    >
                                                        {l10n.t('Open seed-data.csh script')}
                                                    </Link>
                                                )}
                                                {state.provisioningResult.warnings.length > 0 && (
                                                    <div
                                                        role="status"
                                                        aria-live="polite"
                                                        style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '2px',
                                                            marginTop: '4px',
                                                        }}
                                                    >
                                                        <Text size={200} weight="semibold">
                                                            <WarningRegular
                                                                style={{
                                                                    color: 'var(--vscode-editorWarning-foreground)',
                                                                }}
                                                            />{' '}
                                                            {l10n.t(
                                                                'Some sample items were not inserted successfully:',
                                                            )}
                                                        </Text>
                                                        {state.provisioningResult.warnings.map((warning, idx) => (
                                                            <Text key={idx} size={200}>
                                                                {warning}
                                                            </Text>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>
                </Accordion>
            </div>

            {/* Additional Migration Instructions */}
            <div className={styles.configSection}>
                <Field
                    label={
                        <>
                            {l10n.t('Additional Migration Instructions')}
                            <InfoTooltipIcon
                                content={l10n.t(
                                    'Provide any additional context or requirements for the code migration plan. These instructions will be included when generating the migration plan via Copilot Chat.',
                                )}
                                ariaLabel={l10n.t('Additional migration instructions help')}
                                styles={styles}
                            />
                        </>
                    }
                >
                    <Textarea
                        value={state.migrationInstructions ?? ''}
                        onChange={handleMigrationInstructionsChange}
                        placeholder={l10n.t('e.g., Use the repository pattern, prefer async/await, target .NET 8…')}
                        resize="vertical"
                        rows={3}
                    />
                </Field>
            </div>

            {/* Footer */}
            <div className={styles.footer}>
                <Button appearance="secondary" size="small" onClick={handleReset}>
                    {l10n.t('Reset Project')}
                </Button>
                <div className={styles.footerRight}>
                    {state.hasCodeMigrationPlan && (
                        <Link onClick={() => handlePreviewMarkdown(state.codeMigrationPlanPath)}>
                            <DocumentRegular style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            {l10n.t('View Plan')}
                        </Link>
                    )}
                    <Menu>
                        <MenuTrigger>
                            {(triggerProps: MenuButtonProps) => (
                                <SplitButton
                                    appearance="primary"
                                    size="small"
                                    icon={<SparkleRegular />}
                                    disabled={!allComplete}
                                    menuButton={{
                                        ...triggerProps,
                                        'aria-label': l10n.t('Select migration action'),
                                    }}
                                    primaryActionButton={{ onClick: handleStartMigration }}
                                >
                                    {state.migrationMode === 'plan'
                                        ? l10n.t('Plan Migration')
                                        : l10n.t('Start Migration')}
                                </SplitButton>
                            )}
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                <MenuItem onClick={() => handleSetMigrationMode('plan')}>
                                    {l10n.t('Plan Migration')}
                                </MenuItem>
                                <MenuItem onClick={() => handleSetMigrationMode('start')}>
                                    {l10n.t('Start Migration')}
                                </MenuItem>
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                </div>
            </div>
        </div>
    );
}

export const MigrationAssistant = () => {
    const { channel } = useContext(WebviewContext);

    return (
        <WithMigrationContext channel={channel}>
            <MigrationAssistantInner />
        </WithMigrationContext>
    );
};
