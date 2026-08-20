/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useMemo, useState } from 'react';
import { Stepper } from './components/Stepper';
import { ScoreStatus, WizardFooter } from './components/WizardFooter';
import { type ScenarioId, TOTAL_STEPS, type WizardState, type WizardStepDescriptor } from './models';
import { DataPage } from './pages/DataPage';
import { QueriesPage } from './pages/QueriesPage';
import { ResultPage } from './pages/ResultPage';
import { ReviewPage } from './pages/ReviewPage';
import { ScalePage } from './pages/ScalePage';
import { WorkloadPage } from './pages/WorkloadPage';
import { getScenarioList } from './scenarios';
import { applyScenario, buildCandidates, createInitialState, getActiveContainer } from './wizardState';

/**
 * Root of the Data-Modeling (Partition Key Advisor) wizard.
 *
 * This component owns wizard state and step navigation only. Each page is a
 * self-contained component fed a slice of state plus change callbacks, so the
 * exact same pages can later be mounted inside a generic wizard package that
 * provides its own stepper/footer chrome.
 */

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        boxSizing: 'border-box',
        color: tokens.colorNeutralForeground1,
        backgroundColor: tokens.colorNeutralBackground1,
        fontFamily: tokens.fontFamilyBase,
    },
    content: {
        flex: 1,
        width: '100%',
        maxWidth: '1100px',
        margin: '0 auto',
        boxSizing: 'border-box',
        padding: tokens.spacingHorizontalXL,
        // Comfortable gutters on wide screens, tighter on narrow webviews / side panels.
        '@media (max-width: 600px)': {
            padding: tokens.spacingHorizontalM,
        },
    },
});

function useStepDescriptors(): WizardStepDescriptor[] {
    return useMemo(
        () => [
            { index: 1, label: l10n.t('Workload') },
            { index: 2, label: l10n.t('Data') },
            { index: 3, label: l10n.t('Queries') },
            { index: 4, label: l10n.t('Scale') },
            { index: 5, label: l10n.t('Review') },
            { index: 6, label: l10n.t('Result') },
        ],
        [],
    );
}

/** Illustrative 0-100 score derived from the weighted inputs (prototype). */
function computeScore(state: WizardState): number {
    const active = getActiveContainer(state);
    if (!active) {
        return 0;
    }
    const total = state.weights.read + state.weights.write + state.weights.storage || 1;
    const topQps = Math.max(0, ...state.reads.map((r) => r.qps));
    const readScore = topQps > 0 ? 95 : 70;
    const writeScore = state.scale.writes === 'even' ? 95 : state.scale.writes === 'skewed' ? 70 : 60;
    const storageScore = state.scale.growth === 'rapid' ? 60 : state.scale.growth === 'slow' ? 85 : 95;
    const weighted =
        (readScore * state.weights.read + writeScore * state.weights.write + storageScore * state.weights.storage) /
        total;
    return Math.round(weighted);
}

export const DataModelingWizard = () => {
    const styles = useStyles();
    const steps = useStepDescriptors();

    const [state, setState] = useState<WizardState>(createInitialState);
    const [maxReached, setMaxReached] = useState(1);

    const patch = useCallback((partial: Partial<WizardState>) => setState((prev) => ({ ...prev, ...partial })), []);

    const goToStep = useCallback((step: number) => {
        setState((prev) => ({ ...prev, step }));
        setMaxReached((prev) => Math.max(prev, step));
    }, []);

    const pickScenario = useCallback((scenario: ScenarioId) => {
        setState((prev) => applyScenario(prev, scenario));
    }, []);

    const activeContainer = getActiveContainer(state);
    const avgDocSizeKb = activeContainer?.document.avgSizeKb ?? 1;
    const score = useMemo(() => computeScore(state), [state]);

    const scenarioLabel = useMemo(
        () => getScenarioList().find((s) => s.id === state.scenario)?.title,
        [state.scenario],
    );

    // When containers change we may need to refresh the derived PK candidates
    // used by the Scale page so it reflects the active container's schema.
    const setContainers = useCallback((containers: WizardState['containers']) => {
        setState((prev) => {
            const active = containers.find((c) => c.id === prev.activeContainerId) ?? containers[0];
            return {
                ...prev,
                containers,
                activeContainerId: active?.id,
                scale: { ...prev.scale, candidates: buildCandidates(active) },
            };
        });
    }, []);

    const setActiveContainer = useCallback((id: string) => {
        setState((prev) => {
            const active = prev.containers.find((c) => c.id === id);
            return {
                ...prev,
                activeContainerId: id,
                scale: { ...prev.scale, candidates: buildCandidates(active) },
            };
        });
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

    const restart = () => {
        setState(createInitialState());
        setMaxReached(1);
    };

    const renderPage = () => {
        switch (state.step) {
            case 1:
                return <WorkloadPage scenario={state.scenario} onPickScenario={pickScenario} />;
            case 2:
                return (
                    <DataPage
                        containers={state.containers}
                        activeContainerId={state.activeContainerId}
                        scenarioLabel={scenarioLabel}
                        onSetActive={setActiveContainer}
                        onChangeContainers={setContainers}
                    />
                );
            case 3:
                return (
                    <QueriesPage
                        reads={state.reads}
                        writes={state.writes}
                        avgDocSizeKb={avgDocSizeKb}
                        onChangeReads={(reads) => patch({ reads })}
                        onChangeWrites={(writes) => patch({ writes })}
                    />
                );
            case 4:
                return (
                    <ScalePage
                        scale={state.scale}
                        avgDocSizeKb={avgDocSizeKb}
                        onChangeScale={(scale) => patch({ scale })}
                    />
                );
            case 5:
                return (
                    <ReviewPage
                        summary={{
                            workload: scenarioLabel ?? l10n.t('Not selected'),
                            entity: activeContainer?.entity ?? '—',
                            query: state.reads[0]?.pattern || '—',
                            scale: l10n.t('{items} items · {writes} writes', {
                                items: state.scale.items,
                                writes: state.scale.writes,
                            }),
                        }}
                        containers={state.containers}
                        weights={state.weights}
                        onEditStep={goToStep}
                        onChangeWeights={(weights) => patch({ weights })}
                    />
                );
            case 6:
                return (
                    <ResultPage
                        containers={state.containers}
                        activeContainerId={state.activeContainerId}
                        weights={state.weights}
                        onChangeWeights={(weights) => patch({ weights })}
                        onSelectContainer={setActiveContainer}
                        onRestart={restart}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div className={styles.root}>
            <div className={styles.content}>
                <Stepper
                    steps={steps}
                    current={state.step}
                    maxReached={maxReached}
                    subtitles={{ 1: scenarioLabel, 2: activeContainer?.entity }}
                    onNavigate={goToStep}
                />
                {renderPage()}
            </div>
            {state.step < TOTAL_STEPS ? (
                <WizardFooter
                    status={<ScoreStatus score={state.step >= 4 ? String(score) : '—'} />}
                    showBack={state.step > 1}
                    onBack={onBack}
                    nextLabel={nextLabel}
                    nextDisabled={!canAdvance}
                    onNext={onNext}
                />
            ) : null}
        </div>
    );
};

export default DataModelingWizard;
