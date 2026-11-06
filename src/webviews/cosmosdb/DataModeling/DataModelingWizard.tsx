/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Field, Input, Link, makeStyles, Text, tokens, Tooltip } from '@fluentui/react-components';
import {
    AddRegular,
    CheckmarkRegular,
    DatabaseLinkRegular,
    DeleteRegular,
    DismissRegular,
    EditRegular,
    ErrorCircleRegular,
    InfoRegular,
    SparkleRegular,
} from '@fluentui/react-icons';
import {
    ContainerFooter,
    ContainerHeader,
    Wizard,
    WizardStep,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import {
    type CSSProperties,
    type SetStateAction,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { validateDeploymentContainerName } from '../../../dataModeling/deploymentModel';
import { WizardStateSchema } from '../../../dataModeling/modelingAdvisorSchema';
import { modelingInputsEqual } from '../../../dataModeling/modelingTelemetryMetrics';
import { PartitionKeyRecommendationSchema } from '../../../dataModeling/recommendationSchema';
import { type DataModelingAppRouter, type DataModelingEvent } from '../../api/types';
import { PreviewBadge } from '../../components/PreviewBadge';
import {
    buildDataModel,
    createBlankContainer,
    withDerivedCandidates,
    type DataModel,
    type WizardState,
} from './dataModel';
import { createInitialSnapshot, useModelingAdvisorPersistence } from './modelingAdvisorState';
import { MAX_CONTAINERS, type ScenarioId } from './models';
import { ContainerPage, type ContainerTab } from './pages/ContainerPage';
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

function getWorkloadErrors(wizard: WizardState): string[] {
    const validation = WizardStateSchema.safeParse(wizard);
    // Name the container each issue belongs to so users know which card to edit.
    return validation.success
        ? []
        : validation.error.issues.map((issue) => {
              const [scope, collection, index] = issue.path;
              const entity =
                  scope === 'dataModel' && collection === 'containers' && typeof index === 'number'
                      ? wizard.dataModel.containers[index]?.entity
                      : undefined;
              return entity ? `${entity}: ${issue.message}` : issue.message;
          });
}

// Separate from useStyles so the outer shell does not change the insertion order of the Wizard overrides.
const useViewportStyles = makeStyles({
    // Status rows share the viewport with the wizard instead of pushing its full-height surface below the fold.
    viewport: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        minHeight: 0,
        overflow: 'hidden',
    },
    statusRow: { flex: 'none' },
});

const useStyles = makeStyles({
    previewBadge: {
        position: 'absolute',
        top: '10px',
        right: '20px',
        zIndex: 10,
        marginTop: 0,
        marginRight: 0,
    },
    workloadTitle: {
        overflowWrap: 'anywhere',
    },
    recommendationNotice: {
        display: 'flex',
        alignItems: 'center',
        columnGap: tokens.spacingHorizontalXS,
        marginBottom: tokens.spacingVerticalS,
        color: tokens.colorNeutralForeground3,
    },
    fullWidthWizard: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: 0,
        minWidth: 0,
        '& [data-header-behavior] nav': {
            marginRight: 'var(--preview-badge-clearance)',
        },
        '& [aria-current="step"]': {
            fontWeight: tokens.fontWeightBold,
        },
        '& [aria-current="step"] .fui-Text': {
            fontWeight: 'inherit',
        },
    },
    // The package Container root is sized to 100vh; fit it to the remaining space below status rows.
    wizardHost: {
        flex: '1 1 auto',
        minHeight: 0,
        '& > div': { height: '100%' },
    },
    // The footer's contentEnd is a single slot, so give its buttons and the link their own gap.
    endGroup: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
    footer: { flexShrink: 0 },
    containerError: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
        padding: '8px 24px',
        backgroundColor: tokens.colorPaletteRedBackground1,
        color: tokens.colorPaletteRedForeground1,
    },
    containerErrorMessage: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        minWidth: 0,
        overflowWrap: 'anywhere',
    },
    containerErrorIcon: { flexShrink: 0 },
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
    const styles = useViewportStyles();
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

    return (
        <div className={styles.viewport}>
            <div role="alert" className={styles.statusRow}>
                {persistence.saveFailed ? <Text>{saveError}</Text> : null}
            </div>
            {persistence.saveFailed ? (
                <div className={styles.statusRow}>
                    <Button onClick={persistence.retrySave}>{l10n.t('Retry saving')}</Button>
                </div>
            ) : null}
            <HydratedDataModelingWizard
                snapshot={persistence.snapshot}
                setSnapshot={persistence.setSnapshot}
                flush={persistence.flush}
            />
        </div>
    );
};

const HydratedDataModelingWizard = ({
    snapshot,
    setSnapshot: commitSnapshot,
    flush,
}: Pick<ReturnType<typeof useModelingAdvisorPersistence>, 'snapshot' | 'setSnapshot' | 'flush'>) => {
    const styles = useStyles();
    const [previewBadgeWidth, setPreviewBadgeWidth] = useState(0);
    const viewportStyles = useViewportStyles();
    const trpcClient = useTrpcClient<DataModelingAppRouter>();
    const report = useModelingTelemetryReporter();
    const visible = useModelingPageVisible();
    const { confirm, confirming, confirmationError } = useNativeConfirmation();
    const advanceButtonRef = useRef<HTMLButtonElement>(null);
    const queriesTabRef = useRef<HTMLButtonElement>(null);
    const [containerTab, setContainerTab] = useState<ContainerTab>('data');
    const removeButtonRef = useRef<HTMLButtonElement>(null);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const requestGeneration = useRef(0);
    const requestId = useRef<string | undefined>(undefined);
    const deliveredRequestId = useRef<string | undefined>(undefined);
    // The waiting state also identifies queued updates without reading mutable refs in state updaters.
    const requestPending = useRef<typeof snapshot.recommendation | undefined>(undefined);
    const requireCorrelatedResponse = useRef(
        snapshot.recommendation.status === 'stopped' || snapshot.recommendation.status === 'error',
    );
    const abandonRecommendation = useCallback(() => {
        requestGeneration.current += 1;
        requestId.current = undefined;
        deliveredRequestId.current = undefined;
        requestPending.current = undefined;
        requireCorrelatedResponse.current = true;
    }, []);
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
    const currentSnapshot = useRef<typeof snapshot | undefined>(snapshot);
    const containerNameRequest = useRef(0);
    const containerNamePending = useRef(false);
    useEffect(
        () => () => {
            abandonRecommendation();
            currentSnapshot.current = undefined;
            containerNameRequest.current += 1;
        },
        [abandonRecommendation],
    );
    // Apply all snapshot actions to the latest pending state before handing a value to React. This keeps
    // batched functional edits ordered and fences host work immediately, without effects in replayable updaters.
    const setSnapshot = useCallback(
        (update: SetStateAction<typeof snapshot>) => {
            const previous = currentSnapshot.current;
            if (!previous) return;
            const next = typeof update === 'function' ? update(previous) : update;
            currentSnapshot.current = next;
            if (
                previous.wizard.scenario !== next.wizard.scenario ||
                !modelingInputsEqual(previous.wizard.dataModel, next.wizard.dataModel)
            ) {
                abandonRecommendation();
                setDeployOwner(undefined);
                setDeploymentDraft(undefined);
                setDeploymentBusy(false);
            }
            commitSnapshot(next);
        },
        [commitSnapshot, abandonRecommendation],
    );
    const state = snapshot.wizard;
    const { visit, markEdited, visits } = useModelingUsage(state, report);
    const setState = useCallback(
        (update: SetStateAction<WizardState>) =>
            setSnapshot((previous) => {
                const wizard = typeof update === 'function' ? update(previous.wizard) : update;
                if (wizard === previous.wizard) return previous;
                if (
                    wizard.scenario === previous.wizard.scenario &&
                    modelingInputsEqual(wizard.dataModel, previous.wizard.dataModel)
                ) {
                    return { ...previous, wizard };
                }
                // Clear the persisted result atomically with every input edit, including native prompt completions.
                return {
                    ...previous,
                    wizard: {
                        ...wizard,
                        reachedSteps:
                            wizard.reachedSteps ??
                            (previous.recommendation.value ? buildStepValues(previous.wizard.dataModel) : undefined),
                    },
                    recommendation:
                        previous.recommendation.status === 'idle'
                            ? previous.recommendation
                            : {
                                  status: 'error',
                                  error: l10n.t('The model has changed. Get a new recommendation before deploying.'),
                              },
                    deployment: undefined,
                };
            }),
        [setSnapshot],
    );
    const reachedSteps =
        state.reachedSteps ??
        buildStepValues(state.dataModel).slice(0, snapshot.recommendation.value ? undefined : state.step);
    const [addingContainer, setAddingContainer] = useState(false);
    const [addContainerError, setAddContainerError] = useState('');
    const restoreAddFocus = useRef(false);
    useEffect(() => {
        if (!addingContainer && restoreAddFocus.current) {
            restoreAddFocus.current = false;
            const focusTarget = [addButtonRef.current, advanceButtonRef.current].find(
                (button) => button && !button.disabled,
            );
            focusTarget?.focus();
        }
    }, [addingContainer, addContainerError]);
    const [editingContainerId, setEditingContainerId] = useState<string>();
    const [containerNameDraft, setContainerNameDraft] = useState('');
    const containerNameInputRef = useRef<HTMLInputElement>(null);
    const containerNameError = validateDeploymentContainerName(
        containerNameDraft,
        state.dataModel.containers
            .filter((container) => container.id !== editingContainerId)
            .map((container) => container.entity),
    );

    useLayoutEffect(() => {
        // StrictMode replays mount effects after cleanup. Never overwrite pending edits with committed state.
        currentSnapshot.current ??= snapshot;
    }, [snapshot]);
    const updateDeploymentBusy = useCallback(
        (busy: boolean) => {
            // A retired page can finish after another recommendation has started its own deployment.
            if (
                currentSnapshot.current?.recommendation.status === 'received' &&
                currentSnapshot.current.recommendation.value === recommendation
            ) {
                setDeploymentBusy(busy);
            }
        },
        [recommendation],
    );
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
            setSnapshot((previous) =>
                previous.recommendation.status !== 'received' ||
                previous.recommendation.value !== recommendation ||
                previous.deployment === deployment
                    ? previous
                    : { ...previous, deployment },
            ),
        [setSnapshot, recommendation],
    );
    const canEnterDeploy = recommendationStatus === 'received' && !!recommendation?.containers.length;
    const isDeploy = canEnterDeploy && deployOwner === recommendation;

    // Stream the recommendation (or failure) that Copilot delivers via the
    // cosmosdb_reportPartitionKeyRecommendation tool.
    useEffect(() => {
        const subscription = trpcClient.dataModeling.events.subscribe(undefined, {
            onData: (event: DataModelingEvent) => {
                const pending = requestPending.current;
                if (!pending) return;
                if (!event.requestId && requireCorrelatedResponse.current) {
                    return;
                }
                if (event.requestId && event.requestId !== requestId.current) {
                    return;
                }
                requestPending.current = undefined;
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
                    // An input edit or a newer request can precede this queued update, even in the same batch.
                    if (previous.recommendation !== pending) {
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
                const pending = requestPending.current;
                if (!pending) return;
                report({
                    type: 'recommendationClientFailure',
                    requestId: requestId.current,
                    errorCategory: 'subscription',
                });
                requestPending.current = undefined;
                setSnapshot((previous) =>
                    previous.recommendation !== pending
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
            setContainerTab('data');
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
            setContainerTab('data');
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
            const dataModel = buildDataModel(scenario);
            setState((prev) => ({ ...prev, scenario, dataModel }));
        },
        [setState, report],
    );

    const scenarioLabel = useMemo(
        () => getScenarioList().find((s) => s.id === state.scenario)?.title,
        [state.scenario],
    );

    const setDataModel = useCallback(
        (update: SetStateAction<DataModel>) =>
            setState((previous) => {
                const dataModel = typeof update === 'function' ? update(previous.dataModel) : update;
                return dataModel === previous.dataModel ? previous : { ...previous, dataModel };
            }),
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
        const entity = containerNameDraft;
        if (!editingContainerId || containerNameError) {
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
        (update: SetStateAction<DataModel>) =>
            setDataModel((previous) => {
                const next = typeof update === 'function' ? update(previous) : update;
                if (next === previous) return previous;
                return {
                    ...next,
                    // An import can finish while another container is active.
                    // Derive candidates only for changed containers without changing the current selection.
                    containers: next.containers.map((container) =>
                        container === previous.containers.find((c) => c.id === container.id)
                            ? container
                            : withDerivedCandidates({ containers: [container] }).containers[0],
                    ),
                };
            }),
        [setDataModel],
    );

    const openAddDialog = async () => {
        if (containerNamePending.current || state.dataModel.containers.length >= MAX_CONTAINERS) return;
        containerNamePending.current = true;
        const request = ++containerNameRequest.current;
        setAddingContainer(true);
        setAddContainerError('');
        try {
            const value = await trpcClient.dataModeling.promptContainerName.mutate({
                existingNames: state.dataModel.containers.map((container) => container.entity),
            });
            if (request !== containerNameRequest.current || value === undefined) return;
            const model = currentSnapshot.current?.wizard.dataModel;
            if (!model) return;
            const error = validateDeploymentContainerName(
                value,
                model.containers.map((container) => container.entity),
            );
            if (error) {
                setAddContainerError(error);
                return;
            }
            if (model.containers.length >= MAX_CONTAINERS) {
                setAddContainerError(l10n.t('The maximum number of containers has been reached.'));
                return;
            }
            markEdited('data');
            const container = createBlankContainer(value);
            setState((previous) => ({
                ...previous,
                dataModel: {
                    ...previous.dataModel,
                    containers: [...previous.dataModel.containers, container],
                },
            }));
        } catch {
            if (request === containerNameRequest.current) {
                setAddContainerError(l10n.t('Could not add the container. Please try again.'));
            }
        } finally {
            if (request === containerNameRequest.current) {
                containerNamePending.current = false;
                setAddingContainer(false);
            }
        }
    };

    // Remove the container of the current step and land on the previous container step.
    const removeCurrentContainer = useCallback(() => {
        setContainerTab('data');
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

    const workloadErrors = useMemo(() => getWorkloadErrors(state), [state]);

    // Send the finished data model to Copilot Chat and wait for the tool callback.
    const requestRecommendation = useCallback(() => {
        const current = currentSnapshot.current;
        if (!current) return;
        const errors = getWorkloadErrors(current.wizard);
        if (errors.length > 0) {
            setSnapshot((previous) => ({
                ...previous,
                recommendation: { status: 'error', error: errors.join('\n') },
            }));
            return;
        }
        if (current.recommendation.status !== 'idle') {
            report({ type: 'action', action: 'retryRecommendation' });
        }
        const attemptId = crypto.randomUUID();
        if (requestId.current) requireCorrelatedResponse.current = true;
        requestId.current = attemptId;
        deliveredRequestId.current = undefined;
        const generation = ++requestGeneration.current;
        const next: typeof snapshot = {
            ...current,
            wizard: {
                ...current.wizard,
                step: buildStepValues(current.wizard.dataModel).length,
                reachedSteps: buildStepValues(current.wizard.dataModel),
            },
            recommendation: { status: 'waiting' },
            deployment: undefined,
        };
        requestPending.current = next.recommendation;
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
                requestPending.current = undefined;
                if (!inputsSaved) {
                    report({ type: 'recommendationClientFailure', requestId: attemptId, errorCategory: 'save' });
                }
                setSnapshot((previous) =>
                    previous.recommendation === next.recommendation
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
    }, [trpcClient, setSnapshot, flush, report]);

    const stopWaitingForRecommendation = async () => {
        const attemptId = requestId.current;
        const generation = requestGeneration.current;
        const pending = requestPending.current;
        if (!attemptId || !pending) return;
        const stopped = await trpcClient.dataModeling.stopWaitingForRecommendation.mutate({ requestId: attemptId });
        if (!stopped || generation !== requestGeneration.current || !requestPending.current) return;
        abandonRecommendation();
        setSnapshot((previous) =>
            previous.recommendation === pending
                ? { ...previous, recommendation: { status: 'stopped' }, deployment: undefined }
                : previous,
        );
    };

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

    const canAdvance = (!isWorkload || !!state.scenario) && (!isReview || workloadErrors.length === 0);
    const nextLabel = isWorkload ? l10n.t('Start') : isReview ? l10n.t('Get Recommendation') : l10n.t('Next');

    const advance = () => {
        if (stepIndex >= stepValues.length) {
            return;
        }
        // Leaving Review kicks off the Copilot request that the Result page awaits.
        if (isReview) {
            requestRecommendation();
        } else {
            abandonRecommendation();
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
        const visitedTabs = isContainerStep ? visits.get(activeValue.slice(CONTAINER_PREFIX.length)) : undefined;
        if (isContainerStep && containerTab === 'data' && !visitedTabs?.has('queries') && !visitedTabs?.has('scale')) {
            const result = await confirm(
                l10n.t('Configure queries and scale?'),
                l10n.t(
                    'You have not visited the Queries or Scale tabs for this container. Configure them now, or go to the next step?',
                ),
                { primary: l10n.t('Configure'), secondary: l10n.t('Next') },
            );
            if (result === true) {
                setContainerTab('queries');
                queriesTabRef.current?.focus();
                return;
            }
            if (result !== false) {
                advanceButtonRef.current?.focus();
                return;
            }
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
    const removeContainerDescription = l10n.t(
        "Removes this container from your model. Doesn't delete any container or data in your Azure account.",
    );
    const onRemove = async () => {
        const result = await confirm(
            l10n.t('Remove from model?'),
            l10n.t('Remove the “{entity}” container? This cannot be undone.', {
                entity: state.dataModel.containers.find((c) => containerStep(c.id) === activeValue)?.entity ?? '',
            }) +
                ' ' +
                removeContainerDescription,
            { primary: l10n.t('Yes'), secondary: l10n.t('No'), secondaryIsCloseAffordance: true },
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
        abandonRecommendation();
        containerNameRequest.current += 1;
        containerNamePending.current = false;
        setAddingContainer(false);
        setAddContainerError('');
        cancelEditingContainerName();
        setDeployOwner(undefined);
        setDeploymentDraft(undefined);
        setContainerTab('data');
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
                                    ref={addButtonRef}
                                    appearance="secondary"
                                    icon={<AddRegular />}
                                    disabled={addingContainer || state.dataModel.containers.length >= MAX_CONTAINERS}
                                    onClick={() => {
                                        report({ type: 'control', control: 'footerAddContainer' });
                                        void openAddDialog();
                                    }}
                                >
                                    {l10n.t('Add container')}
                                </Button>
                                <Tooltip content={removeContainerDescription} relationship="inaccessible">
                                    <Button
                                        ref={removeButtonRef}
                                        appearance="secondary"
                                        className={styles.dangerButton}
                                        icon={<DeleteRegular aria-hidden />}
                                        aria-description={removeContainerDescription}
                                        disabled={state.dataModel.containers.length <= 1}
                                        onClick={() => {
                                            report({ type: 'control', control: 'footerRemoveContainer' });
                                            void onRemove();
                                        }}
                                    >
                                        {l10n.t('Remove from model')}
                                    </Button>
                                </Tooltip>
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
                    icon={isReview ? <SparkleRegular aria-hidden="true" /> : undefined}
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
        <div
            className={styles.fullWidthWizard}
            style={{ '--preview-badge-clearance': `${previewBadgeWidth + 28}px` } as CSSProperties}
            aria-busy={confirming || addingContainer}
        >
            <PreviewBadge className={styles.previewBadge} onWidthChange={setPreviewBadgeWidth} />
            {confirmationError ? (
                <Text
                    role="alert"
                    className={viewportStyles.statusRow}
                    style={{ paddingRight: previewBadgeWidth + 28 }}
                >
                    {confirmationError}
                </Text>
            ) : null}
            <div className={styles.wizardHost}>
                <Wizard
                    activeStep={activeValue}
                    onStepChange={onStepChange}
                    stepsAriaLabel={l10n.t('Data modeling steps')}
                    overflowAriaLabel={overflowAriaLabel}
                    headerBehavior="sticky-navigation"
                    header={
                        <ContainerHeader
                            style={{ paddingRight: previewBadgeWidth + 28 }}
                            media={<DatabaseLinkRegular aria-hidden="true" focusable="false" />}
                            title={
                                <span className={styles.workloadTitle}>
                                    {l10n.t('Workload: {name}', { name: scenarioLabel ?? l10n.t('Not selected') })}
                                </span>
                            }
                        />
                    }
                    footer={
                        <div className={styles.footer}>
                            {isContainerStep && addContainerError ? (
                                <div className={styles.containerError}>
                                    <Text role="alert" className={styles.containerErrorMessage}>
                                        <ErrorCircleRegular aria-hidden="true" className={styles.containerErrorIcon} />
                                        {addContainerError}
                                    </Text>
                                    <Button
                                        size="small"
                                        disabled={
                                            addingContainer || state.dataModel.containers.length >= MAX_CONTAINERS
                                        }
                                        onClick={() => {
                                            restoreAddFocus.current = true;
                                            addButtonRef.current?.focus();
                                            void openAddDialog();
                                        }}
                                    >
                                        {l10n.t('Retry')}
                                    </Button>
                                </div>
                            ) : null}
                            {footer}
                        </div>
                    }
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
                                reachedSteps.includes(containerStep(c.id)) &&
                                reachedSteps.at(-1) !== containerStep(c.id)
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
                                    <Field
                                        validationMessage={containerNameError}
                                        validationState={containerNameError ? 'error' : 'none'}
                                    >
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
                                                        disabled={!!containerNameError}
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
                                    </Field>
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
                            subtitle={
                                scenarioLabel
                                    ? l10n.t(
                                          'Pre-filled a {scenario} sample template. Switch tabs to edit this container’s data, queries and scale to match your app. Each container gets its own partition-key recommendation.',
                                          { scenario: scenarioLabel },
                                      )
                                    : l10n.t(
                                          'Switch tabs to define this container’s data, queries and scale. Each container gets its own partition-key recommendation.',
                                      )
                            }
                        >
                            {recommendationStatus === 'received' && recommendation ? (
                                <Text size={200} className={styles.recommendationNotice}>
                                    <InfoRegular aria-hidden="true" />
                                    {l10n.t(
                                        'Changing the model will discard the current recommendation. You will need a new recommendation before deploying.',
                                    )}
                                </Text>
                            ) : null}
                            <ContainerPage
                                model={state.dataModel}
                                tab={containerTab}
                                onTabChange={setContainerTab}
                                queriesTabRef={queriesTabRef}
                                active={activeValue === containerStep(c.id)}
                                containerId={c.id}
                                onVisit={visit}
                                onEdited={markEdited}
                                onTelemetry={report}
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
                    >
                        <ReviewPage
                            validationErrors={workloadErrors}
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
                    >
                        <ResultPage
                            recommendationStatus={recommendationStatus}
                            recommendation={recommendation}
                            recommendationError={recommendationError}
                            onRetryRecommendation={requestRecommendation}
                            onEditModel={() => onStepChange(REVIEW_STEP)}
                            onStopWaitingRecommendation={stopWaitingForRecommendation}
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
                                onDownload={(input) => trpcClient.dataModeling.downloadDeploymentTemplate.mutate(input)}
                                onDeploy={(input) =>
                                    // A native prompt may finish editing inputs while deployment confirmation is open.
                                    currentSnapshot.current?.recommendation.status === 'received' &&
                                    currentSnapshot.current.recommendation.value === recommendation
                                        ? trpcClient.dataModeling.deploy.mutate(input)
                                        : Promise.resolve({ status: 'cancelled' })
                                }
                                onOpenDataExplorer={(input) => trpcClient.dataModeling.openDataExplorer.mutate(input)}
                                onBusyChange={updateDeploymentBusy}
                                onDeploymentChange={persistDeployment}
                                onTelemetry={report}
                            />
                        ) : null}
                    </WizardStep>
                </Wizard>
            </div>
        </div>
    );
};

export default DataModelingWizard;
