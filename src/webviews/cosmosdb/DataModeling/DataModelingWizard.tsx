/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    Link,
    makeStyles,
    Text,
    tokens,
} from '@fluentui/react-components';
import { AddRegular, CheckmarkRegular, DeleteRegular, DismissRegular, EditRegular } from '@fluentui/react-icons';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DataModelingAppRouter, type DataModelingEvent } from '../../api/types';
import { AlertDialog } from '../../common/AlertDialog';
import { ContainerFooter } from './components/Container/ContainerFooter';
import { ContainerHeader } from './components/Container/ContainerHeader';
import { Wizard } from './components/Wizard/Wizard';
import { WizardStep } from './components/Wizard/WizardStep';
import {
    applyScenario,
    createBlankContainer,
    withDerivedCandidates,
    type DataModel,
    type WizardState,
} from './dataModel';
import { createInitialSnapshot, useModelingAdvisorPersistence } from './modelingAdvisorState';
import { MAX_CONTAINERS, type ScenarioId } from './models';
import { ContainerPage } from './pages/ContainerPage';
import { ResultPage } from './pages/ResultPage';
import { ReviewPage } from './pages/ReviewPage';
import { WorkloadPage } from './pages/WorkloadPage';
import { getScenarioList } from './scenarios';

/**
 * Root of the Data-Modeling (Partition Key Advisor) wizard.
 *
 * Chrome — the header, step indicator, active-step section and pinned footer —
 * comes from the shared {@link Wizard} component. This root only owns wizard
 * state and navigation and declares each step's content; every page remains a
 * self-contained component fed a slice of state plus change callbacks.
 *
 * The steps are **dynamic**: a Workload step, then one step per modeled container
 * (each a {@link ContainerPage} with Data/Queries/Scale tabs), then Review and Result.
 * The active container tracks the current container step.
 */

/** Stable step identifiers for the fixed steps; container steps use {@link containerStep}. */
const WORKLOAD_STEP = 'workload';
const REVIEW_STEP = 'review';
const RESULT_STEP = 'result';
const CONTAINER_PREFIX = 'container:';

/** The step value for a container, derived from its id. */
const containerStep = (id: string): string => `${CONTAINER_PREFIX}${id}`;

/** Ordered list of step values for the current model: workload, one per container, review, result. */
function buildStepValues(model: DataModel): string[] {
    return [WORKLOAD_STEP, ...model.containers.map((c) => containerStep(c.id)), REVIEW_STEP, RESULT_STEP];
}

const useStyles = makeStyles({
    // Sticky mode bypasses ContainerBody's overflow probe, so the footer's own border never
    // elevates. Force a persistent separator that mirrors the breadcrumb/content divider.
    footerDivider: { borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
    // The footer's contentEnd is a single slot, so give its buttons and the link their own gap.
    endGroup: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
    // Fluent 9 has no built-in danger appearance; tint the destructive action red.
    dangerButton: {
        color: tokens.colorPaletteRedForeground1,
        ':hover': { color: tokens.colorPaletteRedForeground1 },
        ':hover:active': { color: tokens.colorPaletteRedForeground1 },
    },
    containerNameActions: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },
    containerNameInput: { width: '240px' },
    // Keep the pen inline with the title text and vertically centered on it, so it sits right
    // after the model name instead of drifting to the end of the heading row.
    containerTitle: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXXS },
    // Shrink the pen so it reads as a subtle affordance next to the larger title text and lines
    // up with its optical center rather than overpowering the heading.
    containerTitleEdit: {
        color: tokens.colorNeutralForeground2,
        minWidth: 'unset',
        padding: 0,
        '& svg': { fontSize: '16px' },
    },
    stepLabel: { display: 'inline-flex', alignItems: 'baseline', gap: tokens.spacingHorizontalXS },
});

/**
 * Footer hint for the current step: what the step is for, and — on Review — what pressing the
 * primary button will do next.
 */
function footerHint(value: string): string {
    if (value === WORKLOAD_STEP) {
        return l10n.t('Pick the closest workload to pre-fill typical containers, keys, and defaults.');
    }
    if (value === REVIEW_STEP) {
        return l10n.t('Next: we send your inputs to Copilot and open the Result page with a ranked recommendation.');
    }
    if (value.startsWith(CONTAINER_PREFIX)) {
        return l10n.t('Model this container across the Data, Queries and Scale tabs — it gets its own recommendation.');
    }
    return '';
}

export const DataModelingWizard = () => {
    const trpcClient = useTrpcClient<DataModelingAppRouter>();
    const load = useCallback(() => trpcClient.dataModeling.loadState.query(), [trpcClient]);
    const save = useCallback(
        (snapshot: ReturnType<typeof createInitialSnapshot>) => trpcClient.dataModeling.saveState.mutate(snapshot),
        [trpcClient],
    );
    const persistence = useModelingAdvisorPersistence({ load, save });
    const loadMessage = l10n.t('Loading saved modeling advisor state…');
    const loadError = l10n.t('Could not load the modeling advisor state. Retry before making changes.');
    const saveError = l10n.t('Could not save the modeling advisor state. Keep this tab open and retry.');

    if (persistence.loadStatus === 'loading' || persistence.loadStatus === 'error') {
        return (
            <div>
                <output aria-live="polite">
                    <Text>{persistence.loadStatus === 'loading' ? loadMessage : loadError}</Text>
                </output>
                {persistence.loadStatus === 'error' ? (
                    <Button onClick={persistence.retryLoad}>{l10n.t('Retry loading')}</Button>
                ) : null}
            </div>
        );
    }

    if (persistence.loadStatus === 'choice') {
        return (
            <>
                <div inert>
                    <Text as="h2">{l10n.t('Workload')}</Text>
                    <WorkloadPage
                        onPickScenario={(scenario) =>
                            persistence.setSnapshot((previous) => ({
                                ...previous,
                                wizard: applyScenario(previous.wizard, scenario),
                            }))
                        }
                    />
                </div>
                <Dialog open modalType="alert">
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>{l10n.t('Continue your data model?')}</DialogTitle>
                            <DialogContent>
                                {l10n.t(
                                    'A saved data model was found. Continue where you left off, or start a new model and replace the saved one.',
                                )}
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="primary" onClick={persistence.continueExisting}>
                                    {l10n.t('Continue existing')}
                                </Button>
                                <Button appearance="secondary" onClick={persistence.startNew}>
                                    {l10n.t('Start new')}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            </>
        );
    }

    return (
        <>
            <div role="alert">{persistence.saveFailed ? <Text>{saveError}</Text> : null}</div>
            {persistence.saveFailed ? (
                <div>
                    <Button onClick={persistence.retrySave}>{l10n.t('Retry saving')}</Button>
                </div>
            ) : null}
            <HydratedDataModelingWizard
                snapshot={persistence.snapshot}
                setSnapshot={persistence.setSnapshot}
                flush={persistence.flush}
            />
        </>
    );
};

const HydratedDataModelingWizard = ({
    snapshot,
    setSnapshot,
    flush,
}: Pick<ReturnType<typeof useModelingAdvisorPersistence>, 'snapshot' | 'setSnapshot' | 'flush'>) => {
    const styles = useStyles();
    const trpcClient = useTrpcClient<DataModelingAppRouter>();
    const [confirmAdvance, setConfirmAdvance] = useState(false);
    const advanceButtonRef = useRef<HTMLButtonElement>(null);
    const restoreAdvanceFocus = useRef(false);
    const requestGeneration = useRef(0);
    useEffect(
        () => () => {
            requestGeneration.current += 1;
        },
        [],
    );
    const state = snapshot.wizard;
    const setState = useCallback(
        (update: SetStateAction<WizardState>) =>
            setSnapshot((previous) => ({
                ...previous,
                wizard: typeof update === 'function' ? update(previous.wizard) : update,
            })),
        [setSnapshot],
    );
    const reachedSteps =
        state.reachedSteps ??
        buildStepValues(state.dataModel).slice(0, snapshot.recommendation.value ? undefined : state.step);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [newContainerName, setNewContainerName] = useState('');
    const [editingContainerId, setEditingContainerId] = useState<string>();
    const [containerNameDraft, setContainerNameDraft] = useState('');
    const containerNameInputRef = useRef<HTMLInputElement>(null);

    const { status: recommendationStatus, value: recommendation, error: recommendationError } = snapshot.recommendation;

    useEffect(() => {
        if (!confirmAdvance && restoreAdvanceFocus.current) {
            const frame = requestAnimationFrame(() => {
                advanceButtonRef.current?.focus();
                restoreAdvanceFocus.current = false;
            });
            return () => cancelAnimationFrame(frame);
        }
        return undefined;
    }, [confirmAdvance]);

    // Stream the recommendation (or failure) that Copilot delivers via the
    // cosmosdb_reportPartitionKeyRecommendation tool.
    useEffect(() => {
        const subscription = trpcClient.dataModeling.events.subscribe(undefined, {
            onData: (event: DataModelingEvent) => {
                setSnapshot((previous) => {
                    // A queued event from the prior request must not undo Start Over.
                    if (previous.recommendation.status === 'idle') {
                        return previous;
                    }
                    return {
                        ...previous,
                        recommendation:
                            event.type === 'recommendationReceived'
                                ? { status: 'received', value: event.recommendation }
                                : { ...previous.recommendation, status: 'error', error: event.message },
                    };
                });
            },
            onError: () => {
                setSnapshot((previous) =>
                    previous.recommendation.status !== 'waiting'
                        ? previous
                        : {
                              ...previous,
                              recommendation: {
                                  ...previous.recommendation,
                                  status: 'error',
                                  error: l10n.t('Could not receive the recommendation from the extension.'),
                              },
                          },
                );
            },
        });
        return () => subscription.unsubscribe();
    }, [trpcClient, setSnapshot]);

    useEffect(() => {
        if (editingContainerId) {
            containerNameInputRef.current?.focus();
        }
    }, [editingContainerId]);

    const patch = useCallback(
        (partial: Partial<WizardState>) => setState((prev) => ({ ...prev, ...partial })),
        [setState],
    );

    // Navigate to a 1-based step index, syncing the active container when the target is a
    // container step without changing any user-entered cardinalities.
    const goToStep = useCallback(
        (step: number) => {
            setState((prev) => {
                const values = buildStepValues(prev.dataModel);
                const clamped = Math.min(Math.max(step, 1), values.length);
                const value = values[clamped - 1];
                const activeContainerId = value.startsWith(CONTAINER_PREFIX)
                    ? value.slice(CONTAINER_PREFIX.length)
                    : prev.dataModel.activeContainerId;
                return {
                    ...prev,
                    step: clamped,
                    dataModel: { ...prev.dataModel, activeContainerId },
                };
            });
        },
        [setState],
    );

    // Jump straight to a container's step (used by Review's per-container Edit).
    const goToContainer = useCallback(
        (id: string) => {
            setState((prev) => {
                const values = buildStepValues(prev.dataModel);
                const index = values.indexOf(containerStep(id));
                if (index < 0) {
                    return prev;
                }
                return {
                    ...prev,
                    step: index + 1,
                    dataModel: { ...prev.dataModel, activeContainerId: id },
                };
            });
        },
        [setState],
    );

    const onStepChange = useCallback(
        (value: string) => {
            const index = buildStepValues(state.dataModel).indexOf(value);
            if (index >= 0) {
                goToStep(index + 1);
            }
        },
        [goToStep, state.dataModel],
    );

    const pickScenario = useCallback(
        (scenario: ScenarioId) => {
            setState((prev) => applyScenario(prev, scenario));
        },
        [setState],
    );

    const scenarioLabel = useMemo(
        () => getScenarioList().find((s) => s.id === state.scenario)?.title,
        [state.scenario],
    );

    const setDataModel = useCallback(
        (dataModel: DataModel) => setState((prev) => ({ ...prev, dataModel })),
        [setState],
    );

    const startEditingContainerName = (containerId: string, entity: string) => {
        setEditingContainerId(containerId);
        setContainerNameDraft(entity);
    };

    const cancelEditingContainerName = () => {
        setEditingContainerId(undefined);
        setContainerNameDraft('');
    };

    const saveContainerName = () => {
        const entity = containerNameDraft.trim();
        if (!editingContainerId || !entity) {
            return;
        }

        setState((previous) => ({
            ...previous,
            dataModel: {
                ...previous.dataModel,
                containers: previous.dataModel.containers.map((container) =>
                    container.id === editingContainerId ? { ...container, entity } : container,
                ),
            },
        }));
        cancelEditingContainerName();
    };

    // The Data tab changes the schema, so refresh the derived PK candidates the Scale tab
    // reads. Queries and Scale edits write their slice back unchanged.
    const onChangeData = useCallback(
        (dataModel: DataModel) => setDataModel(withDerivedCandidates(dataModel)),
        [setDataModel],
    );

    // Append a fresh, named container to the end of the list without navigating away from the
    // current step. The prompted name is trimmed; empty falls back to the default label.
    const addContainer = useCallback(
        (name: string) => {
            setState((prev) => {
                if (prev.dataModel.containers.length >= MAX_CONTAINERS) {
                    return prev;
                }
                const container = createBlankContainer(name.trim() || undefined);
                const containers = [...prev.dataModel.containers, container];
                return { ...prev, dataModel: { ...prev.dataModel, containers } };
            });
        },
        [setState],
    );

    // Open the name prompt, disabled once at the container cap.
    const openAddDialog = useCallback(() => {
        setNewContainerName('');
        setAddOpen(true);
    }, []);

    const confirmAddContainer = useCallback(() => {
        addContainer(newContainerName);
        setAddOpen(false);
    }, [addContainer, newContainerName, setAddOpen]);

    // Remove the container of the current step and land on the previous container step.
    const removeCurrentContainer = useCallback(() => {
        setConfirmRemove(false);
        setState((prev) => {
            if (prev.dataModel.containers.length <= 1) {
                return prev;
            }
            const value = buildStepValues(prev.dataModel)[prev.step - 1];
            if (!value?.startsWith(CONTAINER_PREFIX)) {
                return prev;
            }
            const id = value.slice(CONTAINER_PREFIX.length);
            const index = prev.dataModel.containers.findIndex((c) => c.id === id);
            const containers = prev.dataModel.containers.filter((c) => c.id !== id);
            const target = containers[Math.max(0, index - 1)];
            const dataModel = { ...prev.dataModel, containers, activeContainerId: target.id };
            const step = buildStepValues(dataModel).indexOf(containerStep(target.id)) + 1;
            return { ...prev, dataModel, step };
        });
    }, [setConfirmRemove, setState]);

    // Send the finished data model to Copilot Chat and wait for the tool callback.
    const requestRecommendation = useCallback(() => {
        const generation = ++requestGeneration.current;
        const next: typeof snapshot = {
            ...snapshot,
            wizard: {
                ...snapshot.wizard,
                step: buildStepValues(snapshot.wizard.dataModel).length,
                reachedSteps: buildStepValues(snapshot.wizard.dataModel),
            },
            recommendation: { status: 'waiting' },
        };
        setSnapshot(next);
        // Preserve inputs and Result navigation before opening Chat.
        const run = async () => {
            let inputsSaved = false;
            try {
                await flush(next);
                inputsSaved = true;
                if (generation !== requestGeneration.current) {
                    return;
                }
                await trpcClient.dataModeling.requestRecommendation.mutate({
                    dataModelJson: JSON.stringify(next.wizard.dataModel),
                });
            } catch {
                if (generation !== requestGeneration.current) {
                    return;
                }
                setSnapshot((previous) =>
                    previous.recommendation.status === 'waiting'
                        ? {
                              ...previous,
                              recommendation: {
                                  status: 'error',
                                  error: inputsSaved
                                      ? l10n.t('Could not open Copilot Chat to request a recommendation.')
                                      : l10n.t(
                                            'Could not save your inputs before requesting a recommendation. Please retry.',
                                        ),
                              },
                          }
                        : previous,
                );
            }
        };
        void run();
    }, [trpcClient, snapshot, setSnapshot, flush]);

    const stepValues = buildStepValues(state.dataModel);
    const stepIndex = Math.min(Math.max(state.step, 1), stepValues.length);
    const activeValue = stepValues[stepIndex - 1];
    const isWorkload = activeValue === WORKLOAD_STEP;
    const isReview = activeValue === REVIEW_STEP;
    const isResult = activeValue === RESULT_STEP;
    const isContainerStep = activeValue.startsWith(CONTAINER_PREFIX);

    const canAdvance = !isWorkload || !!state.scenario;
    const nextLabel = isWorkload ? l10n.t('Start') : isReview ? l10n.t('Get Recommendation') : l10n.t('Next');

    const advance = () => {
        if (stepIndex >= stepValues.length) {
            return;
        }
        // Leaving Review kicks off the Copilot request that the Result page awaits.
        if (isReview) {
            requestRecommendation();
        } else {
            requestGeneration.current += 1;
            setSnapshot((previous) => ({
                ...previous,
                wizard: { ...previous.wizard, reachedSteps: stepValues.slice(0, stepIndex + 1) },
                recommendation: { status: 'idle' },
            }));
            goToStep(stepIndex + 1);
        }
    };
    const onNext = () => {
        if (recommendation || reachedSteps.some((value) => stepValues.indexOf(value) >= stepIndex)) {
            setConfirmAdvance(true);
        } else {
            advance();
        }
    };
    const onBack = () => goToStep(stepIndex - 1);
    const restart = () => {
        requestGeneration.current += 1;
        setConfirmRemove(false);
        setAddOpen(false);
        setNewContainerName('');
        cancelEditingContainerName();
        setSnapshot(createInitialSnapshot());
    };

    // The Result step's footer carries only a Start Over action; every other step gets the
    // Next / Back controls. The primary Next button sits first (left), Back after it; container
    // actions and a "Learn more" link are end-aligned on the right.
    const footer = isResult ? (
        <ContainerFooter className={styles.footerDivider}>
            <Button appearance="secondary" onClick={restart}>
                {l10n.t('Start Over')}
            </Button>
        </ContainerFooter>
    ) : (
        <ContainerFooter
            className={styles.footerDivider}
            note={footerHint(activeValue)}
            contentEnd={
                <div className={styles.endGroup}>
                    {isContainerStep ? (
                        <>
                            <Button
                                appearance="secondary"
                                icon={<AddRegular />}
                                disabled={state.dataModel.containers.length >= MAX_CONTAINERS}
                                onClick={openAddDialog}
                            >
                                {l10n.t('Add container')}
                            </Button>
                            <Button
                                appearance="secondary"
                                className={styles.dangerButton}
                                icon={<DeleteRegular />}
                                disabled={state.dataModel.containers.length <= 1}
                                onClick={() => setConfirmRemove(true)}
                            >
                                {l10n.t('Remove this container')}
                            </Button>
                        </>
                    ) : null}
                    <Link href="https://learn.microsoft.com/azure/cosmos-db/partitioning-overview" target="_blank">
                        {l10n.t('Learn more')}
                    </Link>
                </div>
            }
        >
            <Button ref={advanceButtonRef} appearance="primary" disabled={!canAdvance} onClick={onNext}>
                {nextLabel}
            </Button>
            {stepIndex > 1 ? (
                <Button appearance="secondary" onClick={onBack}>
                    {l10n.t('Back')}
                </Button>
            ) : null}
        </ContainerFooter>
    );

    return (
        <>
            <Wizard
                activeStep={activeValue}
                onStepChange={onStepChange}
                stepsAriaLabel={l10n.t('Data modeling steps')}
                stickyChrome
                header={
                    <ContainerHeader
                        title={l10n.t('Workload: {name}', { name: scenarioLabel ?? l10n.t('Not selected') })}
                    />
                }
                footer={footer}
            >
                <WizardStep
                    value={WORKLOAD_STEP}
                    completed={reachedSteps.includes(WORKLOAD_STEP) && reachedSteps.at(-1) !== WORKLOAD_STEP}
                    navigable={reachedSteps.includes(WORKLOAD_STEP)}
                    label={l10n.t('Workload')}
                    title={l10n.t('What kind of workload are you building?')}
                    subtitle={l10n.t(
                        "Pick the closest pattern. We'll pre-fill typical partition key (PK) candidates and defaults.",
                    )}
                >
                    <WorkloadPage scenario={state.scenario} onPickScenario={pickScenario} />
                </WizardStep>

                {state.dataModel.containers.map((c, index) => (
                    <WizardStep
                        key={c.id}
                        value={containerStep(c.id)}
                        completed={
                            reachedSteps.includes(containerStep(c.id)) && reachedSteps.at(-1) !== containerStep(c.id)
                        }
                        navigable={reachedSteps.includes(containerStep(c.id))}
                        label={
                            <span className={styles.stepLabel}>
                                <span>{l10n.t('Container:')}</span>
                                <Text as="span" font="monospace">
                                    {c.entity || l10n.t('Container {n}', { n: index + 1 })}
                                </Text>
                            </span>
                        }
                        title={
                            editingContainerId === c.id ? (
                                <Input
                                    aria-label={l10n.t('Container name')}
                                    className={styles.containerNameInput}
                                    contentAfter={
                                        <div className={styles.containerNameActions}>
                                            <Button
                                                appearance="transparent"
                                                aria-label={l10n.t('Save container name')}
                                                icon={<CheckmarkRegular />}
                                                size="small"
                                                disabled={!containerNameDraft.trim()}
                                                onClick={saveContainerName}
                                            />
                                            <Button
                                                appearance="transparent"
                                                aria-label={l10n.t('Cancel editing container name')}
                                                icon={<DismissRegular />}
                                                size="small"
                                                onClick={cancelEditingContainerName}
                                            />
                                        </div>
                                    }
                                    ref={containerNameInputRef}
                                    value={containerNameDraft}
                                    onChange={(_, data) => setContainerNameDraft(data.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            saveContainerName();
                                        } else if (event.key === 'Escape') {
                                            cancelEditingContainerName();
                                        }
                                    }}
                                />
                            ) : (
                                <span className={styles.containerTitle}>
                                    <Text font="monospace" size={500} weight="semibold">
                                        {l10n.t('Model:')} {c.entity}
                                    </Text>
                                    <Button
                                        appearance="transparent"
                                        className={styles.containerTitleEdit}
                                        icon={<EditRegular />}
                                        size="small"
                                        aria-label={l10n.t('Edit {name}', { name: c.entity })}
                                        onClick={() => startEditingContainerName(c.id, c.entity)}
                                    />
                                </span>
                            )
                        }
                        subtitle={l10n.t(
                            'Switch tabs to define this container’s data, queries and scale. Each container gets its own partition-key recommendation.',
                        )}
                    >
                        <ContainerPage
                            model={state.dataModel}
                            scenarioLabel={scenarioLabel}
                            onChangeData={onChangeData}
                            onChange={setDataModel}
                        />
                    </WizardStep>
                ))}

                <WizardStep
                    value={REVIEW_STEP}
                    completed={reachedSteps.includes(REVIEW_STEP) && reachedSteps.at(-1) !== REVIEW_STEP}
                    navigable={reachedSteps.includes(REVIEW_STEP)}
                    label={l10n.t('Review')}
                    title={l10n.t('Review your inputs')}
                    subtitle={l10n.t('Click Edit to change any selection before analysis.')}
                >
                    <ReviewPage
                        workloadLabel={scenarioLabel ?? l10n.t('Not selected')}
                        containers={state.dataModel.containers}
                        weights={state.weights}
                        onEditWorkload={() => goToStep(1)}
                        onEditContainer={goToContainer}
                        onChangeWeights={(weights) => patch({ weights })}
                    />
                </WizardStep>

                <WizardStep
                    value={RESULT_STEP}
                    completed={recommendationStatus === 'received'}
                    navigable={reachedSteps.includes(RESULT_STEP)}
                    label={l10n.t('Result')}
                    title={l10n.t('Partition key recommendation')}
                    subtitle={l10n.t("Copilot's analysis of your workload profile.")}
                >
                    <ResultPage
                        recommendationStatus={recommendationStatus}
                        recommendation={recommendation}
                        recommendationError={recommendationError}
                        onRetryRecommendation={requestRecommendation}
                    />
                </WizardStep>
            </Wizard>

            <AlertDialog
                isOpen={confirmAdvance}
                onClose={(confirmed) => {
                    restoreAdvanceFocus.current = !confirmed;
                    setConfirmAdvance(false);
                    if (confirmed) {
                        advance();
                    }
                }}
                title={l10n.t('Restart from this step?')}
                confirmButtonText={l10n.t('Yes')}
                cancelButtonText={l10n.t('Cancel')}
                reverseButtonOrder
            >
                {l10n.t(
                    'Continuing will clear completion of the following steps and discard the existing recommendation. Your entered model data will be kept. Do you want to continue?',
                )}
            </AlertDialog>

            <Dialog open={addOpen} onOpenChange={(_, data) => setAddOpen(data.open)}>
                <DialogSurface>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            confirmAddContainer();
                        }}
                    >
                        <DialogBody>
                            <DialogTitle>{l10n.t('Add container')}</DialogTitle>
                            <DialogContent>
                                <Field label={l10n.t('Container name')}>
                                    <Input
                                        value={newContainerName}
                                        placeholder={l10n.t('e.g., Orders')}
                                        onChange={(_, data) => setNewContainerName(data.value)}
                                    />
                                </Field>
                            </DialogContent>
                            <DialogActions>
                                <Button appearance="secondary" type="button" onClick={() => setAddOpen(false)}>
                                    {l10n.t('Cancel')}
                                </Button>
                                <Button appearance="primary" type="submit" disabled={!newContainerName.trim()}>
                                    {l10n.t('Add')}
                                </Button>
                            </DialogActions>
                        </DialogBody>
                    </form>
                </DialogSurface>
            </Dialog>

            <Dialog open={confirmRemove} onOpenChange={(_, data) => setConfirmRemove(data.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{l10n.t('Remove this container?')}</DialogTitle>
                        <DialogContent>
                            {l10n.t('Remove the “{entity}” container? This cannot be undone.', {
                                entity:
                                    state.dataModel.containers.find((c) => containerStep(c.id) === activeValue)
                                        ?.entity ?? '',
                            })}
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setConfirmRemove(false)}>
                                {l10n.t('Cancel')}
                            </Button>
                            <Button appearance="primary" onClick={removeCurrentContainer}>
                                {l10n.t('Yes')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </>
    );
};

export default DataModelingWizard;
