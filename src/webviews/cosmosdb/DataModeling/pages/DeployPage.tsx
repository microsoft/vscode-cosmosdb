/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Dropdown,
    Field,
    Input,
    makeStyles,
    Option,
    Radio,
    RadioGroup,
    Spinner,
    Text,
    tokens,
    useId,
} from '@fluentui/react-components';
import { ArrowUploadRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
    type DatabaseMode,
    type DeploymentContainer,
    type DeploymentOptions,
    type DeploymentRequest,
    type DeploymentTemplateInput,
    type ModelDeploymentResult,
    validateDeploymentDatabaseName,
} from '../../../../dataModeling/deploymentModel';
import { AlertDialog } from '../../../common/AlertDialog';
import { MonacoEditor, type MonacoEditorType } from '../../../MonacoEditor';

/** In-memory form state only. This is deliberately separate from the persisted modeling snapshot. */
export interface DeploymentDraft {
    deploymentMethod: 'direct' | 'bicep';
    databaseMode: DatabaseMode;
    newDatabaseName: string;
    existingDatabaseName: string;
    selectedContainers: string[];
    template: string;
    generatedTemplate: string;
    templateInputKey?: string;
}

export function createDeploymentDraft(containers: DeploymentContainer[]): DeploymentDraft {
    return {
        deploymentMethod: 'direct',
        databaseMode: 'new',
        newDatabaseName: '',
        existingDatabaseName: '',
        selectedContainers: containers.map((container) => container.entity),
        template: '',
        generatedTemplate: '',
    };
}

export interface DeployPageProps {
    containers: DeploymentContainer[];
    draft: DeploymentDraft;
    onDraftChange: Dispatch<SetStateAction<DeploymentDraft>>;
    loadOptions: () => Promise<DeploymentOptions>;
    generateTemplate: (input: DeploymentTemplateInput) => Promise<string>;
    onDeploy: (input: DeploymentRequest) => Promise<ModelDeploymentResult>;
    onBusyChange: (busy: boolean) => void;
    onDeployed: () => void;
}

const useStyles = makeStyles({
    stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, minWidth: 0 },
    panel: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        padding: tokens.spacingHorizontalL,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
        minWidth: 0,
    },
    targetStrip: {
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground3,
    },
    targetDetails: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalL, margin: 0 },
    targetItem: {
        display: 'flex',
        alignItems: 'baseline',
        gap: tokens.spacingHorizontalS,
        flex: '1 1 220px',
        minWidth: 0,
    },
    targetLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, whiteSpace: 'nowrap' },
    targetValue: {
        margin: 0,
        minWidth: 0,
        fontWeight: tokens.fontWeightSemibold,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    sectionTitle: { margin: 0, fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300 },
    caption: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
    containerGroup: {
        border: 'none',
        padding: 0,
        margin: 0,
        minWidth: 0,
    },
    containerChoices: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM },
    databaseField: { maxWidth: '480px' },
    templateHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalM,
    },
    templateBody: { display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 },
    editor: {
        height: '240px',
        minWidth: 0,
        overflow: 'hidden',
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalM, alignItems: 'center' },
    deployActions: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: tokens.spacingHorizontalL,
        paddingTop: tokens.spacingVerticalM,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    deploySlot: { display: 'flex', alignItems: 'center', minWidth: '140px', minHeight: '32px' },
    status: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
});

const EDITOR_OPTIONS: MonacoEditorType.editor.IStandaloneEditorConstructionOptions = {
    readOnly: false,
    domReadOnly: false,
    ariaLabel: l10n.t('Bicep deployment template'),
    tabFocusMode: true,
    minimap: { enabled: false },
    lineNumbers: 'on',
    folding: true,
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    scrollbar: { vertical: 'visible', horizontal: 'auto', alwaysConsumeMouseWheel: false },
};

function deploymentErrorDetail(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (
        /^No procedure found on path "dataModeling\.(getDeploymentOptions|generateDeploymentTemplate|deploy)"$/.test(
            message,
        )
    ) {
        return l10n.t(
            'The webview is newer than the running extension host. In the window running this modeler, run Developer: Reload Window or restart the Extension Development Host, then reopen the Data Modeler. Webview hot reload alone does not update host code.',
        );
    }
    return message;
}

export function DeployPage({
    containers,
    draft,
    onDraftChange,
    loadOptions,
    generateTemplate,
    onDeploy,
    onBusyChange,
    onDeployed,
}: DeployPageProps) {
    const styles = useStyles();
    const databaseGroupId = useId('database-mode');
    const containersLabelId = useId('deployment-containers');
    const methodLabelId = useId('deployment-method');
    const templateLabelId = useId('deployment-template');
    const [options, setOptions] = useState<DeploymentOptions>();
    const [optionsError, setOptionsError] = useState('');
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [generating, setGenerating] = useState(false);
    const [templateError, setTemplateError] = useState('');
    const [regenerateKey, setRegenerateKey] = useState<string>();
    const [generationAttempt, setGenerationAttempt] = useState(0);
    const [confirmRegenerate, setConfirmRegenerate] = useState(false);
    const regenerateButtonRef = useRef<HTMLButtonElement>(null);
    const restoreRegenerateFocus = useRef(false);
    const [deploying, setDeploying] = useState(false);
    const deployingRef = useRef(false);
    const deployButtonRef = useRef<HTMLButtonElement>(null);
    const deploymentStatusRef = useRef<HTMLOutputElement>(null);
    const restoreDeployFocus = useRef(false);
    const [deploymentMessage, setDeploymentMessage] = useState('');
    const [deploymentError, setDeploymentError] = useState('');
    const [copyMessage, setCopyMessage] = useState('');

    useEffect(() => {
        if (deploying) {
            deploymentStatusRef.current?.focus();
        } else if (restoreDeployFocus.current) {
            deployButtonRef.current?.focus();
            restoreDeployFocus.current = false;
        }
    }, [deploying]);

    useEffect(() => {
        if (!confirmRegenerate && !generating && restoreRegenerateFocus.current) {
            const frame = requestAnimationFrame(() => {
                regenerateButtonRef.current?.focus();
                restoreRegenerateFocus.current = false;
            });
            return () => cancelAnimationFrame(frame);
        }
        return undefined;
    }, [confirmRegenerate, generating]);

    useEffect(() => {
        let disposed = false;
        setOptions(undefined);
        setOptionsError('');
        void loadOptions().then(
            (value) => {
                if (!disposed) {
                    setOptions(value);
                }
            },
            (error: unknown) => {
                if (!disposed) {
                    setOptionsError(
                        l10n.t('Could not load deployment databases. {error}', {
                            error: deploymentErrorDetail(error),
                        }),
                    );
                }
            },
        );
        return () => {
            disposed = true;
        };
    }, [loadOptions, loadAttempt]);

    const input = useMemo<DeploymentTemplateInput>(
        () => ({
            databaseMode: draft.databaseMode,
            databaseName: draft.databaseMode === 'new' ? draft.newDatabaseName.trim() : draft.existingDatabaseName,
            containers: containers
                .filter((container) => draft.selectedContainers.includes(container.entity))
                .map(({ entity, partitionKey }) => ({ entity, partitionKey })),
        }),
        [containers, draft.databaseMode, draft.existingDatabaseName, draft.newDatabaseName, draft.selectedContainers],
    );
    const inputKey = JSON.stringify(input);
    const nameError =
        draft.databaseMode === 'new'
            ? (validateDeploymentDatabaseName(input.databaseName) ??
              (options?.databases.includes(input.databaseName)
                  ? l10n.t('This database already exists. Select Existing database to use it.')
                  : undefined))
            : !options?.databases.includes(input.databaseName)
              ? l10n.t('Select an existing database.')
              : undefined;
    const selectionError =
        input.containers.length === 0 ? l10n.t('Select at least one container to deploy.') : undefined;
    const valid = !!options && !options.unavailableReason && !nameError && !selectionError;
    const useBicep = draft.deploymentMethod === 'bicep';
    const customized = draft.template !== draft.generatedTemplate;
    const templateCurrent = draft.templateInputKey === inputKey;
    const canDeploy = valid && !useBicep && !deploying;

    useEffect(() => {
        let disposed = false;
        const force = regenerateKey === inputKey;
        if (!useBicep || !valid || (!force && (customized || templateCurrent))) {
            setGenerating(false);
            return;
        }
        setGenerating(true);
        setTemplateError('');
        const timer = setTimeout(() => {
            void generateTemplate(input).then(
                (template) => {
                    if (disposed) return;
                    onDraftChange((previous) => ({
                        ...previous,
                        template,
                        generatedTemplate: template,
                        templateInputKey: inputKey,
                    }));
                    setRegenerateKey(undefined);
                    setGenerating(false);
                },
                (error: unknown) => {
                    if (disposed) return;
                    setTemplateError(
                        l10n.t('Could not generate the Bicep template. {error}', {
                            error: deploymentErrorDetail(error),
                        }),
                    );
                    setGenerating(false);
                },
            );
        }, 250);
        return () => {
            disposed = true;
            clearTimeout(timer);
        };
    }, [
        input,
        inputKey,
        valid,
        useBicep,
        customized,
        templateCurrent,
        regenerateKey,
        generationAttempt,
        generateTemplate,
        onDraftChange,
    ]);

    useEffect(() => {
        setDeploymentMessage('');
        setDeploymentError('');
        setCopyMessage('');
    }, [inputKey, draft.template, useBicep]);

    const requestRegeneration = () => {
        setRegenerateKey(inputKey);
        setGenerationAttempt((attempt) => attempt + 1);
    };

    const deploy = async () => {
        if (!canDeploy || deployingRef.current) return;
        deployingRef.current = true;
        restoreDeployFocus.current = true;
        setDeploying(true);
        onBusyChange(true);
        setDeploymentMessage('');
        setDeploymentError('');
        try {
            const result = await onDeploy(input);
            if (result.status === 'deployed') {
                setDeploymentMessage(
                    l10n.t(
                        'Data model deployed to "{database}": {created} container(s) created, {existing} left unchanged.',
                        {
                            database: result.databaseName,
                            created: result.createdCount,
                            existing: result.existingCount,
                        },
                    ),
                );
                onDeployed();
            } else {
                setDeploymentMessage(l10n.t('Deployment cancelled. No deployment was started.'));
            }
        } catch (error) {
            setDeploymentError(
                l10n.t('Deployment failed. {error}', {
                    error: deploymentErrorDetail(error),
                }),
            );
        } finally {
            deployingRef.current = false;
            setDeploying(false);
            onBusyChange(false);
        }
    };

    const editorOptions = useMemo(
        () => ({
            ...EDITOR_OPTIONS,
            readOnly: deploying || generating,
            domReadOnly: deploying || generating,
        }),
        [deploying, generating],
    );

    const copyBicep = async () => {
        try {
            await navigator.clipboard.writeText(draft.template);
            setCopyMessage(l10n.t('Bicep copied.'));
        } catch (error) {
            setTemplateError(l10n.t('Could not copy Bicep. {error}', { error: deploymentErrorDetail(error) }));
        }
    };

    return (
        <div className={styles.stack}>
            <section className={styles.targetStrip} aria-label={l10n.t('Deployment target')}>
                <dl className={styles.targetDetails}>
                    <div className={styles.targetItem}>
                        <dt className={styles.targetLabel}>{l10n.t('Subscription:')}</dt>
                        <dd className={styles.targetValue} title={options?.subscriptionName}>
                            {options?.subscriptionName ?? l10n.t('Not available')}
                        </dd>
                    </div>
                    <div className={styles.targetItem}>
                        <dt className={styles.targetLabel}>{l10n.t('Resource group:')}</dt>
                        <dd className={styles.targetValue} title={options?.resourceGroup}>
                            {options?.resourceGroup ?? l10n.t('Not available')}
                        </dd>
                    </div>
                    <div className={styles.targetItem}>
                        <dt className={styles.targetLabel}>{l10n.t('Account:')}</dt>
                        <dd className={styles.targetValue} title={options?.accountName}>
                            {options?.accountName ?? l10n.t('Not available')}
                        </dd>
                    </div>
                </dl>
            </section>
            {!options && !optionsError ? <output aria-live="polite">{l10n.t('Loading databases...')}</output> : null}
            {optionsError ? (
                <div className={styles.status}>
                    <Text role="alert">{optionsError}</Text>
                    <Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                        {l10n.t('Retry loading databases')}
                    </Button>
                </div>
            ) : null}
            {options?.unavailableReason ? <Text role="alert">{options.unavailableReason}</Text> : null}

            <section className={styles.panel} aria-labelledby={databaseGroupId}>
                <Text as="h3" id={databaseGroupId} className={styles.sectionTitle}>
                    {l10n.t('Choose database')}
                </Text>
                <RadioGroup
                    aria-labelledby={databaseGroupId}
                    layout="horizontal"
                    value={draft.databaseMode}
                    disabled={deploying}
                    onChange={(_, data) => {
                        if (data.value === 'new' || data.value === 'existing') {
                            const databaseMode = data.value;
                            onDraftChange((previous) => ({ ...previous, databaseMode }));
                        }
                    }}
                >
                    <Radio value="new" label={l10n.t('New database')} />
                    <Radio value="existing" label={l10n.t('Existing database')} />
                </RadioGroup>
                {draft.databaseMode === 'new' ? (
                    <Field
                        label={l10n.t('New database name')}
                        validationMessage={nameError}
                        validationState={nameError ? 'error' : 'none'}
                        className={styles.databaseField}
                        required
                    >
                        <Input
                            value={draft.newDatabaseName}
                            disabled={deploying}
                            onChange={(_, data) =>
                                onDraftChange((previous) => ({ ...previous, newDatabaseName: data.value }))
                            }
                        />
                    </Field>
                ) : (
                    <Field
                        label={l10n.t('Existing database')}
                        validationMessage={nameError}
                        validationState={nameError ? 'error' : 'none'}
                        className={styles.databaseField}
                        required
                    >
                        <Dropdown
                            value={draft.existingDatabaseName}
                            selectedOptions={draft.existingDatabaseName ? [draft.existingDatabaseName] : []}
                            placeholder={l10n.t('Select a database')}
                            disabled={deploying || !options || options.databases.length === 0}
                            onOptionSelect={(_, data) => {
                                if (data.optionValue !== undefined) {
                                    const existingDatabaseName = data.optionValue;
                                    onDraftChange((previous) => ({ ...previous, existingDatabaseName }));
                                }
                            }}
                        >
                            {options?.databases.map((name) => (
                                <Option key={name} value={name}>
                                    {name}
                                </Option>
                            ))}
                        </Dropdown>
                    </Field>
                )}
                {draft.databaseMode === 'existing' && options && options.databases.length === 0 ? (
                    <Text>{l10n.t('This account has no databases. Choose New database to create one.')}</Text>
                ) : null}
            </section>

            <section className={styles.panel} aria-labelledby={containersLabelId}>
                <Text as="h3" id={containersLabelId} className={styles.sectionTitle}>
                    {l10n.t('Choose containers to deploy')}
                </Text>
                <fieldset className={styles.containerGroup} aria-labelledby={containersLabelId}>
                    <div className={styles.containerChoices}>
                        {containers.map((container) => (
                            <Checkbox
                                key={container.entity}
                                label={container.entity}
                                checked={draft.selectedContainers.includes(container.entity)}
                                disabled={deploying}
                                onChange={(_, data) =>
                                    onDraftChange((previous) => ({
                                        ...previous,
                                        selectedContainers: data.checked
                                            ? [...previous.selectedContainers, container.entity]
                                            : previous.selectedContainers.filter((name) => name !== container.entity),
                                    }))
                                }
                            />
                        ))}
                    </div>
                    {selectionError ? <Text role="alert">{selectionError}</Text> : null}
                </fieldset>
            </section>

            <section className={styles.panel} aria-labelledby={methodLabelId}>
                <Text as="h3" id={methodLabelId} className={styles.sectionTitle}>
                    {l10n.t('Deployment method')}
                </Text>
                <RadioGroup
                    aria-labelledby={methodLabelId}
                    layout="horizontal"
                    value={useBicep ? 'bicep' : 'direct'}
                    disabled={deploying}
                    onChange={(_, data) => {
                        if (data.value === 'direct' || data.value === 'bicep') {
                            const deploymentMethod = data.value;
                            onDraftChange((previous) => ({ ...previous, deploymentMethod }));
                        }
                    }}
                >
                    <Radio value="direct" label={l10n.t('Deploy now')} />
                    <Radio value="bicep" label={l10n.t('Deploy with Biceps')} />
                </RadioGroup>
                {useBicep ? (
                    <section className={styles.stack} aria-labelledby={templateLabelId}>
                        <div className={styles.templateHeader}>
                            <Text as="h3" id={templateLabelId} className={styles.sectionTitle}>
                                {l10n.t('Bicep deployment template')}
                            </Text>
                            <div className={styles.actions}>
                                <Button
                                    size="small"
                                    disabled={!draft.template || deploying || generating}
                                    onClick={() => void copyBicep()}
                                >
                                    {l10n.t('Copy Bicep')}
                                </Button>
                                <Button
                                    size="small"
                                    ref={regenerateButtonRef}
                                    disabled={!valid || deploying || generating}
                                    onClick={() => (customized ? setConfirmRegenerate(true) : requestRegeneration())}
                                >
                                    {l10n.t('Regenerate template')}
                                </Button>
                            </div>
                        </div>
                        <div className={styles.templateBody}>
                            <Text className={styles.caption}>
                                {l10n.t(
                                    'Edit and copy this Bicep template for manual deployment with your own tooling. This option does not deploy resources from the wizard.',
                                )}
                            </Text>
                            {customized && !templateCurrent ? (
                                <Text role="alert">
                                    {l10n.t(
                                        'Your custom template has been kept. Regenerate it to match the current database and container selection. Regeneration replaces your edits.',
                                    )}
                                </Text>
                            ) : null}
                            {templateError ? <Text role="alert">{templateError}</Text> : null}
                            <output aria-live="polite">{copyMessage}</output>
                            <output aria-live="polite">
                                {generating ? l10n.t('Generating Bicep template...') : ''}
                            </output>
                            <div className={styles.editor}>
                                <MonacoEditor
                                    language="bicep"
                                    value={draft.template}
                                    options={editorOptions}
                                    onChange={(value) =>
                                        onDraftChange((previous) => ({ ...previous, template: value ?? '' }))
                                    }
                                />
                            </div>
                        </div>
                    </section>
                ) : (
                    <div className={styles.deployActions}>
                        <div className={styles.deploySlot}>
                            {deploying ? (
                                <output ref={deploymentStatusRef} tabIndex={-1} aria-live="polite">
                                    <Spinner size="small" labelPosition="after" label={l10n.t('Deploying...')} />
                                </output>
                            ) : (
                                <Button
                                    ref={deployButtonRef}
                                    appearance="primary"
                                    icon={<ArrowUploadRegular />}
                                    disabled={!canDeploy}
                                    onClick={() => void deploy()}
                                >
                                    {l10n.t('Deploy')}
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </section>
            <div className={styles.status}>
                <output aria-live="polite">{deploymentMessage}</output>
                {deploymentError ? <Text role="alert">{deploymentError}</Text> : null}
            </div>
            <AlertDialog
                isOpen={confirmRegenerate}
                title={l10n.t('Replace your template edits?')}
                confirmButtonText={l10n.t('Regenerate template')}
                cancelButtonText={l10n.t('Cancel')}
                onClose={(confirmed) => {
                    restoreRegenerateFocus.current = true;
                    setConfirmRegenerate(false);
                    if (confirmed) requestRegeneration();
                }}
            >
                {l10n.t(
                    'Regenerating the Bicep template replaces your custom edits with a template for the selected database and containers.',
                )}
            </AlertDialog>
        </div>
    );
}
