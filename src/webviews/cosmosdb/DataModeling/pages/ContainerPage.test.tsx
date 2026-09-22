/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBlankContainer } from '../dataModel';
import { ContainerPage } from './ContainerPage';

vi.mock('./DataPage', () => ({ DataPage: () => null }));
vi.mock('./QueriesPage', () => ({ QueriesPage: () => null }));
vi.mock('./ScalePage', () => ({ ScalePage: () => null }));

describe('container tab activation telemetry', () => {
    it('records repeated mouse and keyboard activations but not the initially displayed tab', async () => {
        const onTelemetry = vi.fn();
        const container = createBlankContainer('Private container');
        render(
            <ContainerPage
                model={{ containers: [container], activeContainerId: container.id }}
                onChange={vi.fn()}
                onChangeData={vi.fn()}
                onTelemetry={onTelemetry}
            />,
        );
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
