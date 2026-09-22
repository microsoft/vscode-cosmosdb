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
import {
    AddRegular,
    CheckmarkRegular,
    DatabaseLinkRegular,
    DeleteRegular,
    DismissRegular,
    EditRegular,
} from '@fluentui/react-icons';
import {
    ContainerFooter,
    ContainerHeader,
    Wizard,
    WizardStep,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PartitionKeyRecommendationSchema } from '../../../dataModeling/recommendationSchema';
import { type DataModelingAppRouter, type DataModelingEvent } from '../../api/types';
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
import { createDeploymentDraft, DeployPage, type DeploymentDraft } from './pages/DeployPage';
import { ResultPage } from './pages/ResultPage';
import { ReviewPage } from './pages/ReviewPage';
import { WorkloadPage } from './pages/WorkloadPage';
import { getScenarioList } from './scenarios';
import { useModelingPageVisible, useModelingTelemetryReporter, useModelingUsage } from './useModelingTelemetry';
import { useNativeConfirmation } from './useNativeConfirmation';

/**
 * Root of the Data-Modeling (Partition Key Advisor) wizard.
 *
 * Chrome — the header, step indicator, active-step section and pinned footer —
 * comes from the shared {@link Wizard} component. This root only owns wizard
 * state and navigation and declares each step's content; every page remains a
 * self-contained component fed a slice of state plus change callbacks.
 *
 * The steps are **dynamic**: Workload, one step per modeled container (each a {@link ContainerPage}
 * with Data/Queries/Scale tabs), Review, Result, and a transient Deploy step.
 * The active container tracks the current container step.
 */

/** Stable step identifiers for the fixed steps; container steps use {@link containerStep}. */
const WORKLOAD_STEP = 'workload';
const REVIEW_STEP = 'review';
const RESULT_STEP = 'result';
const DEPLOY_STEP = 'deploy';
const CONTAINER_PREFIX = 'container:';
const overflowAriaLabel = (count: number): string =>
    count === 1 ? l10n.t('1 more step') : l10n.t('{count} more steps', { count });

/** The step value for a container, derived from its id. */
const containerStep = (id: string): string => `${CONTAINER_PREFIX}${id}`;

/** Persisted modeling steps. Deploy is intentionally excluded from this list and from saved navigation. */
function buildStepValues(model: DataModel): string[] {
    return [WORKLOAD_STEP, ...model.containers.map((c) => containerStep(c.id)), REVIEW_STEP, RESULT_STEP];
}

const useStyles = makeStyles({
    fullWidthWizard: {
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        // Temporary package DOM override until Wizard exposes a content-width prop.
        '& [data-header-behavior] > div': { maxWidth: 'none' },
    },
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
    const report = useModelingTelemetryReporter();
    const choiceMade = useRef(false);
    const load = useCallback(() => trpcClient.dataModeling.loadState.query(), [trpcClient]);
    const save = useCallback(
        (snapshot: ReturnType<typeof createInitialSnapshot>) => trpcClient.dataModeling.saveState.mutate(snapshot),
        [trpcClient],
    );
    const persistence = useModelingAdvisorPersistence({ load, save });
    useEffect(() => {
        if (persistence.loadStatus === 'ready' && !choiceMade.current) {
            choiceMade.current = true;
            report({ type: 'sessionChoice', choice: 'new' });
        }
    }, [persistence.loadStatus, report]);
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
            <SavedModelChoice
                onContinue={() => {
                    choiceMade.current = true;
                    report({ type: 'sessionChoice', choice: 'continued' });
                    persistence.continueExisting();
                }}
                onStartNew={() => {
                    choiceMade.current = true;
                    report({ type: 'sessionChoice', choice: 'replaced' });
                    persistence.startNew();
                }}
            />
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

function SavedModelChoice({ onContinue, onStartNew }: { onContinue: () => void; onStartNew: () => void }) {
    const { confirm, confirming, confirmationError } = useNativeConfirmation();
    const prompted = useRef(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const choose = useCallback(async () => {
        const result = await confirm(
            l10n.t('Continue your data model?'),
            l10n.t(
                'A saved data model was found. Choose Yes to continue where you left off, or No to start a new model and replace the saved one.',
            ),
        );
        if (result === true) onContinue();
        else if (result === false) onStartNew();
        else buttonRef.current?.focus();
    }, [confirm, onContinue, onStartNew]);
    useEffect(() => {
        if (!prompted.current) {
            prompted.current = true;
            void choose();
        }
    }, [choose]);

    return (
        <div>
            <Text as="h2">{l10n.t('Workload')}</Text>
            {confirmationError ? <Text role="alert">{confirmationError}</Text> : null}
            <Button ref={buttonRef} aria-busy={confirming} onClick={() => void choose()}>
                {l10n.t('Continue your data model?')}
            </Button>
        </div>
    );
}

const HydratedDataModelingWizard = ({
    snapshot,
    setSnapshot,
    flush,
}: Pick<ReturnType<typeof useModelingAdvisorPersistence>, 'snapshot' | 'setSnapshot' | 'flush'>) => {
    const styles = useStyles();
    const trpcClient = useTrpcClient<DataModelingAppRouter>();
    const report = useModelingTelemetryReporter();
    const visible = useModelingPageVisible();
    const { confirm, confirming, confirmationError } = useNativeConfirmation();
    const advanceButtonRef = useRef<HTMLButtonElement>(null);
    const removeButtonRef = useRef<HTMLButtonElement>(null);
    const requestGeneration = useRef(0);
    const requestId = useRef<string | undefined>(undefined);
    const deliveredRequestId = useRef<string | undefined>(undefined);
    const requestPending = useRef(false);
    useEffect(
        () => () => {
            requestGeneration.current += 1;
        },
        [],
    );
    const state = snapshot.wizard;
    const { visit, markEdited } = useModelingUsage(state, report);
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
    const [addOpen, setAddOpen] = useState(false);
    const [newContainerName, setNewContainerName] = useState('');
    const [editingContainerId, setEditingContainerId] = useState<string>();
    const [containerNameDraft, setContainerNameDraft] = useState('');
    const containerNameInputRef = useRef<HTMLInputElement>(null);

    const { status: recommendationStatus, value: recommendation, error: recommendationError } = snapshot.recommendation;
    const [feedback, setFeedback] = useState<{
        recommendation: typeof recommendation;
        vote: 'up' | 'down';
    }>();
    const selectedFeedback = feedback?.recommendation === recommendation ? feedback?.vote : undefined;
    const [deployOwner, setDeployOwner] = useState<typeof recommendation>(
        snapshot.deployment ? recommendation : undefined,
    );
    const [deploymentBusy, setDeploymentBusy] = useState(false);
    const [deploymentDraft, setDeploymentDraft] = useState<{
        owner: typeof recommendation;
        value: DeploymentDraft;
    }>();
    const initialDeploymentDraft = useMemo(
        () => createDeploymentDraft(recommendation?.containers ?? [], snapshot.deployment),
        [recommendation, snapshot.deployment],
    );
    const currentDeploymentDraft =
        deploymentDraft && deploymentDraft.owner === recommendation ? deploymentDraft.value : initialDeploymentDraft;
    const updateDeploymentDraft = useCallback(
        (update: SetStateAction<DeploymentDraft>) => {
            setSnapshot((previous) => (previous.deployment ? { ...previous, deployment: undefined } : previous));
            setDeploymentDraft((previous) => ({
                owner: recommendation,
                value:
                    typeof update === 'function'
                        ? update(
                              previous && previous.owner === recommendation ? previous.value : initialDeploymentDraft,
                          )
                        : update,
            }));
        },
        [recommendation, initialDeploymentDraft, setSnapshot],
    );
    const loadDeploymentOptions = useCallback(() => trpcClient.dataModeling.getDeploymentOptions.query(), [trpcClient]);
    const generateDeploymentTemplate = useCallback(
        (input: Parameters<typeof trpcClient.dataModeling.generateDeploymentTemplate.query>[0]) =>
            trpcClient.dataModeling.generateDeploymentTemplate.query(input),
        [trpcClient],
    );
    const persistDeployment = useCallback(
        (deployment: typeof snapshot.deployment) =>
            setSnapshot((previous) => (previous.deployment === deployment ? previous : { ...previous, deployment })),
        [setSnapshot],
    );
    const canEnterDeploy = recommendationStatus === 'received' && !!recommendation?.containers.length;
    const isDeploy = canEnterDeploy && deployOwner === recommendation;

    // Stream the recommendation (or failure) that Copilot delivers via the
    // cosmosdb_reportPartitionKeyRecommendation tool.
    useEffect(() => {
        const subscription = trpcClient.dataModeling.events.subscribe(undefined, {
            onData: (event: DataModelingEvent) => {
                if (event.requestId && event.requestId !== requestId.current) {
                    return;
                }
                requestPending.current = false;
                deliveredRequestId.current = event.requestId;
                if (
                    event.type === 'recommendationReceived' &&
                    !PartitionKeyRecommendationSchema.safeParse(event.recommendation).success
                ) {
                    report({
                        type: 'recommendationClientFailure',
                        requestId: event.requestId,
                        errorCategory: 'invalidResult',
                    });
                }
                setSnapshot((previous) => {
                    // A queued event from the prior request must not undo Start Over.
                    if (previous.recommendation.status === 'idle') {
                        return previous;
                    }
                    if (event.type === 'recommendationReceived') {
                        const parsed = PartitionKeyRecommendationSchema.safeParse(event.recommendation);
                        if (!parsed.success) {
                            return {
                                ...previous,
                                deployment: undefined,
                                recommendation: {
                                    ...previous.recommendation,
                                    status: 'error',
                                    error: l10n.t('The recommendation is invalid. Request a new recommendation.'),
                                },
                            };
                        }
                        return {
                            ...previous,
                            deployment: undefined,
                            recommendation: {
                                status: 'received',
                                value: parsed.data,
                            },
                        };
                    }
                    return {
                        ...previous,
                        deployment: undefined,
                        recommendation: { ...previous.recommendation, status: 'error', error: event.message },
                    };
                });
            },
            onError: () => {
                if (requestPending.current) {
                    report({
                        type: 'recommendationClientFailure',
                        requestId: requestId.current,
                        errorCategory: 'subscription',
                    });
                    requestPending.current = false;
                }
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
    }, [trpcClient, setSnapshot, report]);

    useEffect(() => {
        if (editingContainerId) {
            containerNameInputRef.current?.focus();
        }
    }, [editingContainerId]);

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
            if (deploymentBusy) {
                return;
            }
            if (value === DEPLOY_STEP) {
                if (canEnterDeploy) {
                    setDeployOwner(recommendation);
                }
                return;
            }
            setDeployOwner(undefined);
            const index = buildStepValues(state.dataModel).indexOf(value);
            if (index >= 0) {
                goToStep(index + 1);
            }
        },
        [goToStep, state.dataModel, deploymentBusy, canEnterDeploy, recommendation],
    );

    const pickScenario = useCallback(
        (scenario: ScenarioId) => {
            report({ type: 'scenarioSelected', scenario });
            setState((prev) => applyScenario(prev, scenario));
        },
        [setState, report],
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
        if (state.dataModel.containers.find((container) => container.id === editingContainerId)?.entity !== entity) {
            markEdited('data');
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
            if (state.dataModel.containers.length < MAX_CONTAINERS) {
                markEdited('data');
            }
            setState((prev) => {
                if (prev.dataModel.containers.length >= MAX_CONTAINERS) {
                    return prev;
                }
                const container = createBlankContainer(name.trim() || undefined);
                const containers = [...prev.dataModel.containers, container];
                return { ...prev, dataModel: { ...prev.dataModel, containers } };
            });
        },
        [setState, state.dataModel.containers.length, markEdited],
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
    }, [setState]);

    // Send the finished data model to Copilot Chat and wait for the tool callback.
    const requestRecommendation = useCallback(() => {
        if (snapshot.recommendation.status !== 'idle') {
            report({ type: 'action', action: 'retryRecommendation' });
        }
        const attemptId = crypto.randomUUID();
        requestId.current = attemptId;
        deliveredRequestId.current = undefined;
        requestPending.current = true;
        const generation = ++requestGeneration.current;
        const next: typeof snapshot = {
            ...snapshot,
            wizard: {
                ...snapshot.wizard,
                step: buildStepValues(snapshot.wizard.dataModel).length,
                reachedSteps: buildStepValues(snapshot.wizard.dataModel),
            },
            recommendation: { status: 'waiting' },
            deployment: undefined,
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
                await trpcClient.dataModeling.requestRecommendation.mutate({ ...next.wizard, requestId: attemptId });
            } catch {
                if (generation !== requestGeneration.current) {
                    return;
                }
                requestPending.current = false;
                if (!inputsSaved) {
                    report({ type: 'recommendationClientFailure', requestId: attemptId, errorCategory: 'save' });
                }
                setSnapshot((previous) =>
                    previous.recommendation.status === 'waiting'
                        ? {
                              ...previous,
                              recommendation: {
                                  ...previous.recommendation,
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
    }, [trpcClient, snapshot, setSnapshot, flush, report]);

    const stepValues = buildStepValues(state.dataModel);
    const stepIndex = Math.min(Math.max(state.step, 1), stepValues.length);
    const activeValue = isDeploy ? DEPLOY_STEP : stepValues[stepIndex - 1];
    const isWorkload = activeValue === WORKLOAD_STEP;
    const isReview = activeValue === REVIEW_STEP;
    const isResult = activeValue === RESULT_STEP;
    const isContainerStep = activeValue.startsWith(CONTAINER_PREFIX);
    const previousStep = useRef<string | undefined>(undefined);
    const displayedRecommendation = useRef<typeof recommendation>(undefined);
    useEffect(() => {
        if (!visible || previousStep.current === activeValue) {
            return;
        }
        const previous = previousStep.current;
        previousStep.current = activeValue;
        report({
            type: 'step',
            step: isContainerStep
                ? 'container'
                : isWorkload
                  ? 'workload'
                  : isReview
                    ? 'review'
                    : isResult
                      ? 'result'
                      : 'deploy',
        });
        if (isDeploy) {
            report({ type: 'action', action: 'enterDeploy' });
        } else if (recommendation && (previous === RESULT_STEP || previous === DEPLOY_STEP) && !isResult) {
            report({ type: 'action', action: 'returnToEditing' });
        }
    }, [visible, activeValue, isContainerStep, isWorkload, isReview, isResult, isDeploy, recommendation, report]);
    useEffect(() => {
        if (
            visible &&
            isResult &&
            recommendationStatus === 'received' &&
            recommendation?.containers.length &&
            displayedRecommendation.current !== recommendation
        ) {
            displayedRecommendation.current = recommendation;
            report({ type: 'recommendationDisplayed', requestId: deliveredRequestId.current });
        }
    }, [visible, isResult, recommendationStatus, recommendation, report]);

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
            requestId.current = undefined;
            requestPending.current = false;
            setSnapshot((previous) => ({
                ...previous,
                wizard: { ...previous.wizard, reachedSteps: stepValues.slice(0, stepIndex + 1) },
                recommendation: { status: 'idle' },
                deployment: undefined,
            }));
            goToStep(stepIndex + 1);
        }
    };
    const onNext = async () => {
        if (isResult) {
            if (canEnterDeploy) {
                setDeployOwner(recommendation);
            }
            return;
        }
        if (recommendation || reachedSteps.some((value) => stepValues.indexOf(value) >= stepIndex)) {
            const result = await confirm(
                l10n.t('Restart from this step?'),
                l10n.t(
                    'Continuing will clear completion of the following steps and discard the existing recommendation. Your entered model data will be kept. Do you want to continue?',
                ),
            );
            if (result !== true) {
                advanceButtonRef.current?.focus();
                return;
            }
        }
        advance();
    };
    const onRemove = async () => {
        const result = await confirm(
            l10n.t('Remove this container?'),
            l10n.t('Remove the “{entity}” container? This cannot be undone.', {
                entity: state.dataModel.containers.find((c) => containerStep(c.id) === activeValue)?.entity ?? '',
            }),
        );
        if (result === true) {
            markEdited('data');
            removeCurrentContainer();
        } else removeButtonRef.current?.focus();
    };
    const onBack = () => {
        if (isDeploy) {
            setDeployOwner(undefined);
            if (stepIndex !== stepValues.length) {
                goToStep(stepValues.length);
            }
        } else {
            goToStep(stepIndex - 1);
        }
    };
    const restart = () => {
        report({ type: 'action', action: 'startOver' });
        requestId.current = undefined;
        deliveredRequestId.current = undefined;
        requestPending.current = false;
        requestGeneration.current += 1;
        setAddOpen(false);
        setNewContainerName('');
        cancelEditingContainerName();
        setDeployOwner(undefined);
        setDeploymentDraft(undefined);
        setSnapshot(createInitialSnapshot());
    };

    // Only successful deployment details are persisted; editable drafts remain local to the open wizard.
    const footer =
        isResult || isDeploy ? (
            <ContainerFooter>
                {isResult ? (
                    <Button
                        appearance="primary"
                        disabled={!canEnterDeploy}
                        onClick={() => {
                            report({ type: 'control', control: 'footerDeploy' });
                            void onNext();
                        }}
                    >
                        {l10n.t('Deploy')}
                    </Button>
                ) : (
                    <Button
                        appearance="secondary"
                        disabled={deploymentBusy}
                        onClick={() => {
                            report({ type: 'control', control: 'footerBack' });
                            onBack();
                        }}
                    >
                        {l10n.t('Back')}
                    </Button>
                )}
                <Button
                    appearance="secondary"
                    disabled={deploymentBusy}
                    onClick={() => {
                        report({ type: 'control', control: 'footerStartOver' });
                        restart();
                    }}
                >
                    {l10n.t('Start Over')}
                </Button>
            </ContainerFooter>
        ) : (
            <ContainerFooter
                note={footerHint(activeValue)}
                contentEnd={
                    <div className={styles.endGroup}>
                        {isContainerStep ? (
                            <>
                                <Button
                                    appearance="secondary"
                                    icon={<AddRegular />}
                                    disabled={state.dataModel.containers.length >= MAX_CONTAINERS}
                                    onClick={() => {
                                        report({ type: 'control', control: 'footerAddContainer' });
                                        openAddDialog();
                                    }}
                                >
                                    {l10n.t('Add container')}
                                </Button>
                                <Button
                                    ref={removeButtonRef}
                                    appearance="secondary"
                                    className={styles.dangerButton}
                                    icon={<DeleteRegular />}
                                    disabled={state.dataModel.containers.length <= 1}
                                    onClick={() => {
                                        report({ type: 'control', control: 'footerRemoveContainer' });
                                        void onRemove();
                                    }}
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
                <Button
                    ref={advanceButtonRef}
                    appearance="primary"
                    disabled={!canAdvance}
                    onClick={() => {
                        report({
                            type: 'control',
                            control: isWorkload ? 'footerStart' : isReview ? 'footerGetRecommendation' : 'footerNext',
                        });
                        void onNext();
                    }}
                >
                    {nextLabel}
                </Button>
                {stepIndex > 1 ? (
                    <Button
                        appearance="secondary"
                        onClick={() => {
                            report({ type: 'control', control: 'footerBack' });
                            onBack();
                        }}
                    >
                        {l10n.t('Back')}
                    </Button>
                ) : null}
            </ContainerFooter>
        );

    return (
        <div className={styles.fullWidthWizard} aria-busy={confirming}>
            {confirmationError ? <Text role="alert">{confirmationError}</Text> : null}
            <Wizard
                activeStep={activeValue}
                onStepChange={onStepChange}
                stepsAriaLabel={l10n.t('Data modeling steps')}
                overflowAriaLabel={overflowAriaLabel}
                headerBehavior="sticky-navigation"
                header={
                    <ContainerHeader
                        media={<DatabaseLinkRegular aria-hidden="true" focusable="false" />}
                        title={l10n.t('Workload: {name}', { name: scenarioLabel ?? l10n.t('Not selected') })}
                    />
                }
                footer={footer}
            >
                <WizardStep
                    value={WORKLOAD_STEP}
                    completed={reachedSteps.includes(WORKLOAD_STEP) && reachedSteps.at(-1) !== WORKLOAD_STEP}
                    navigable={!deploymentBusy && reachedSteps.includes(WORKLOAD_STEP)}
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
                        navigable={!deploymentBusy && reachedSteps.includes(containerStep(c.id))}
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
                            active={activeValue === containerStep(c.id)}
                            containerId={c.id}
                            onVisit={visit}
                            onEdited={markEdited}
                            onTelemetry={report}
                            scenarioLabel={scenarioLabel}
                            onChangeData={onChangeData}
                            onChange={setDataModel}
                        />
                    </WizardStep>
                ))}

                <WizardStep
                    value={REVIEW_STEP}
                    completed={reachedSteps.includes(REVIEW_STEP) && reachedSteps.at(-1) !== REVIEW_STEP}
                    navigable={!deploymentBusy && reachedSteps.includes(REVIEW_STEP)}
                    label={l10n.t('Review')}
                    title={l10n.t('Review your inputs')}
                    subtitle={l10n.t('Click Edit to change any selection before analysis.')}
                >
                    <ReviewPage
                        workloadLabel={scenarioLabel ?? l10n.t('Not selected')}
                        containers={state.dataModel.containers}
                        onEditWorkload={() => goToStep(1)}
                        onEditContainer={goToContainer}
                    />
                </WizardStep>

                <WizardStep
                    value={RESULT_STEP}
                    completed={recommendationStatus === 'received'}
                    navigable={!deploymentBusy && reachedSteps.includes(RESULT_STEP)}
                    label={l10n.t('Result')}
                    title={l10n.t('Partition key recommendation')}
                    subtitle={l10n.t("Copilot's analysis of your workload profile.")}
                >
                    <ResultPage
                        recommendationStatus={recommendationStatus}
                        recommendation={recommendation}
                        recommendationError={recommendationError}
                        onRetryRecommendation={requestRecommendation}
                        feedback={selectedFeedback}
                        onFeedback={(vote) => {
                            if (selectedFeedback !== vote) {
                                setFeedback({ recommendation, vote });
                                report({ type: 'feedback', vote });
                            }
                        }}
                    />
                </WizardStep>
                <WizardStep
                    value={DEPLOY_STEP}
                    completed={canEnterDeploy && !!snapshot.deployment}
                    navigable={canEnterDeploy && !deploymentBusy}
                    label={l10n.t('Deploy')}
                    title={l10n.t('Deploy data model')}
                    subtitle={l10n.t(
                        'Create resources directly or prepare deployment code for your preferred tooling.',
                    )}
                >
                    {recommendation ? (
                        <DeployPage
                            containers={recommendation.containers}
                            draft={currentDeploymentDraft}
                            deployment={snapshot.deployment}
                            onDraftChange={updateDeploymentDraft}
                            loadOptions={loadDeploymentOptions}
                            generateTemplate={generateDeploymentTemplate}
                            onDeploy={(input) => trpcClient.dataModeling.deploy.mutate(input)}
                            onOpenDataExplorer={(input) => trpcClient.dataModeling.openDataExplorer.mutate(input)}
                            onBusyChange={setDeploymentBusy}
                            onDeploymentChange={persistDeployment}
                            onTelemetry={report}
                        />
                    ) : null}
                </WizardStep>
            </Wizard>

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
        </div>
    );
};

export default DataModelingWizard;
