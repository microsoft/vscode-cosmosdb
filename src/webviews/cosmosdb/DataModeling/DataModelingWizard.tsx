/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, makeStyles, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo, useState } from 'react';
import { ContainerFooter } from './components/Container/ContainerFooter';
import { ContainerHeader } from './components/Container/ContainerHeader';
import { Wizard } from './components/Wizard/Wizard';
import { WizardStep } from './components/Wizard/WizardStep';
import {
    applyScenario,
    createInitialState,
    type DataModel,
    getActiveContainer,
    type WizardState,
    withDerivedCandidates,
} from './dataModel';
import { type ScenarioId, TOTAL_STEPS } from './models';
import { DataPage } from './pages/DataPage';
import { QueriesPage } from './pages/QueriesPage';
import { ResultPage } from './pages/ResultPage';
import { ReviewPage } from './pages/ReviewPage';
import { ScalePage } from './pages/ScalePage';
import { WorkloadPage } from './pages/WorkloadPage';
import { getScenarioList } from './scenarios';

/**
 * Root of the Data-Modeling (Partition Key Advisor) wizard.
 *
 * Chrome — the header, step indicator, active-step section and pinned footer —
 * comes from the shared {@link Wizard} component. This root only owns wizard
 * state and navigation and declares each step's content; every page remains a
 * self-contained component fed a slice of state plus change callbacks.
 */

/** Stable step identifiers, in order. `state.step` is the 1-based index into this. */
const STEP_VALUES = ['workload', 'data', 'queries', 'scale', 'review', 'result'] as const;

const useStyles = makeStyles({
    // Sticky mode bypasses ContainerBody's overflow probe, so the footer's own border never
    // elevates. Force a persistent separator that mirrors the breadcrumb/content divider.
    footerDivider: { borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
});

/**
 * Footer hint for each input step: what the current step is for, and — on Review —
 * what pressing the primary button will do next.
 */
function footerHint(step: number): string {
    switch (step) {
        case 1:
            return l10n.t('Pick the closest workload to pre-fill typical containers, keys, and defaults.');
        case 2:
            return l10n.t('Model each container and pick its partition-key candidate — or upload JSON to infer them.');
        case 3:
            return l10n.t('List your read patterns and write rates; the busiest query drives the partition key.');
        case 4:
            return l10n.t('Set cardinality, write distribution, and growth so we can size logical partitions.');
        case 5:
            return l10n.t(
                'Next: we send your inputs to Copilot and open the Result page with a ranked recommendation.',
            );
        default:
            return '';
    }
}

export const DataModelingWizard = () => {
    const styles = useStyles();
    const [state, setState] = useState<WizardState>(createInitialState);

    const patch = useCallback((partial: Partial<WizardState>) => setState((prev) => ({ ...prev, ...partial })), []);

    const goToStep = useCallback((step: number) => setState((prev) => ({ ...prev, step })), []);

    const onStepChange = useCallback(
        (value: string) => {
            const index = STEP_VALUES.indexOf(value as (typeof STEP_VALUES)[number]);
            if (index >= 0) {
                goToStep(index + 1);
            }
        },
        [goToStep],
    );

    const pickScenario = useCallback((scenario: ScenarioId) => {
        setState((prev) => applyScenario(prev, scenario));
    }, []);

    const activeContainer = getActiveContainer(state.dataModel);

    const scenarioLabel = useMemo(
        () => getScenarioList().find((s) => s.id === state.scenario)?.title,
        [state.scenario],
    );

    const setDataModel = useCallback((dataModel: DataModel) => setState((prev) => ({ ...prev, dataModel })), []);

    // The Data page changes the schema, so refresh the derived PK candidates the Scale page
    // reads. Queries and Scale edits write their slice back unchanged.
    const onChangeData = useCallback(
        (dataModel: DataModel) => setDataModel(withDerivedCandidates(dataModel)),
        [setDataModel],
    );

    const selectContainer = useCallback((id: string) => {
        setState((prev) => ({
            ...prev,
            dataModel: withDerivedCandidates({ ...prev.dataModel, activeContainerId: id }),
        }));
    }, []);

    const canAdvance = state.step > 1 || !!state.scenario;
    const nextLabel = state.step === 5 ? l10n.t('Get Recommendation') : l10n.t('Next →');

    const onNext = () => {
        if (state.step < TOTAL_STEPS) {
            goToStep(state.step + 1);
        }
    };
    const onBack = () => {
        if (state.step > 1) {
            goToStep(state.step - 1);
        }
    };
    const restart = () => setState(createInitialState());

    // Footer is shown for the input steps (1-5); the Result step carries its own
    // actions (Apply / Copy / Start Over), so no wizard footer there. Back and Next
    // sit together on the left; a "Learn more" link is end-aligned on the right.
    const footer =
        state.step < TOTAL_STEPS ? (
            <ContainerFooter
                className={styles.footerDivider}
                note={footerHint(state.step)}
                contentEnd={
                    <Link href="https://learn.microsoft.com/azure/cosmos-db/partitioning-overview" target="_blank">
                        {l10n.t('Learn more')}
                    </Link>
                }
            >
                {state.step > 1 ? (
                    <Button appearance="secondary" onClick={onBack}>
                        {l10n.t('← Back')}
                    </Button>
                ) : null}
                <Button appearance="primary" disabled={!canAdvance} onClick={onNext}>
                    {nextLabel}
                </Button>
            </ContainerFooter>
        ) : undefined;

    return (
        <Wizard
            activeStep={STEP_VALUES[state.step - 1]}
            onStepChange={onStepChange}
            stepsAriaLabel={l10n.t('Data modeling steps')}
            stickyChrome
            header={<ContainerHeader title={l10n.t('Partition Key Advisor')} />}
            footer={footer}
        >
            <WizardStep
                value="workload"
                label={l10n.t('Workload')}
                title={l10n.t('What kind of workload are you building?')}
                subtitle={l10n.t(
                    "Pick the closest pattern. We'll pre-fill typical partition key (PK) candidates and defaults.",
                )}
            >
                <WorkloadPage scenario={state.scenario} onPickScenario={pickScenario} />
            </WizardStep>

            <WizardStep
                value="data"
                label={l10n.t('Data')}
                title={l10n.t("Describe your container's data")}
                subtitle={l10n.t(
                    'Switch tabs to design each container — every container gets its own partition-key recommendation. Edit properties to shape the schema.',
                )}
            >
                <DataPage model={state.dataModel} scenarioLabel={scenarioLabel} onChange={onChangeData} />
            </WizardStep>

            <WizardStep
                value="queries"
                label={l10n.t('Queries')}
                title={l10n.t('What are your most common queries?')}
                subtitle={l10n.t("Your dominant query's WHERE filter should be the partition key.")}
            >
                <QueriesPage model={state.dataModel} onChange={setDataModel} />
            </WizardStep>

            <WizardStep
                value="scale"
                label={l10n.t('Scale')}
                title={l10n.t('Scale, distribution, and growth')}
                subtitle={l10n.t('Each logical partition: 20 GB storage limit, 10,000 RU/s throughput ceiling.')}
            >
                <ScalePage model={state.dataModel} onChange={setDataModel} />
            </WizardStep>

            <WizardStep
                value="review"
                label={l10n.t('Review')}
                title={l10n.t('Review your inputs')}
                subtitle={l10n.t('Click Edit to change any selection before analysis.')}
            >
                <ReviewPage
                    summary={{
                        workload: scenarioLabel ?? l10n.t('Not selected'),
                        entity: activeContainer?.entity ?? '—',
                        query: state.dataModel.reads[0]?.pattern || '—',
                        scale: l10n.t('{items} items · {writes} writes', {
                            items: state.dataModel.scale.items,
                            writes: state.dataModel.scale.writes,
                        }),
                    }}
                    containers={state.dataModel.containers}
                    weights={state.weights}
                    onEditStep={goToStep}
                    onChangeWeights={(weights) => patch({ weights })}
                />
            </WizardStep>

            <WizardStep
                value="result"
                label={l10n.t('Result')}
                title={l10n.t('Partition key recommendation')}
                subtitle={l10n.t('Ranked by best-practice score against your workload profile.')}
            >
                <ResultPage
                    containers={state.dataModel.containers}
                    activeContainerId={state.dataModel.activeContainerId}
                    weights={state.weights}
                    onChangeWeights={(weights) => patch({ weights })}
                    onSelectContainer={selectContainer}
                    onRestart={restart}
                />
            </WizardStep>
        </Wizard>
    );
};

export default DataModelingWizard;
