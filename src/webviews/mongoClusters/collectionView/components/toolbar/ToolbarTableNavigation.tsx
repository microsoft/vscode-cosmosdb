/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Breadcrumb,
    BreadcrumbButton,
    BreadcrumbDivider,
    BreadcrumbItem,
    InfoLabel,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
} from '@fluentui/react-components';
import { ArrowUp16Filled } from '@fluentui/react-icons';
import { useContext } from 'react';
import { CollectionViewContext, Views } from '../../collectionViewContext';

export const ToolbarTableNavigation = (): JSX.Element => {
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);

    function levelUp() {
        setCurrentContext({
            ...currentContext,
            currentViewState: {
                ...currentContext.currentViewState,
                currentPath: currentContext.currentViewState?.currentPath.slice(0, -1) ?? [],
            },
        });
    }

    function jumpToLevel(level: number) {
        setCurrentContext({
            ...currentContext,
            currentViewState: {
                ...currentContext.currentViewState,
                currentPath: currentContext.currentViewState?.currentPath.slice(0, level) ?? [],
            },
        });
    }

    type Item = {
        key: number;
        item: string;
    };

    const items: Item[] = [
        { key: -1, item: 'Root Level' },
        ...(currentContext.currentViewState?.currentPath.map(
            (label, index): Item => ({
                key: index,
                item: label,
            }),
        ) || []),
    ];

    return (
        <Toolbar aria-label="with Popover" size="small" style={{ paddingBottom: '10px' }}>
            <Tooltip content="Level up" relationship="description" withArrow>
                <ToolbarButton
                    onClick={levelUp}
                    aria-label="Up"
                    icon={<ArrowUp16Filled />}
                    disabled={
                        currentContext.currentView !== Views.TABLE ||
                        currentContext.currentViewState?.currentPath === undefined ||
                        currentContext.currentViewState?.currentPath.length === 0
                    }
                />
            </Tooltip>

            <ToolbarDivider />

            <Breadcrumb aria-label="Small breadcrumb example with buttons" size="small">
                {items?.map((item, index) => (
                    <BreadcrumbItem key={item.key}>
                        <BreadcrumbButton onClick={() => jumpToLevel(index)}>{item.item}</BreadcrumbButton>
                        {index < items.length - 1 && <BreadcrumbDivider />}
                    </BreadcrumbItem>
                ))}
            </Breadcrumb>
            <InfoLabel
                info={
                    <>
                        Your database stores documents with embedded fields, allowing for hierarchical data
                        organization.
                        <br />
                        This table view presents data at the root level by default. Using the table navigation, you can
                        explore deeper levels or move back and forth between them.
                        <br />
                        <ul>
                            <li>
                                <strong>To navigate back to any level:</strong> Simply click on the{' '}
                                <strong>desired level</strong> in the navigation path.
                            </li>
                            <li>
                                <strong>To dive deeper into document fields:</strong> Double-click on fields of type{' '}
                                <strong>object</strong>, marked by the{' '}
                                <span style={{ fontFamily: 'monospace' }}>{' {} '}</span> icon, directly in the table
                                view.
                            </li>
                        </ul>
                    </>
                }
            />
        </Toolbar>
    );
};
