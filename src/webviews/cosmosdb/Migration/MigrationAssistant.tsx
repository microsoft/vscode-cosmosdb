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
    Link,
    makeStyles,
    Option,
    OptionGroup,
    ProgressBar,
    Radio,
    RadioGroup,
    Text,
    Tooltip,
    type OptionOnSelectData,
} from '@fluentui/react-components';
import {
    CheckmarkCircleFilled,
    ChevronDownRegular,
    ChevronRightRegular,
    CircleRegular,
    DismissCircleRegular,
    ErrorCircleFilled,
    InfoRegular,
    LockClosedRegular,
    PlayRegular,
    PlugConnectedRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useContext, useEffect, useState } from 'react';
import { formatTokenCount, partitionModelsByCapability } from '../../../utils/modelUtils';
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
        padding: '16px',
        gap: '16px',
        boxSizing: 'border-box',
    },
    configSection: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        borderRadius: '6px',
        border: '1px solid var(--vscode-panel-border)',
        backgroundColor: 'var(--vscode-editor-background)',
    },
    configRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
    },
    stepContent: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '8px 0',
    },
    fileSection: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    fileList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        paddingLeft: '8px',
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
        cursor: 'help',
        color: 'var(--vscode-descriptionForeground)',
        verticalAlign: 'middle',
        marginLeft: '4px',
    },
    analysisResult: {
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '4px 12px',
        padding: '8px 12px',
        borderRadius: '4px',
        backgroundColor: 'var(--vscode-textBlockQuote-background)',
        fontSize: '13px',
    },
    analysisLabel: {
        fontWeight: '600',
        color: 'var(--vscode-foreground)',
    },
    analysisValue: {
        color: 'var(--vscode-descriptionForeground)',
    },
    footer: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 0',
        borderTop: '1px solid var(--vscode-panel-border)',
        marginTop: 'auto',
    },
    errorText: {
        color: 'var(--vscode-errorForeground)',
        fontSize: '12px',
    },
    warningText: {
        color: 'var(--vscode-editorWarning-foreground)',
        fontSize: '12px',
    },
});

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

function getPhaseIcon(state: PhaseState) {
    switch (state) {
        case 'locked':
            return <LockClosedRegular />;
        case 'available':
            return <CircleRegular />;
        case 'in-progress':
            return <PlayRegular />;
        case 'complete':
            return <CheckmarkCircleFilled style={{ color: 'var(--vscode-testing-iconPassed)' }} />;
        case 'error':
            return <ErrorCircleFilled style={{ color: 'var(--vscode-errorForeground)' }} />;
    }
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
    const phase1State: PhaseState = state.analysisState === 'locked' ? 'available' : state.analysisState;
    const phase2State: PhaseState = state.assessmentState;
    const phase3State: PhaseState = state.schemaConversionState;
    const phase4State: PhaseState = state.connectionTestState;

    const allComplete =
        phase1State === 'complete' &&
        phase2State === 'complete' &&
        phase3State === 'complete' &&
        phase4State === 'complete' &&
        state.consentGiven;
    const isAnalyzeDisabled = state.schemaFiles.length === 0;
    const isPhase2Disabled = phase1State !== 'complete';
    const isPhase3Disabled = phase2State !== 'complete';
    const isPhase4Disabled = phase1State !== 'complete';

    // Request token estimation whenever schema/access-pattern files or model change
    useEffect(() => {
        if (state.isLoaded && state.schemaFiles.length > 0) {
            sendCommand('estimateContextTokens');
        }
    }, [state.isLoaded, state.schemaFiles.length, state.accessPatternFiles.length, state.selectedModelId, sendCommand]);

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
            dispatch({ type: 'SET_CONSENT', payload: data.checked === true });
        },
        [dispatch],
    );

    const handleSelectSchemaFiles = useCallback(() => sendCommand('selectSchemaFiles'), [sendCommand]);
    const handleSelectSchemaFolder = useCallback(() => sendCommand('selectSchemaFolder'), [sendCommand]);
    const handleSelectVolumetricFiles = useCallback(() => sendCommand('selectVolumetricFiles'), [sendCommand]);
    const handleSelectVolumetricFolder = useCallback(() => sendCommand('selectVolumetricFolder'), [sendCommand]);
    const handleSelectAccessPatternFiles = useCallback(() => sendCommand('selectAccessPatternFiles'), [sendCommand]);
    const handleSelectAccessPatternFolder = useCallback(() => sendCommand('selectAccessPatternFolder'), [sendCommand]);

    const handleAnalyze = useCallback(() => sendCommand('analyzeApplication'), [sendCommand]);
    const handleCancelAnalysis = useCallback(() => sendCommand('cancelAnalysis'), [sendCommand]);

    const handleAnalysisFieldChange = useCallback(
        (field: string, value: string) => {
            dispatch({ type: 'UPDATE_ANALYSIS_FIELD', payload: { field, value } });
            sendCommand('updateAnalysisResult', { [field]: value });
        },
        [dispatch, sendCommand],
    );

    const handleRunAssessment = useCallback(() => sendCommand('runAssessment'), [sendCommand]);
    const handleCancelAssessment = useCallback(() => sendCommand('cancelAssessment'), [sendCommand]);
    const handleRunSchemaConversion = useCallback(
        () => sendCommand('runSchemaConversion', state.includeUnmappedDomains),
        [sendCommand, state.includeUnmappedDomains],
    );
    const handleCancelSchemaConversion = useCallback(() => sendCommand('cancelSchemaConversion'), [sendCommand]);
    const handleIncludeUnmappedDomainsChange = useCallback(
        (_e: unknown, data: { checked: boolean | 'mixed' }) => {
            dispatch({ type: 'SET_INCLUDE_UNMAPPED_DOMAINS', payload: data.checked === true });
        },
        [dispatch],
    );

    const handleTargetTypeChange = useCallback(
        (_e: unknown, data: { value: string }) => {
            const targetType = data.value as 'emulator' | 'azure';
            dispatch({ type: 'SET_TARGET_TYPE', payload: targetType });
            sendCommand('setTargetEnvironment', targetType, state.targetEndpoint);
        },
        [dispatch, sendCommand, state.targetEndpoint],
    );

    const handleEndpointChange = useCallback(
        (value: string) => {
            dispatch({ type: 'SET_TARGET_ENDPOINT', payload: value });
        },
        [dispatch],
    );

    const handleTestConnection = useCallback(
        () => sendCommand('testConnection', state.targetType, state.targetEndpoint),
        [sendCommand, state.targetType, state.targetEndpoint],
    );

    const handleReset = useCallback(() => sendCommand('resetProject'), [sendCommand]);

    const handleInitGit = useCallback(() => sendCommand('initGitRepository'), [sendCommand]);

    const handleOpenFile = useCallback((filePath: string) => sendCommand('openFile', filePath), [sendCommand]);
    const handlePreviewMarkdown = useCallback(
        (filePath: string) => sendCommand('previewMarkdown', filePath),
        [sendCommand],
    );

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
                <Text size={500} weight="semibold">
                    {l10n.t('Migration Configuration')}
                </Text>
                <Text size={200}>
                    {l10n.t(
                        'Migrate your application from a relational database (RDBMS) to Azure Cosmos DB NoSQL with AI-assisted analysis. Follow the phases below to inventory your schema, analyze your application, and configure your target environment.',
                    )}
                </Text>

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
                    <Button appearance="secondary" onClick={handleInitGit}>
                        {l10n.t('Initialize Git Repository')}
                    </Button>
                </div>
            )}

            {/* Migration Phases */}
            <Accordion collapsible defaultOpenItems={['phase1']}>
                {/* Phase 1: Schema Inventory & Application Analysis */}
                <AccordionItem value="phase1">
                    <AccordionHeader icon={getPhaseIcon(phase1State)}>
                        <Text weight="semibold">{l10n.t('Phase 1: Schema Inventory & Application Analysis')}</Text>
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
                                    'Provide your database schema files, volumetric data, and access patterns, then run AI analysis to detect your project type, language, frameworks, and database access patterns.',
                                )}
                            </Text>

                            {/* Schema Files */}
                            <div className={styles.fileSection}>
                                <div className={styles.configRow}>
                                    <Text weight="semibold">
                                        {l10n.t('Database Schema Files')}{' '}
                                        <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                    </Text>
                                    <Tooltip
                                        content={l10n.t(
                                            'You can also copy schema files manually into the schema-ddl/ folder inside .cosmosdb-migration.',
                                        )}
                                        relationship="description"
                                        withArrow
                                    >
                                        <InfoRegular className={styles.infoIcon} />
                                    </Tooltip>
                                </div>
                                <Text size={200}>{l10n.t('Supported: .sql, .json, .xml, .csv, .log, .out')}</Text>
                                <div className={styles.configRow}>
                                    <Button appearance="secondary" onClick={handleSelectSchemaFiles}>
                                        {l10n.t('Select Files…')}
                                    </Button>
                                    <Button appearance="secondary" onClick={handleSelectSchemaFolder}>
                                        {l10n.t('Select Folder…')}
                                    </Button>
                                </div>
                                <FileListExpander
                                    files={state.schemaFiles}
                                    onOpenFile={handleOpenFile}
                                    styles={styles}
                                />
                            </div>

                            {/* Volumetric Files */}
                            <div className={styles.fileSection}>
                                <div className={styles.configRow}>
                                    <Text weight="semibold">{l10n.t('Volumetrics')}</Text>
                                    <Tooltip
                                        content={l10n.t(
                                            'You can also copy volumetric files manually into the volumetrics/ folder inside .cosmosdb-migration.',
                                        )}
                                        relationship="description"
                                        withArrow
                                    >
                                        <InfoRegular className={styles.infoIcon} />
                                    </Tooltip>
                                </div>
                                <Text size={200}>
                                    {l10n.t('Query logs, AWR reports: .txt, .csv, .json, .html, .xls')}
                                </Text>
                                <div className={styles.configRow}>
                                    <Button appearance="secondary" onClick={handleSelectVolumetricFiles}>
                                        {l10n.t('Select Files…')}
                                    </Button>
                                    <Button appearance="secondary" onClick={handleSelectVolumetricFolder}>
                                        {l10n.t('Select Folder…')}
                                    </Button>
                                </div>
                                <FileListExpander
                                    files={state.volumetricFiles}
                                    onOpenFile={handleOpenFile}
                                    styles={styles}
                                />
                            </div>

                            {/* Access Pattern Files */}
                            <div className={styles.fileSection}>
                                <div className={styles.configRow}>
                                    <Text weight="semibold">{l10n.t('Access Patterns')}</Text>
                                    <Tooltip
                                        content={l10n.t(
                                            'You can also copy access pattern files manually into the access-patterns/ folder inside .cosmosdb-migration.',
                                        )}
                                        relationship="description"
                                        withArrow
                                    >
                                        <InfoRegular className={styles.infoIcon} />
                                    </Tooltip>
                                </div>
                                <Text size={200}>{l10n.t('Markdown files describing access patterns (.md)')}</Text>
                                <div className={styles.configRow}>
                                    <Button appearance="secondary" onClick={handleSelectAccessPatternFiles}>
                                        {l10n.t('Select Files…')}
                                    </Button>
                                    <Button appearance="secondary" onClick={handleSelectAccessPatternFolder}>
                                        {l10n.t('Select Folder…')}
                                    </Button>
                                </div>
                                <FileListExpander
                                    files={state.accessPatternFiles}
                                    onOpenFile={handleOpenFile}
                                    styles={styles}
                                />
                            </div>

                            {/* Application Analysis */}
                            <div
                                style={{
                                    borderTop: '1px solid var(--vscode-panel-border)',
                                    paddingTop: '12px',
                                    marginTop: '4px',
                                }}
                            >
                                <Text weight="semibold">{l10n.t('Application Analysis')}</Text>
                            </div>

                            <Text size={200} className={styles.warningText}>
                                {l10n.t('Note: AI analysis may consume significant tokens for large codebases.')}
                            </Text>

                            {!state.consentGiven && (
                                <Text size={200} className={styles.warningText}>
                                    {l10n.t('Please check the AI consent checkbox above before running analysis.')}
                                </Text>
                            )}

                            {state.tokenEstimate && state.analysisState !== 'in-progress' && (
                                <Text size={200} style={{ color: 'var(--vscode-descriptionForeground)' }}>
                                    {l10n.t(
                                        'Estimated context: {0} / {1} tokens ({2}%)',
                                        formatTokenCount(state.tokenEstimate.tokens),
                                        formatTokenCount(state.tokenEstimate.maxTokens),
                                        ((state.tokenEstimate.tokens / state.tokenEstimate.maxTokens) * 100).toFixed(0),
                                    )}
                                </Text>
                            )}

                            {state.analysisState === 'in-progress' && (
                                <>
                                    <ProgressBar />
                                    <Button appearance="secondary" onClick={handleCancelAnalysis}>
                                        {l10n.t('Cancel')}
                                    </Button>
                                </>
                            )}

                            {state.analysisState !== 'in-progress' && (
                                <Button
                                    appearance="primary"
                                    icon={<PlayRegular />}
                                    onClick={handleAnalyze}
                                    disabled={isAnalyzeDisabled || !state.consentGiven || !state.isAIFeaturesEnabled}
                                >
                                    {state.analysisState === 'complete' ? l10n.t('Re-Analyze') : l10n.t('Analyze')}
                                </Button>
                            )}

                            {state.analysisError && (
                                <Text className={styles.errorText}>
                                    <DismissCircleRegular /> {state.analysisError}
                                </Text>
                            )}

                            {state.analysisResult && (
                                <div className={styles.analysisResult}>
                                    <Text className={styles.analysisLabel}>{l10n.t('Project:')}</Text>
                                    <Input
                                        size="small"
                                        value={state.analysisResult.projectName ?? ''}
                                        onChange={(_e, data) => handleAnalysisFieldChange('projectName', data.value)}
                                    />
                                    <Text className={styles.analysisLabel}>{l10n.t('Type:')}</Text>
                                    <Input
                                        size="small"
                                        value={state.analysisResult.projectType ?? ''}
                                        onChange={(_e, data) => handleAnalysisFieldChange('projectType', data.value)}
                                    />
                                    <Text className={styles.analysisLabel}>{l10n.t('Language:')}</Text>
                                    <Input
                                        size="small"
                                        value={state.analysisResult.language ?? ''}
                                        onChange={(_e, data) => handleAnalysisFieldChange('language', data.value)}
                                    />
                                    <Text className={styles.analysisLabel}>{l10n.t('Frameworks:')}</Text>
                                    <Input
                                        size="small"
                                        value={state.analysisResult.frameworks?.join(', ') ?? ''}
                                        onChange={(_e, data) => handleAnalysisFieldChange('frameworks', data.value)}
                                    />
                                    <Text className={styles.analysisLabel}>{l10n.t('Database:')}</Text>
                                    <Input
                                        size="small"
                                        value={state.analysisResult.databaseType ?? ''}
                                        onChange={(_e, data) => handleAnalysisFieldChange('databaseType', data.value)}
                                    />
                                    <Text className={styles.analysisLabel}>{l10n.t('Access Method:')}</Text>
                                    <Input
                                        size="small"
                                        value={state.analysisResult.databaseAccess ?? ''}
                                        onChange={(_e, data) => handleAnalysisFieldChange('databaseAccess', data.value)}
                                    />
                                    {phase1State === 'complete' && (
                                        <>
                                            <Text className={styles.analysisLabel}>{l10n.t('Report:')}</Text>
                                            <Link
                                                onClick={() =>
                                                    handlePreviewMarkdown(
                                                        `${state.workspacePath}/.cosmosdb-migration/phases/1-discovery/discovery-report.md`,
                                                    )
                                                }
                                            >
                                                {l10n.t('Discovery Report')}
                                            </Link>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </AccordionPanel>
                </AccordionItem>

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
                            <Text size={200}>
                                {l10n.t(
                                    'Run AI-powered domain decomposition to identify bounded contexts, group related tables, and generate Cosmos DB migration recommendations.',
                                )}
                            </Text>

                            {state.assessmentState === 'in-progress' && (
                                <>
                                    <ProgressBar />
                                    {state.assessmentProgress && (
                                        <Text size={200} style={{ color: 'var(--vscode-descriptionForeground)' }}>
                                            {state.assessmentProgress}
                                        </Text>
                                    )}
                                    <Button appearance="secondary" onClick={handleCancelAssessment}>
                                        {l10n.t('Cancel')}
                                    </Button>
                                </>
                            )}

                            {state.assessmentState !== 'in-progress' && (
                                <Button
                                    appearance="primary"
                                    icon={<PlayRegular />}
                                    onClick={handleRunAssessment}
                                    disabled={isPhase2Disabled || !state.consentGiven || !state.isAIFeaturesEnabled}
                                >
                                    {state.assessmentState === 'complete'
                                        ? l10n.t('Re-Run Assessment')
                                        : l10n.t('Run Assessment')}
                                </Button>
                            )}

                            {state.assessmentError && (
                                <Text className={styles.errorText}>
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
                                                <th style={{ padding: '6px 8px' }}>{l10n.t('Domain')}</th>
                                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>
                                                    {l10n.t('Tables')}
                                                </th>
                                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>
                                                    {l10n.t('Est. Tokens')}
                                                </th>
                                                <th style={{ padding: '6px 8px', textAlign: 'center' }}>
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
                                                    <td style={{ padding: '6px 8px' }}>
                                                        <Link
                                                            className={styles.fileLink}
                                                            onClick={() => handlePreviewMarkdown(domain.filePath)}
                                                        >
                                                            {domain.name}
                                                        </Link>
                                                    </td>
                                                    <td
                                                        style={{
                                                            padding: '6px 8px',
                                                            textAlign: 'right',
                                                            color: 'var(--vscode-descriptionForeground)',
                                                        }}
                                                    >
                                                        {domain.tables.length}
                                                    </td>
                                                    <td
                                                        style={{
                                                            padding: '6px 8px',
                                                            textAlign: 'right',
                                                            color: 'var(--vscode-descriptionForeground)',
                                                        }}
                                                    >
                                                        {formatTokenCount(domain.estimatedTokens)}
                                                    </td>
                                                    <td
                                                        style={{
                                                            padding: '6px 8px',
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
                                        onClick={() => handlePreviewMarkdown(state.assessmentResult!.summaryFilePath)}
                                    >
                                        {l10n.t('View full assessment summary')}
                                    </Link>
                                </div>
                            )}
                        </div>
                    </AccordionPanel>
                </AccordionItem>

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

                            {state.schemaConversionState === 'in-progress' && (
                                <>
                                    <ProgressBar />
                                    {state.schemaConversionProgress && (
                                        <Text size={200} style={{ color: 'var(--vscode-descriptionForeground)' }}>
                                            {state.schemaConversionProgress}
                                        </Text>
                                    )}
                                    <Button appearance="secondary" onClick={handleCancelSchemaConversion}>
                                        {l10n.t('Cancel')}
                                    </Button>
                                </>
                            )}

                            {state.schemaConversionState !== 'in-progress' && (
                                <Button
                                    appearance="primary"
                                    icon={<PlayRegular />}
                                    onClick={handleRunSchemaConversion}
                                    disabled={isPhase3Disabled || !state.consentGiven || !state.isAIFeaturesEnabled}
                                >
                                    {state.schemaConversionState === 'complete'
                                        ? l10n.t('Re-Run Schema Conversion')
                                        : l10n.t('Run Schema Conversion')}
                                </Button>
                            )}

                            {state.schemaConversionError && (
                                <Text className={styles.errorText}>
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
                                    <div className={styles.fileList}>
                                        {state.schemaConversionResult.domains.map((domain, i) => (
                                            <Text key={i} size={200}>
                                                {domain}
                                            </Text>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </AccordionPanel>
                </AccordionItem>

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
                                    <Input
                                        value={state.targetEndpoint}
                                        onChange={(_e, data) => handleEndpointChange(data.value)}
                                        placeholder={l10n.t('https://your-account.documents.azure.com:443/')}
                                        disabled={isPhase4Disabled}
                                    />
                                </Field>
                            )}

                            {state.targetType && (
                                <>
                                    {phase4State === 'in-progress' ? (
                                        <ProgressBar />
                                    ) : (
                                        <Button
                                            appearance="primary"
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

                            {state.connectionVerified && (
                                <Text>
                                    <CheckmarkCircleFilled style={{ color: 'var(--vscode-testing-iconPassed)' }} />{' '}
                                    {l10n.t('Connection verified successfully.')}
                                </Text>
                            )}

                            {state.connectionTestError && (
                                <Text className={styles.errorText}>
                                    <DismissCircleRegular /> {state.connectionTestError}
                                </Text>
                            )}
                        </div>
                    </AccordionPanel>
                </AccordionItem>
            </Accordion>

            {/* Footer */}
            <div className={styles.footer}>
                <Button appearance="secondary" onClick={handleReset}>
                    {l10n.t('Reset Project')}
                </Button>
                <Button appearance="primary" disabled={!allComplete}>
                    {l10n.t('Start Migration')}
                </Button>
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
