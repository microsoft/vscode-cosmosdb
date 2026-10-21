/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Tab, TabList, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type Ref, useEffect, useId } from 'react';
import { modelingInputsEqual } from '../../../../dataModeling/modelingTelemetryMetrics';
import { type ModelingSection, type ModelingTelemetryEvent } from '../../../../dataModeling/modelingTelemetrySchema';
import { type DataModel } from '../dataModel';
import { useModelingPageVisible } from '../useModelingTelemetry';
import { DataPage } from './DataPage';
import { QueriesPage } from './QueriesPage';
import { ScalePage } from './ScalePage';

/**
 * One container step of the wizard. A container is modeled across three tabs —
 * **Data**, **Queries** and **Scale** — which are the former standalone pages. This
 * component receives its tab selection from the wizard; each tab remains a self-contained page fed
 * the {@link DataModel} plus change callbacks, so they can be reused elsewhere.
 */

export type ContainerTab = 'data' | 'queries' | 'scale';

const useStyles = makeStyles({
    stack: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
    },
    tabList: {
        flexWrap: 'wrap',
    },
});

export interface ContainerPageProps {
    model: DataModel;
    tab: ContainerTab;
    onTabChange: (tab: ContainerTab) => void;
    queriesTabRef?: Ref<HTMLButtonElement>;
    /** Data-tab edits change the schema, so the wizard re-derives partition-key candidates. */
    onChangeData: (next: DataModel) => void;
    /** Queries- and Scale-tab edits write their slice back unchanged. */
    onChange: (next: DataModel) => void;
    active?: boolean;
    containerId?: string;
    onVisit?: (containerId: string, section: ModelingSection) => void;
    onEdited?: (section: ModelingSection) => void;
    onTelemetry?: (event: ModelingTelemetryEvent) => void;
}

export function ContainerPage({
    model,
    tab,
    onTabChange,
    queriesTabRef,
    onChangeData,
    onChange,
    active = true,
    containerId,
    onVisit,
    onEdited,
    onTelemetry,
}: ContainerPageProps) {
    const styles = useStyles();
    const id = useId();
    const visible = useModelingPageVisible();
    useEffect(() => {
        if (active && visible && containerId) {
            onVisit?.(containerId, tab);
        }
    }, [active, visible, containerId, tab, onVisit]);
    const change = (next: DataModel) => {
        if (!modelingInputsEqual(next, model)) {
            onEdited?.(tab);
        }
        if (tab === 'data') onChangeData(next);
        else onChange(next);
    };

    return (
        <div className={styles.stack}>
            <TabList
                className={styles.tabList}
                selectedValue={tab}
                onTabSelect={(_, data) => {
                    if (data.value === 'data' || data.value === 'queries' || data.value === 'scale') {
                        onTabChange(data.value);
                        onTelemetry?.({
                            type: 'control',
                            control:
                                data.value === 'data'
                                    ? 'containerDataTab'
                                    : data.value === 'queries'
                                      ? 'containerQueriesTab'
                                      : 'containerScaleTab',
                        });
                    }
                }}
            >
                <Tab value="data" id={`${id}-data-tab`} aria-controls={`${id}-data-panel`}>
                    {l10n.t('Data')}
                </Tab>
                <Tab value="queries" id={`${id}-queries-tab`} aria-controls={`${id}-queries-panel`} ref={queriesTabRef}>
                    {l10n.t('Queries')}
                </Tab>
                <Tab value="scale" id={`${id}-scale-tab`} aria-controls={`${id}-scale-panel`}>
                    {l10n.t('Scale')}
                </Tab>
            </TabList>

            <div
                role="tabpanel"
                id={`${id}-data-panel`}
                aria-labelledby={`${id}-data-tab`}
                hidden={tab !== 'data'}
                tabIndex={0}
            >
                {tab === 'data' ? <DataPage model={model} onChange={change} onTelemetry={onTelemetry} /> : null}
            </div>
            <div
                role="tabpanel"
                id={`${id}-queries-panel`}
                aria-labelledby={`${id}-queries-tab`}
                hidden={tab !== 'queries'}
                tabIndex={0}
            >
                {tab === 'queries' ? <QueriesPage model={model} onChange={change} /> : null}
            </div>
            <div
                role="tabpanel"
                id={`${id}-scale-panel`}
                aria-labelledby={`${id}-scale-tab`}
                hidden={tab !== 'scale'}
                tabIndex={0}
            >
                {tab === 'scale' ? <ScalePage model={model} onChange={change} /> : null}
            </div>
        </div>
    );
}
