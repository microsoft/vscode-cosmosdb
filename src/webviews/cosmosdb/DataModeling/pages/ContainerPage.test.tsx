/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createBlankContainer } from '../dataModel';
import { ContainerPage, type ContainerTab } from './ContainerPage';

vi.mock('./DataPage', () => ({ DataPage: () => <div>Data content</div> }));
vi.mock('./QueriesPage', () => ({ QueriesPage: () => <div>Queries content</div> }));
vi.mock('./ScalePage', () => ({ ScalePage: () => <div>Scale content</div> }));

describe('container tab accessibility', () => {
    function Container() {
        const [tab, setTab] = useState<ContainerTab>('data');
        const [container] = useState(() => createBlankContainer());
        return (
            <ContainerPage
                model={{ containers: [container], activeContainerId: container.id }}
                tab={tab}
                onTabChange={setTab}
                onChange={vi.fn()}
                onChangeData={vi.fn()}
            />
        );
    }

    it('associates each selected tab with its named panel when switching tabs', async () => {
        render(<Container />);
        const user = userEvent.setup();
        const tabIds = screen.getAllByRole('tab').map((tab) => tab.id);

        for (const name of ['Data', 'Queries', 'Scale', 'Data']) {
            const tab = screen.getByRole('tab', { name });
            await user.click(tab);

            const panel = screen.getByRole('tabpanel', { name });
            expect(tab).toHaveTextContent(name);
            expect(tab).toHaveAccessibleName(name);
            expect(tab).toHaveAttribute('aria-selected', 'true');
            expect(tab).toHaveAttribute('aria-controls', panel.id);
            expect(panel).toHaveAttribute('aria-labelledby', tab.id);
            expect(panel).toHaveAttribute('tabindex', '0');
            expect(panel).toBeVisible();
            expect(within(panel).getByText(`${name} content`)).toBeVisible();
            expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
            expect(screen.getAllByRole('tab').map((element) => element.id)).toEqual(tabIds);
            for (const otherName of ['Data', 'Queries', 'Scale'].filter((value) => value !== name)) {
                expect(screen.queryByText(`${otherName} content`)).not.toBeInTheDocument();
            }
        }
    });

    it('uses instance-unique tab and panel IDs with valid relationships for every tab', () => {
        render(
            <>
                <Container />
                <Container />
            </>,
        );

        const tabs = screen.getAllByRole('tab');
        const panels = screen.getAllByRole('tabpanel', { hidden: true });
        const ids = [...tabs, ...panels].map((element) => element.id);
        expect(ids.every(Boolean)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
        expect(panels).toHaveLength(6);
        for (const tab of tabs) {
            const panel = panels.find((element) => element.id === tab.getAttribute('aria-controls'));
            expect(panel).toBeDefined();
            expect(panel).toHaveAttribute('aria-labelledby', tab.id);
            expect(panel).toHaveProperty('hidden', tab.getAttribute('aria-selected') !== 'true');
        }
    });
});

describe('container tab activation telemetry', () => {
    it('records repeated mouse and keyboard activations but not the initially displayed tab', async () => {
        const onTelemetry = vi.fn();
        const container = createBlankContainer('Private container');
        function Container() {
            const [tab, setTab] = useState<ContainerTab>('data');
            return (
                <ContainerPage
                    model={{ containers: [container], activeContainerId: container.id }}
                    tab={tab}
                    onTabChange={setTab}
                    onChange={vi.fn()}
                    onChangeData={vi.fn()}
                    onTelemetry={onTelemetry}
                />
            );
        }
        render(<Container />);
        expect(onTelemetry).not.toHaveBeenCalled();
        const user = userEvent.setup();
        await user.click(screen.getByRole('tab', { name: 'Data' }));
        await user.click(screen.getByRole('tab', { name: 'Data' }));
        screen.getByRole('tab', { name: 'Queries' }).focus();
        await user.keyboard('{Enter}');
        expect(onTelemetry.mock.calls.map(([event]) => event)).toEqual([
            { type: 'control', control: 'containerDataTab' },
            { type: 'control', control: 'containerDataTab' },
            { type: 'control', control: 'containerQueriesTab' },
        ]);
        expect(JSON.stringify(onTelemetry.mock.calls)).not.toContain('Private container');
    });
});
