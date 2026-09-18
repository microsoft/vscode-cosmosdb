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
    mergeClasses,
    Option,
    Radio,
    RadioGroup,
    Spinner,
    Text,
    tokens,
    useId,
} from '@fluentui/react-components';
import { ArrowUploadRegular, CheckmarkCircleFilled, OpenRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
    type DatabaseMode,
    type DeploymentContainer,
    type DeploymentOptions,
    type DeploymentRequest,
    type DeploymentTemplateInput,
    type ModelDeploymentResult,
    type SuccessfulDeployment,
    validateDeploymentDatabaseName,
} from '../../../../dataModeling/deploymentModel';
import { AlertDialog } from '../../../common/AlertDialog';
import { MonacoEditor, type MonacoEditorType } from '../../../MonacoEditor';

/** Editable draft retained across step navigation. Only a successful deployment is saved in the modeling snapshot. */
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

export function createDeploymentDraft(
    containers: DeploymentContainer[],
    deployment?: SuccessfulDeployment,
): DeploymentDraft {
    return {
        deploymentMethod: 'direct',
        databaseMode: deployment?.input.databaseMode ?? 'new',
        newDatabaseName: deployment?.input.databaseMode === 'new' ? deployment.input.databaseName : '',
        existingDatabaseName: deployment?.input.databaseMode === 'existing' ? deployment.input.databaseName : '',
        selectedContainers: (deployment?.input.containers ?? containers).map((container) => container.entity),
        template: '',
        generatedTemplate: '',
    };
}

/** Structural equality of the fields identifying a deployment target, independent of object key order. */
function sameDeploymentInput(a: DeploymentTemplateInput, b: DeploymentTemplateInput): boolean {
    return (
        a.databaseMode === b.databaseMode &&
        a.databaseName === b.databaseName &&
        a.containers.length === b.containers.length &&
        a.containers.every(
            (container, index) =>
                container.entity === b.containers[index]?.entity &&
                container.partitionKey === b.containers[index]?.partitionKey,
        )
    );
}

export interface DeployPageProps {
    containers: DeploymentContainer[];
    draft: DeploymentDraft;
    /** The last successful deployment for this recommendation, persisted in the modeling snapshot. */
    deployment?: SuccessfulDeployment;
    onDraftChange: Dispatch<SetStateAction<DeploymentDraft>>;
    loadOptions: () => Promise<DeploymentOptions>;
    generateTemplate: (input: DeploymentTemplateInput) => Promise<string>;
    onDeploy: (input: DeploymentRequest) => Promise<ModelDeploymentResult>;
    onOpenDataExplorer: (input: { databaseId: string; containerId: string }) => Promise<void>;
    onBusyChange: (busy: boolean) => void;
    /** Persist a successful deployment, or clear it (undefined) when a new deploy begins. */
    onDeploymentChange: (deployment: SuccessfulDeployment | undefined) => void;
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
    successCard: {
        borderLeft: `4px solid ${tokens.colorPaletteGreenForeground1}`,
        gap: tokens.spacingVerticalM,
    },
    successHeader: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
    successIcon: { color: tokens.colorPaletteGreenForeground1, fontSize: '24px', flexShrink: 0 },
    successTitle: {
        margin: 0,
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
    successMessage: { overflowWrap: 'anywhere', color: tokens.colorNeutralForeground2 },
    explorerButton: { alignSelf: 'flex-start', maxWidth: '100%' },
    containerNames: { fontFamily: tokens.fontFamilyMonospace },
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
        /^No procedure found on path "dataModeling\.(getDeploymentOptions|generateDeploymentTemplate|deploy|openDataExplorer)"$/.test(
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
    deployment,
    onDraftChange,
    loadOptions,
    generateTemplate,
    onDeploy,
    onOpenDataExplorer,
    onBusyChange,
    onDeploymentChange,
}: DeployPageProps) {
    const styles = useStyles();
    const databaseGroupId = useId('database-mode');
    const containersLabelId = useId('deployment-containers');
    const methodLabelId = useId('deployment-method');
    const templateLabelId = useId('deployment-template');
    const successTitleId = useId('deployment-success');
    const [options, setOptions] = useState<DeploymentOptions>();
    const [optionsError, setOptionsError] = useState('');
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [showDatabaseValidation, setShowDatabaseValidation] = useState(false);
    const newDatabaseNameRef = useRef<HTMLInputElement>(null);
    const existingDatabaseNameRef = useRef<HTMLButtonElement>(null);
    const [generating, setGenerating] = useState(false);
    const [templateError, setTemplateError] = useState('');
    const [regenerateKey, setRegenerateKey] = useState<string>();
    const [generationAttempt, setGenerationAttempt] = useState(0);
    const [confirmRegenerate, setConfirmRegenerate] = useState(false);
    const regenerateButtonRef = useRef<HTMLButtonElement>(null);
    const restoreRegenerateFocus = useRef(false);
    const [confirmDeploy, setConfirmDeploy] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const deployingRef = useRef(false);
    const deployButtonRef = useRef<HTMLButtonElement>(null);
    const deploymentStatusRef = useRef<HTMLOutputElement>(null);
    const restoreDeployFocus = useRef(false);
    const [deploymentNotice, setDeploymentNotice] = useState('');
    const [deploymentError, setDeploymentError] = useState('');
    const [openingExplorer, setOpeningExplorer] = useState(false);
    const [explorerError, setExplorerError] = useState('');
    const [copyMessage, setCopyMessage] = useState('');

    useEffect(() => {
        if (deploying) {
            deploymentStatusRef.current?.focus();
        } else if (!confirmDeploy && restoreDeployFocus.current) {
            deployButtonRef.current?.focus();
            restoreDeployFocus.current = false;
        }
    }, [confirmDeploy, deploying]);

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
    // A persisted deployment matching the current target (direct mode) drives the green success card.
    const completedDeployment =
        deployment && !useBicep && sameDeploymentInput(deployment.input, input) ? deployment : undefined;
    const deployedTarget = completedDeployment
        ? {
              databaseId: completedDeployment.result.databaseName,
              containerId: completedDeployment.input.containers[0].entity,
          }
        : undefined;
    const deploymentMessage = completedDeployment
        ? l10n.t('Data model deployed to "{database}": {created} container(s) created, {existing} left unchanged.', {
              database: completedDeployment.result.databaseName,
              created: completedDeployment.result.createdCount,
              existing: completedDeployment.result.existingCount,
          })
        : deploymentNotice;
    const nameValidationMessage = showDatabaseValidation || useBicep ? nameError : undefined;
    const customized = draft.template !== draft.generatedTemplate;
    const templateCurrent = draft.templateInputKey === inputKey;
    const canAttemptDeploy = !!options && !options.unavailableReason && !selectionError && !useBicep && !deploying;

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
        setDeploymentNotice('');
        setDeploymentError('');
        setExplorerError('');
        setCopyMessage('');
    }, [inputKey, draft.template, useBicep]);

    const requestRegeneration = () => {
        setRegenerateKey(inputKey);
        setGenerationAttempt((attempt) => attempt + 1);
    };

    const requestDeployment = () => {
        if (!canAttemptDeploy || deployingRef.current) return;
        setShowDatabaseValidation(true);
        if (nameError) {
            if (draft.databaseMode === 'new') {
                newDatabaseNameRef.current?.focus();
            } else {
                existingDatabaseNameRef.current?.focus();
            }
            return;
        }
        setConfirmDeploy(true);
    };

    const deploy = async () => {
        if (!canAttemptDeploy || deployingRef.current) return;
        deployingRef.current = true;
        restoreDeployFocus.current = true;
        setDeploying(true);
        onBusyChange(true);
        setDeploymentNotice('');
        setDeploymentError('');
        setExplorerError('');
        onDeploymentChange(undefined);
        try {
            const result = await onDeploy(input);
            if (result.status === 'deployed') {
                onDeploymentChange({ input, result });
            } else {
                setDeploymentNotice(l10n.t('Deployment cancelled. No deployment was started.'));
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

    const openDataExplorer = async () => {
        if (!deployedTarget || openingExplorer) return;
        setOpeningExplorer(true);
        setExplorerError('');
        try {
            await onOpenDataExplorer(deployedTarget);
        } catch (error) {
            setExplorerError(l10n.t('Could not open Data Explorer. {error}', { error: deploymentErrorDetail(error) }));
        } finally {
            setOpeningExplorer(false);
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
                        validationMessage={nameValidationMessage}
                        validationState={nameValidationMessage ? 'error' : 'none'}
                        className={styles.databaseField}
                        required
                    >
                        <Input
                            ref={newDatabaseNameRef}
                            value={draft.newDatabaseName}
                            disabled={deploying}
                            onChange={(_, data) => {
                                setShowDatabaseValidation(true);
                                onDraftChange((previous) => ({ ...previous, newDatabaseName: data.value }));
                            }}
                        />
                    </Field>
                ) : (
                    <Field
                        label={l10n.t('Existing database')}
                        validationMessage={nameValidationMessage}
                        validationState={nameValidationMessage ? 'error' : 'none'}
                        className={styles.databaseField}
                        required
                    >
                        <Dropdown
                            ref={existingDatabaseNameRef}
                            value={draft.existingDatabaseName}
                            selectedOptions={draft.existingDatabaseName ? [draft.existingDatabaseName] : []}
                            placeholder={l10n.t('Select a database')}
                            disabled={deploying || !options || options.databases.length === 0}
                            onOptionSelect={(_, data) => {
                                if (data.optionValue !== undefined) {
                                    const existingDatabaseName = data.optionValue;
                                    setShowDatabaseValidation(true);
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
                                    disabled={!canAttemptDeploy}
                                    onClick={requestDeployment}
                                >
                                    {l10n.t('Deploy')}
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </section>
            <section
                className={deployedTarget ? mergeClasses(styles.panel, styles.successCard) : styles.status}
                aria-labelledby={deployedTarget ? successTitleId : undefined}
            >
                {deployedTarget ? (
                    <div className={styles.successHeader}>
                        <CheckmarkCircleFilled aria-hidden className={styles.successIcon} />
                        <h3 id={successTitleId} className={styles.successTitle}>
                            {l10n.t('Deployment successful')}
                        </h3>
                    </div>
                ) : null}
                <output aria-live="polite" className={deployedTarget ? styles.successMessage : undefined}>
                    {deploymentMessage}
                </output>
                {deployedTarget ? (
                    <Button
                        className={styles.explorerButton}
                        appearance="secondary"
                        icon={<OpenRegular aria-hidden />}
                        disabled={openingExplorer}
                        aria-description={l10n.t('Open Data Explorer for this account in the Azure portal.')}
                        onClick={() => void openDataExplorer()}
                    >
                        {l10n.t('Open in Data Explorer')}
                    </Button>
                ) : null}
                {explorerError ? <Text role="alert">{explorerError}</Text> : null}
                {deploymentError ? <Text role="alert">{deploymentError}</Text> : null}
            </section>
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
            <AlertDialog
                isOpen={confirmDeploy}
                title={l10n.t('Deploy data model to "{database}" in "{account}"?', {
                    database: input.databaseName,
                    account: options?.accountName ?? l10n.t('this account'),
                })}
                confirmButtonText={l10n.t('Deploy')}
                cancelButtonText={l10n.t('Cancel')}
                onClose={(confirmed) => {
                    setConfirmDeploy(false);
                    if (confirmed) {
                        void deploy();
                    } else {
                        restoreDeployFocus.current = true;
                    }
                }}
            >
                <>
                    {l10n.t('Deploy {count} selected container(s):', { count: input.containers.length })}{' '}
                    <span className={styles.containerNames}>
                        {input.containers.map((container) => container.entity).join(', ')}.
                    </span>
                    <br />
                    {l10n.t('Matching existing containers are left unchanged.')}
                </>
            </AlertDialog>
        </div>
    );
}
