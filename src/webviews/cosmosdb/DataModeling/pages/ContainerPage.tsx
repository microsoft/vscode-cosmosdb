/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Tab, TabList, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useState } from 'react';
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
 * component owns only the tab selection; each tab remains a self-contained page fed
 * the {@link DataModel} plus change callbacks, so they can be reused elsewhere.
 */

type ContainerTab = 'data' | 'queries' | 'scale';

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
    scenarioLabel?: string;
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
    scenarioLabel,
    onChangeData,
    onChange,
    active = true,
    containerId,
    onVisit,
    onEdited,
    onTelemetry,
}: ContainerPageProps) {
    const styles = useStyles();
    const [tab, setTab] = useState<ContainerTab>('data');
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
                        setTab(data.value);
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
                <Tab value="data">{l10n.t('Data')}</Tab>
                <Tab value="queries">{l10n.t('Queries')}</Tab>
                <Tab value="scale">{l10n.t('Scale')}</Tab>
            </TabList>

            {tab === 'data' ? (
                <DataPage model={model} scenarioLabel={scenarioLabel} onChange={change} onTelemetry={onTelemetry} />
            ) : null}
            {tab === 'queries' ? <QueriesPage model={model} onChange={change} /> : null}
            {tab === 'scale' ? <ScalePage model={model} onChange={change} /> : null}
        </div>
    );
}
