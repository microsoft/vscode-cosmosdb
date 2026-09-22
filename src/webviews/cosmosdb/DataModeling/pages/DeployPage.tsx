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
import { ArrowUploadRegular, CheckmarkCircleFilled, CopyRegular, OpenRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
    type DatabaseMode,
    type DeploymentContainer,
    type DeploymentOptions,
    type DeploymentRequest,
    type DeploymentTemplateInput,
    type DeploymentTemplateFormat,
    type GenerateDeploymentTemplateInput,
    type ModelDeploymentResult,
    type SuccessfulDeployment,
    validateDeploymentDatabaseName,
} from '../../../../dataModeling/deploymentModel';
import { MonacoEditor, type MonacoEditorType } from '../../../MonacoEditor';
import { useNativeConfirmation } from '../useNativeConfirmation';

/** Editable draft retained across step navigation. Only a successful deployment is saved in the modeling snapshot. */
interface TemplateDraft {
    template: string;
    generatedTemplate: string;
    templateInputKey?: string;
}

export interface DeploymentDraft {
    deploymentMethod: 'direct' | DeploymentTemplateFormat;
    databaseMode: DatabaseMode;
    newDatabaseName: string;
    existingDatabaseName: string;
    selectedContainers: string[];
    templates: Record<DeploymentTemplateFormat, TemplateDraft>;
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
        templates: {
            bicep: { template: '', generatedTemplate: '' },
            terraform: { template: '', generatedTemplate: '' },
            sdk: { template: '', generatedTemplate: '' },
        },
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
    generateTemplate: (input: GenerateDeploymentTemplateInput) => Promise<string>;
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
    methods: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
    method: {
        flex: '1 1 130px',
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
        padding: tokens.spacingVerticalXS,
    },
    selectedMethod: {
        border: `1px solid ${tokens.colorBrandStroke1}`,
        backgroundColor: tokens.colorBrandBackground2,
    },
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
    templateTitle: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS },
    templateBody: { display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 },
    editor: {
        height: '320px',
        padding: tokens.spacingHorizontalS,
        boxSizing: 'border-box',
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
});

const EDITOR_OPTIONS: MonacoEditorType.editor.IStandaloneEditorConstructionOptions = {
    readOnly: false,
    domReadOnly: false,
    tabFocusMode: true,
    minimap: { enabled: false },
    lineNumbers: 'on',
    folding: true,
    stickyScroll: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    scrollbar: { vertical: 'visible', horizontal: 'auto', alwaysConsumeMouseWheel: false },
};

const EXPORT_METHODS: Record<
    DeploymentTemplateFormat,
    { label: string; title: string; language: string; fileName: string; description: string }
> = {
    bicep: {
        label: 'Bicep',
        title: l10n.t('Bicep deployment template'),
        language: 'bicep',
        fileName: 'main.bicep',
        description: l10n.t('Review and copy the template, then deploy it with your Bicep tooling.'),
    },
    terraform: {
        label: 'Terraform',
        title: l10n.t('Terraform configuration'),
        language: 'hcl',
        fileName: 'main.tf',
        description: l10n.t('Review and copy the configuration, then initialize, plan, and apply it with Terraform.'),
    },
    sdk: {
        label: l10n.t('C# SDK'),
        title: l10n.t('C# SDK deployment code'),
        language: 'csharp',
        fileName: 'Program.cs',
        description: l10n.t(
            'Review and copy the code, then run it in your .NET project using Azure management permissions. This export targets Azure, not the emulator.',
        ),
    },
};
const TEMPLATE_FORMATS: DeploymentTemplateFormat[] = ['bicep', 'terraform', 'sdk'];

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
    const { confirm, confirmationError, confirming } = useNativeConfirmation();
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
    const regenerateButtonRef = useRef<HTMLButtonElement>(null);
    const restoreRegenerateFocus = useRef(false);
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
        } else if (!confirming && restoreDeployFocus.current) {
            deployButtonRef.current?.focus();
            restoreDeployFocus.current = false;
        }
    }, [confirming, deploying]);

    useEffect(() => {
        if (!confirming && !generating && restoreRegenerateFocus.current) {
            const frame = requestAnimationFrame(() => {
                regenerateButtonRef.current?.focus();
                restoreRegenerateFocus.current = false;
            });
            return () => cancelAnimationFrame(frame);
        }
        return undefined;
    }, [confirming, generating]);

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
    const format = draft.deploymentMethod === 'direct' ? undefined : draft.deploymentMethod;
    const exportMethod = format ? EXPORT_METHODS[format] : undefined;
    const templateDraft = format ? draft.templates[format] : undefined;
    const template = templateDraft?.template ?? '';
    // A persisted deployment matching the current target (direct mode) drives the green success card.
    const completedDeployment =
        deployment && !format && sameDeploymentInput(deployment.input, input) ? deployment : undefined;
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
    const nameValidationMessage = showDatabaseValidation || format ? nameError : undefined;
    const customized = templateDraft !== undefined && template !== templateDraft.generatedTemplate;
    const templateCurrent = templateDraft?.templateInputKey === inputKey;
    const generationKey = `${format}:${inputKey}`;
    const canAttemptDeploy =
        !!options && !options.unavailableReason && !selectionError && !format && !deploying && !confirming;

    useEffect(() => {
        let disposed = false;
        const force = regenerateKey === generationKey;
        if (!format || !valid || (!force && (customized || templateCurrent))) {
            setGenerating(false);
            return;
        }
        setGenerating(true);
        setTemplateError('');
        const timer = setTimeout(() => {
            void generateTemplate({ ...input, format }).then(
                (template) => {
                    if (disposed) return;
                    onDraftChange((previous) => ({
                        ...previous,
                        templates: {
                            ...previous.templates,
                            [format]: { template, generatedTemplate: template, templateInputKey: inputKey },
                        },
                    }));
                    setRegenerateKey(undefined);
                    setGenerating(false);
                },
                (error: unknown) => {
                    if (disposed) return;
                    setTemplateError(
                        l10n.t('Could not generate deployment code. {error}', {
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
        format,
        generationKey,
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
    }, [inputKey, template, format]);

    useEffect(() => {
        setTemplateError('');
    }, [format, inputKey]);

    const requestRegeneration = () => {
        setRegenerateKey(generationKey);
        setGenerationAttempt((attempt) => attempt + 1);
    };

    const confirmRegeneration = async () => {
        if (confirming) return;
        if (!customized) {
            requestRegeneration();
            return;
        }
        restoreRegenerateFocus.current = true;
        onBusyChange(true);
        try {
            const confirmed = await confirm(
                l10n.t('Replace your code edits?'),
                l10n.t(
                    'Regenerating replaces your edits for this method with code for the selected database and containers.',
                ),
            );
            if (confirmed === true) requestRegeneration();
        } finally {
            onBusyChange(false);
        }
    };

    const requestDeployment = async () => {
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
        restoreDeployFocus.current = true;
        onBusyChange(true);
        const confirmed = await confirm(
            l10n.t('Deploy data model to "{database}" in "{account}"?', {
                database: input.databaseName,
                account: options?.accountName ?? l10n.t('this account'),
            }),
            l10n.t('Deploy {count} selected container(s):', { count: input.containers.length }) +
                ' ' +
                input.containers.map((container) => container.entity).join(', ') +
                '.\n' +
                l10n.t('Matching existing containers are left unchanged.'),
        );
        if (confirmed === true) {
            await deploy();
        } else {
            onBusyChange(false);
        }
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
            ariaLabel: exportMethod?.title,
            readOnly: deploying || generating || confirming,
            domReadOnly: deploying || generating || confirming,
        }),
        [deploying, generating, confirming, exportMethod],
    );

    const copyCode = async () => {
        try {
            await navigator.clipboard.writeText(template);
            setCopyMessage(l10n.t('Code copied.'));
        } catch (error) {
            setTemplateError(l10n.t('Could not copy code. {error}', { error: deploymentErrorDetail(error) }));
        }
    };

    return (
        <div className={styles.stack}>
            {confirmationError ? <Text role="alert">{confirmationError}</Text> : null}
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
                    disabled={deploying || confirming}
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
                            disabled={deploying || confirming}
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
                            disabled={deploying || confirming || !options || options.databases.length === 0}
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
                                disabled={deploying || confirming}
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
                    className={styles.methods}
                    layout="horizontal"
                    value={draft.deploymentMethod}
                    disabled={deploying || confirming}
                    onChange={(_, data) => {
                        if (
                            data.value === 'direct' ||
                            data.value === 'bicep' ||
                            data.value === 'terraform' ||
                            data.value === 'sdk'
                        ) {
                            const deploymentMethod = data.value;
                            onDraftChange((previous) => ({ ...previous, deploymentMethod }));
                        }
                    }}
                >
                    <Radio
                        value="direct"
                        label={l10n.t('Direct')}
                        className={mergeClasses(styles.method, !format && styles.selectedMethod)}
                    />
                    {TEMPLATE_FORMATS.map((value) => (
                        <Radio
                            key={value}
                            value={value}
                            label={EXPORT_METHODS[value].label}
                            className={mergeClasses(styles.method, format === value && styles.selectedMethod)}
                        />
                    ))}
                </RadioGroup>
                {format && exportMethod ? (
                    <section className={styles.stack} aria-labelledby={templateLabelId}>
                        <div className={styles.templateHeader}>
                            <div className={styles.templateTitle}>
                                <Text as="h4" id={templateLabelId} className={styles.sectionTitle}>
                                    {exportMethod.title}
                                </Text>
                                <Text className={styles.caption}>{exportMethod.fileName}</Text>
                            </div>
                            <div className={styles.actions}>
                                <Button
                                    size="small"
                                    appearance="primary"
                                    icon={<CopyRegular aria-hidden />}
                                    disabled={!template || deploying || generating || confirming}
                                    onClick={() => void copyCode()}
                                >
                                    {l10n.t('Copy code')}
                                </Button>
                                <Button
                                    size="small"
                                    ref={regenerateButtonRef}
                                    disabled={!valid || deploying || generating || confirming}
                                    onClick={() => void confirmRegeneration()}
                                >
                                    {l10n.t('Regenerate')}
                                </Button>
                            </div>
                        </div>
                        <div className={styles.templateBody}>
                            <Text className={styles.caption}>
                                {exportMethod.description}{' '}
                                {l10n.t('This option does not deploy resources from the wizard.')}
                            </Text>
                            {customized && !templateCurrent ? (
                                <Text role="alert">
                                    {l10n.t(
                                        'Your custom code has been kept. Regenerate it to match the current database and container selection. Regeneration replaces your edits.',
                                    )}
                                </Text>
                            ) : null}
                            {templateError ? <Text role="alert">{templateError}</Text> : null}
                            <output aria-live="polite">{copyMessage}</output>
                            <output aria-live="polite">
                                {generating ? l10n.t('Generating deployment code...') : ''}
                            </output>
                            <div className={styles.editor}>
                                <MonacoEditor
                                    key={format}
                                    language={exportMethod.language}
                                    value={template}
                                    options={editorOptions}
                                    onChange={(value) =>
                                        onDraftChange((previous) => ({
                                            ...previous,
                                            templates: {
                                                ...previous.templates,
                                                [format]: { ...previous.templates[format], template: value ?? '' },
                                            },
                                        }))
                                    }
                                />
                            </div>
                        </div>
                    </section>
                ) : (
                    <div className={styles.deployActions}>
                        <Text className={styles.caption}>
                            {l10n.t(
                                'Create the selected containers in this account. Matching existing containers are left unchanged.',
                            )}
                        </Text>
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
                                    onClick={() => void requestDeployment()}
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
                        disabled={openingExplorer || confirming}
                        aria-description={l10n.t('Open Data Explorer for this account in the Azure portal.')}
                        onClick={() => void openDataExplorer()}
                    >
                        {l10n.t('Open in Data Explorer')}
                    </Button>
                ) : null}
                {explorerError ? <Text role="alert">{explorerError}</Text> : null}
                {deploymentError ? <Text role="alert">{deploymentError}</Text> : null}
            </section>
        </div>
    );
}
