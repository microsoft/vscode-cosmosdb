/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, Tab, TabList, Text, tokens } from '@fluentui/react-components';
import { InfoFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type SetStateAction, useEffect, useId, useRef } from 'react';
import { modelingInputsEqual } from '../../../../dataModeling/modelingTelemetryMetrics';
import { type ModelingSection, type ModelingTelemetryEvent } from '../../../../dataModeling/modelingTelemetrySchema';
import { type DataModel } from '../dataModel';
import { type SchemaImportTracker } from '../schemaImports';
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
    visitReminder: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
        color: tokens.colorNeutralForeground2,
    },
    // Matches the unvisited-tab dots so the reminder visually points at the tabs it lists.
    visitReminderIcon: {
        flexShrink: 0,
        fontSize: '16px',
        color: tokens.colorPaletteBlueForeground2,
        '@media (forced-colors: active)': {
            color: 'Highlight',
            forcedColorAdjust: 'none',
        },
    },
    unvisitedDot: {
        display: 'inline-block',
        width: '6px',
        height: '6px',
        marginLeft: tokens.spacingHorizontalXXS,
        // Sit at the top-right of the label like a notification badge rather than on the text baseline.
        verticalAlign: 'top',
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: tokens.colorPaletteBlueForeground2,
        '@media (forced-colors: active)': {
            backgroundColor: 'Highlight',
            forcedColorAdjust: 'none',
        },
    },
});

export interface ContainerPageProps {
    model: DataModel;
    tab: ContainerTab;
    onTabChange: (tab: ContainerTab) => void;
    visitedTabs?: ReadonlySet<ContainerTab>;
    focusPath?: string[];
    onFocused?: () => void;
    /** Data-tab edits change the schema, so the wizard re-derives partition-key candidates. */
    onChangeData: (next: SetStateAction<DataModel>) => void;
    /** Queries- and Scale-tab edits write their slice back unchanged. */
    onChange: (next: DataModel) => void;
    active?: boolean;
    containerId?: string;
    onVisit?: (containerId: string, section: ModelingSection) => void;
    onEdited?: (section: ModelingSection) => void;
    onTelemetry?: (event: ModelingTelemetryEvent) => void;
    /** Survives Data-tab remounts so a pending import is never mistaken for the latest one. */
    schemaImports?: SchemaImportTracker;
}

export function ContainerPage({
    model,
    tab,
    onTabChange,
    visitedTabs,
    focusPath,
    onFocused,
    onChangeData,
    onChange,
    active = true,
    containerId,
    onVisit,
    onEdited,
    onTelemetry,
    schemaImports,
}: ContainerPageProps) {
    const styles = useStyles();
    const id = useId();
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!active || !focusPath) return;
        // Wait until the wizard has shown the step and performed its own heading focus.
        const frame = requestAnimationFrame(() => {
            const panel = rootRef.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
            const path = focusPath.join('.');
            const field = Array.from(panel?.querySelectorAll<HTMLInputElement>('input[name]') ?? []).find(
                (element) => element.name === path || element.name.startsWith(`${path}.`),
            );
            (field ?? panel)?.focus();
            onFocused?.();
        });
        return () => cancelAnimationFrame(frame);
    }, [active, focusPath, tab, onFocused]);
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
        onChange(next);
    };
    const changeData = (update: SetStateAction<DataModel>) => {
        const next = typeof update === 'function' ? update(model) : update;
        if (!modelingInputsEqual(next, model)) onEdited?.('data');
        onChangeData(update);
    };
    const tabs = [
        { value: 'data', label: l10n.t('Data') },
        { value: 'queries', label: l10n.t('Queries') },
        { value: 'scale', label: l10n.t('Scale') },
    ] as const;
    const unvisitedTabs = tabs.filter(({ value }) => !visitedTabs?.has(value));
    const selectTab = (next: ContainerTab) => {
        onTabChange(next);
        onTelemetry?.({
            type: 'control',
            control:
                next === 'data' ? 'containerDataTab' : next === 'queries' ? 'containerQueriesTab' : 'containerScaleTab',
        });
    };

    return (
        <div className={styles.stack} ref={rootRef}>
            {unvisitedTabs.length > 0 ? (
                <div className={styles.visitReminder}>
                    <InfoFilled className={styles.visitReminderIcon} aria-hidden="true" />
                    <Text size={200}>{l10n.t('Visit these tabs to review this container’s configuration:')}</Text>
                    {unvisitedTabs.map(({ value, label }) => (
                        <Link
                            key={value}
                            as="button"
                            onClick={() => {
                                selectTab(value);
                                rootRef.current?.querySelector<HTMLButtonElement>(`[id="${id}-${value}-tab"]`)?.focus();
                            }}
                        >
                            {label}
                        </Link>
                    ))}
                </div>
            ) : null}
            <TabList
                className={styles.tabList}
                selectedValue={tab}
                onTabSelect={(_, data) => {
                    if (data.value === 'data' || data.value === 'queries' || data.value === 'scale') {
                        selectTab(data.value);
                    }
                }}
            >
                {tabs.map(({ value, label }) => (
                    <Tab
                        key={value}
                        value={value}
                        id={`${id}-${value}-tab`}
                        aria-controls={`${id}-${value}-panel`}
                        aria-description={visitedTabs?.has(value) ? l10n.t('Visited') : l10n.t('Not yet visited')}
                    >
                        {label}
                        {!visitedTabs?.has(value) ? <span className={styles.unvisitedDot} aria-hidden="true" /> : null}
                    </Tab>
                ))}
            </TabList>

            <div
                role="tabpanel"
                id={`${id}-data-panel`}
                aria-labelledby={`${id}-data-tab`}
                hidden={tab !== 'data'}
                tabIndex={0}
            >
                {tab === 'data' ? (
                    <DataPage
                        model={model}
                        onChange={changeData}
                        onTelemetry={onTelemetry}
                        schemaImports={schemaImports}
                    />
                ) : null}
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
