/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@cosmosdb/webview-rpc/react';
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
import { AddRegular, DeleteRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type DataModelingAppRouter, type DataModelingEvent, type PartitionKeyRecommendation } from '../../api/types';
import { ContainerFooter } from './components/Container/ContainerFooter';
import { ContainerHeader } from './components/Container/ContainerHeader';
import { type RecommendationStatus } from './components/CopilotRecommendation';
import { Wizard } from './components/Wizard/Wizard';
import { WizardStep } from './components/Wizard/WizardStep';
import {
    applyScenario,
    createBlankContainer,
    createInitialState,
    type DataModel,
    type WizardState,
    withDerivedCandidates,
} from './dataModel';
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
    const styles = useStyles();
    const { trpcClient } = useTrpcClient<DataModelingAppRouter>();
    const [state, setState] = useState<WizardState>(createInitialState);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [newContainerName, setNewContainerName] = useState('');

    const [recommendationStatus, setRecommendationStatus] = useState<RecommendationStatus>('idle');
    const [recommendation, setRecommendation] = useState<PartitionKeyRecommendation>();
    const [recommendationError, setRecommendationError] = useState<string>();

    // Stream the recommendation (or failure) that Copilot delivers via the
    // cosmosdb_reportPartitionKeyRecommendation tool.
    useEffect(() => {
        const subscription = trpcClient.dataModeling.events.subscribe(undefined, {
            onData: (event: DataModelingEvent) => {
                // Troubleshooting: confirm the event reaches the webview from the extension host.
                console.log('[DataModelingWizard] received event from extension:', event);
                if (event.type === 'recommendationReceived') {
                    setRecommendation(event.recommendation);
                    setRecommendationError(undefined);
                    setRecommendationStatus('received');
                } else {
                    setRecommendationError(event.message);
                    setRecommendationStatus('error');
                }
            },
        });
        return () => subscription.unsubscribe();
    }, [trpcClient]);

    const patch = useCallback((partial: Partial<WizardState>) => setState((prev) => ({ ...prev, ...partial })), []);

    // Navigate to a 1-based step index, syncing the active container when the target is a
    // container step and refreshing that container's derived partition-key candidates.
    const goToStep = useCallback((step: number) => {
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
                dataModel: withDerivedCandidates({ ...prev.dataModel, activeContainerId }),
            };
        });
    }, []);

    // Jump straight to a container's step (used by Review's per-container Edit).
    const goToContainer = useCallback((id: string) => {
        setState((prev) => {
            const values = buildStepValues(prev.dataModel);
            const index = values.indexOf(containerStep(id));
            if (index < 0) {
                return prev;
            }
            return {
                ...prev,
                step: index + 1,
                dataModel: withDerivedCandidates({ ...prev.dataModel, activeContainerId: id }),
            };
        });
    }, []);

    const onStepChange = useCallback(
        (value: string) => {
            const index = buildStepValues(state.dataModel).indexOf(value);
            if (index >= 0) {
                goToStep(index + 1);
            }
        },
        [goToStep, state.dataModel],
    );

    const pickScenario = useCallback((scenario: ScenarioId) => {
        setState((prev) => applyScenario(prev, scenario));
    }, []);

    const scenarioLabel = useMemo(
        () => getScenarioList().find((s) => s.id === state.scenario)?.title,
        [state.scenario],
    );

    const setDataModel = useCallback((dataModel: DataModel) => setState((prev) => ({ ...prev, dataModel })), []);

    // The Data tab changes the schema, so refresh the derived PK candidates the Scale tab
    // reads. Queries and Scale edits write their slice back unchanged.
    const onChangeData = useCallback(
        (dataModel: DataModel) => setDataModel(withDerivedCandidates(dataModel)),
        [setDataModel],
    );

    // Append a fresh, named container to the end of the list without navigating away from the
    // current step. The prompted name is trimmed; empty falls back to the default label.
    const addContainer = useCallback((name: string) => {
        setState((prev) => {
            if (prev.dataModel.containers.length >= MAX_CONTAINERS) {
                return prev;
            }
            const container = createBlankContainer(name.trim() || undefined);
            const containers = [...prev.dataModel.containers, container];
            return { ...prev, dataModel: { ...prev.dataModel, containers } };
        });
    }, []);

    // Open the name prompt, disabled once at the container cap.
    const openAddDialog = useCallback(() => {
        setNewContainerName('');
        setAddOpen(true);
    }, []);

    const confirmAddContainer = useCallback(() => {
        addContainer(newContainerName);
        setAddOpen(false);
    }, [addContainer, newContainerName]);

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
            const dataModel = withDerivedCandidates({ ...prev.dataModel, containers, activeContainerId: target.id });
            const step = buildStepValues(dataModel).indexOf(containerStep(target.id)) + 1;
            return { ...prev, dataModel, step };
        });
    }, []);

    // Send the finished data model to Copilot Chat and wait for the tool callback.
    const requestRecommendation = useCallback(() => {
        setRecommendation(undefined);
        setRecommendationError(undefined);
        setRecommendationStatus('waiting');
        void trpcClient.dataModeling.requestRecommendation
            .mutate({ dataModelJson: JSON.stringify(state.dataModel) })
            .catch(() => {
                setRecommendationStatus('error');
                setRecommendationError(l10n.t('Could not open Copilot Chat to request a recommendation.'));
            });
    }, [trpcClient, state.dataModel]);

    const stepValues = buildStepValues(state.dataModel);
    const stepIndex = Math.min(Math.max(state.step, 1), stepValues.length);
    const activeValue = stepValues[stepIndex - 1];
    const isWorkload = activeValue === WORKLOAD_STEP;
    const isReview = activeValue === REVIEW_STEP;
    const isResult = activeValue === RESULT_STEP;
    const isContainerStep = activeValue.startsWith(CONTAINER_PREFIX);

    const canAdvance = !isWorkload || !!state.scenario;
    const nextLabel = isReview ? l10n.t('Get Recommendation') : l10n.t('Next →');

    const onNext = () => {
        if (stepIndex >= stepValues.length) {
            return;
        }
        // Leaving Review kicks off the Copilot request that the Result page awaits.
        if (isReview) {
            requestRecommendation();
        }
        goToStep(stepIndex + 1);
    };
    const onBack = () => goToStep(stepIndex - 1);
    const restart = () => {
        setState(createInitialState());
        setRecommendationStatus('idle');
        setRecommendation(undefined);
        setRecommendationError(undefined);
    };

    // The Result step's footer carries only a Start Over action; every other step gets the
    // Back / Next controls. Back and Next sit together on the left; container actions and a
    // "Learn more" link are end-aligned on the right.
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
            {stepIndex > 1 ? (
                <Button appearance="secondary" onClick={onBack}>
                    {l10n.t('← Back')}
                </Button>
            ) : null}
            <Button appearance="primary" disabled={!canAdvance} onClick={onNext}>
                {nextLabel}
            </Button>
        </ContainerFooter>
    );

    return (
        <>
            <Wizard
                activeStep={activeValue}
                onStepChange={onStepChange}
                stepsAriaLabel={l10n.t('Data modeling steps')}
                stickyChrome
                header={<ContainerHeader title={l10n.t('Data Modeler')} />}
                footer={footer}
            >
                <WizardStep
                    value={WORKLOAD_STEP}
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
                        label={c.entity || l10n.t('Container {n}', { n: index + 1 })}
                        title={
                            <>
                                {l10n.t('Model')}{' '}
                                <Text font="monospace" size={500} weight="semibold">
                                    {c.entity}
                                </Text>
                            </>
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
