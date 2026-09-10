/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCORING_WEIGHTS } from '../../../../dataModeling/scoring';
import { ReviewPage } from './ReviewPage';

describe('ReviewPage scoring priorities', () => {
    it('explains equal defaults and that priorities apply after analysis, not instantly', () => {
        render(
            <ReviewPage
                workloadLabel="Chat"
                containers={[]}
                weights={DEFAULT_SCORING_WEIGHTS}
                onChangeWeights={vi.fn()}
                onEditContainer={vi.fn()}
                onEditWorkload={vi.fn()}
            />,
        );
        expect(screen.getByText(/approximately equal by default \(33.33% each\)/)).toHaveTextContent(
            'these priorities determine the ranking after analysis.',
        );
        expect(screen.queryByText(/recalculates instantly/)).not.toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Read / query alignment' })).toHaveValue('33.34');
        expect(screen.getByRole('slider', { name: 'Write distribution' })).toHaveValue('33.33');
        expect(screen.getByRole('slider', { name: 'Storage & growth' })).toHaveValue('33.33');
    });
});
