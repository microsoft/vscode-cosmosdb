/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import { type PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_POLICY } from '../../../panels/accountOverview/services/advisories/core/thresholds';
import { HOUR, MINUTE } from '../../../panels/accountOverview/services/units';
import { AccountHealthStatus, healthIndicatorDescriptions } from './AccountHealthStatus';

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

describe('AccountHealthStatus', () => {
    it('keeps the visible health label, one live status and policy-backed check descriptions', () => {
        render(
            <AccountHealthStatus
                provisioningState="Succeeded"
                accountHealth="Healthy"
                healthChecks={[{ kind: 'requests', outcome: 'passed', detail: 'clear' }]}
            />,
            { wrapper: Wrapper },
        );
        const badge = screen.getByLabelText('Healthy');
        expect(badge).toHaveTextContent('Healthy');
        expect(badge).toHaveAccessibleName('Healthy');
        expect(badge).toHaveAttribute('tabindex', '0');
        const policy = DIAGNOSTIC_POLICY.sustainedThrottling;
        const minutes = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(
            policy.minDurationMs / MINUTE,
        );
        const hours = new Intl.NumberFormat(undefined, { style: 'unit', unit: 'hour', unitDisplay: 'long' }).format(
            policy.observation.windowMs / HOUR,
        );
        expect(badge).toHaveAccessibleDescription(
            expect.stringContaining(
                `No sustained account-wide 429 rate above ${(policy.shareThreshold * 100).toLocaleString()}% for ${minutes} in the last ${hours}.`,
            ),
        );
        expect(badge).toHaveAccessibleDescription(
            expect.stringContaining('Resource provisioning — Passed Resource provisioning state: Online.'),
        );
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status')).toHaveTextContent('Account health: Healthy');
    });

    it('renders unavailable alert checks without losing a known problem', () => {
        render(
            <AccountHealthStatus
                provisioningState="Succeeded"
                accountHealth="Critical"
                activeAlertsUnavailable
                healthChecks={[
                    {
                        kind: 'alerts',
                        outcome: 'unavailable',
                        stale: true,
                        summary: { available: true, totalCount: 1, criticalCount: 1, warningCount: 0, generatedAt: 1 },
                    },
                ]}
            />,
            { wrapper: Wrapper },
        );
        expect(screen.getByLabelText('Critical')).toHaveAccessibleDescription(
            expect.stringContaining(
                'Active Azure Monitor alerts — Not assessed Active alerts could not be checked. Previously known problems are retained.',
            ),
        );
        expect(screen.getByRole('status')).toHaveTextContent('Account health: Critical');
    });

    it('localizes tab reasons without changing the model severity', () => {
        expect(
            healthIndicatorDescriptions({
                databases: { severity: 'Critical', reasons: [{ kind: 'criticalContainers', count: 2 }] },
                advisories: { severity: 'Needs Attention', reasons: [{ kind: 'warningAlerts' }, { kind: 'advisor' }] },
            }),
        ).toEqual({
            databases: {
                severity: 'Critical',
                description:
                    'Critical containers: 2. Account health is at least Needs Attention. Critical containers appear first in the table.',
            },
            advisories: {
                severity: 'Needs Attention',
                description:
                    'Warning active alerts make account health at least Needs Attention. High-impact Performance or Cost recommendations make account health at least Needs Attention.',
            },
        });
    });
});
