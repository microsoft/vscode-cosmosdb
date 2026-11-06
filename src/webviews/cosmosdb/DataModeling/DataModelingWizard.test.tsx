/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, tokens, webLightTheme } from '@fluentui/react-components';
import { type EditorProps } from '@monaco-editor/react';
import { act, fireEvent, render as renderReact, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { type DeploymentTemplateInput, type ModelDeploymentResult } from '../../../dataModeling/deploymentModel';
import {
    ModelingAdvisorSnapshotSchema,
    type ModelingAdvisorSnapshot,
} from '../../../dataModeling/modelingAdvisorSchema';
import { type ModelingTelemetryEvent } from '../../../dataModeling/modelingTelemetrySchema';
import { type DataModelingEvent } from '../../api/types';
import { applyScenario, createBlankContainer } from './dataModel';
import { DataModelingWizard } from './DataModelingWizard';
import { createInitialSnapshot } from './modelingAdvisorState';
import { MAX_CONTAINERS } from './models';

const client = vi.hoisted(() => ({
    dataModeling: {
        confirm: { mutate: vi.fn() },
        promptContainerName: { mutate: vi.fn() },
        loadState: { query: vi.fn() },
        saveState: { mutate: vi.fn() },
        requestRecommendation: { mutate: vi.fn() },
        stopWaitingForRecommendation: { mutate: vi.fn() },
        recordTelemetry: { mutate: vi.fn() },
        getDeploymentOptions: { query: vi.fn() },
        generateDeploymentTemplate: { query: vi.fn() },
        downloadDeploymentTemplate: { mutate: vi.fn() },
        deploy: { mutate: vi.fn() },
        openDataExplorer: { mutate: vi.fn() },
        events: { subscribe: vi.fn() },
    },
}));
afterEach(() => vi.restoreAllMocks());
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));
vi.mock('../../MonacoEditor', () => ({
    MonacoEditor: ({ value, options, onChange }: EditorProps) => (
        <textarea
            aria-label={options?.ariaLabel}
            readOnly={options?.readOnly}
            value={value}
            onChange={(event) =>
                onChange?.(event.currentTarget.value, {
                    changes: [],
                    eol: '\n',
                    versionId: 1,
                    isUndoing: false,
                    isRedoing: false,
                    isFlush: false,
                    isEolChange: false,
                })
            }
        />
    ),
}));
function restored(step = 2): ModelingAdvisorSnapshot {
    const container = createBlankContainer('Orders');
    container.scale.candidates[0].distinctValues = 872;
    return {
        wizard: {
            ...createInitialSnapshot().wizard,
            scenario: 'other',
            step,
            dataModel: { containers: [container], activeContainerId: container.id },
        },
        recommendation: {
            status: 'received',
            value: {
                summary: 'Restored result',
                containers: [
                    {
                        entity: 'Orders',
                        partitionKey: '/orderId',
                        rationale: '',
                        guardrails: [{ rule: 'Immutability', detail: 'Order IDs remain unchanged for each order.' }],
                        candidates: [
                            {
                                partitionKey: '/orderId',
                                score: 100,
                                verdict: 'recommended',
                                assessments: [],
                            },
                        ],
                    },
                ],
            },
        },
    };
}

function lastSave(): ModelingAdvisorSnapshot {
    return client.dataModeling.saveState.mutate.mock.calls.at(-1)?.[0] as ModelingAdvisorSnapshot;
}

function usage() {
    const events = client.dataModeling.recordTelemetry.mutate.mock.calls.map(
        ([event]) => event as ModelingTelemetryEvent,
    );
    const last = events.filter((event) => event.type === 'usage').at(-1);
    if (!last) throw new Error('No usage summary received');
    return last.usage;
}

function deployedSnapshot(): ModelingAdvisorSnapshot {
    return {
        ...restored(4),
        deployment: {
            input: {
                databaseMode: 'existing',
                databaseName: 'existing-db',
                containers: [{ entity: 'Orders', partitionKey: '/orderId' }],
            },
            result: { status: 'deployed', databaseName: 'existing-db', createdCount: 0, existingCount: 1 },
        },
    };
}

function render(element: ReactElement) {
    return renderReact(<FluentProvider theme={webLightTheme}>{element}</FluentProvider>);
}

let respondToConfirmation: ((result: boolean | undefined) => void) | undefined;

async function answerConfirmation(message: string | RegExp, result: boolean | undefined) {
    await waitFor(() => {
        expect(respondToConfirmation).toBeTypeOf('function');
        expect(client.dataModeling.confirm.mutate.mock.calls.at(-1)?.[0].message).toMatch(message);
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await act(async () => {
        respondToConfirmation!(result);
        respondToConfirmation = undefined;
    });
}

async function getStepControl(name: string): Promise<HTMLElement> {
    const navigation = within(screen.getByRole('navigation', { name: 'Data modeling steps' }));
    const normalizeName = (value: string) => value.replace(/\s+/g, ' ').replace(/:\s*/g, ': ').trim();
    const matchesName = (accessibleName: string) => normalizeName(accessibleName) === normalizeName(name);
    const visibleStep = navigation.queryByRole('button', { name: matchesName });
    if (visibleStep) return visibleStep;

    const overflowedStep = screen.queryByRole('menuitem', { name: matchesName });
    if (overflowedStep) return overflowedStep;

    const overflowButton = navigation.queryByRole('button', { name: /^\d+ more steps?$/ });
    if (!overflowButton) {
        throw new Error(`Step "${name}" is not available in the navigation.`);
    }

    await userEvent.click(overflowButton);
    return screen.getByRole('menuitem', { name: matchesName });
}

async function continueExisting() {
    await screen.findByRole('navigation', { name: 'Data modeling steps' });
}

async function enterDeployStep() {
    const button = screen.getAllByRole('button', { name: 'Deploy' }).find((element) => !element.closest('nav'));
    if (!button) {
        throw new Error('Result Deploy button not found');
    }
    expect(button).toHaveTextContent('Deploy');
    expect(button).toHaveAccessibleName('Deploy');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    await userEvent.click(button);
}

async function confirmAdvance() {
    await answerConfirmation('Restart from this step?', true);
}

async function confirmDeployment() {
    await answerConfirmation(/^Deploy data model to/, true);
}

/**
 * Asserts that no Deploy affordance can be activated. The footer button is a Fluent `Button` and
 * renders a plain `disabled`, while the breadcrumb step is `disabledFocusable`: it deliberately stays
 * in the tab order and reports `aria-disabled` instead, so both mechanisms have to be accepted here.
 */
function expectNoActionableDeployButton() {
    const deployButtons = screen.getAllByRole('button', { name: 'Deploy' });
    expect(deployButtons.length).toBeGreaterThan(0);
    const actionable = deployButtons.filter((button) => !button.matches(':disabled, [aria-disabled="true"]'));
    expect(actionable.map((button) => button.textContent)).toEqual([]);
}

describe('data modeler saved-work choice and revisiting steps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        respondToConfirmation = undefined;
        client.dataModeling.confirm.mutate.mockImplementation(
            () =>
                new Promise<boolean | undefined>((resolve) => {
                    respondToConfirmation = resolve;
                }),
        );
        client.dataModeling.loadState.query.mockResolvedValue(null);
        client.dataModeling.promptContainerName.mutate.mockResolvedValue(undefined);
        client.dataModeling.saveState.mutate.mockResolvedValue(undefined);
        client.dataModeling.requestRecommendation.mutate.mockResolvedValue(undefined);
        client.dataModeling.stopWaitingForRecommendation.mutate.mockReset().mockResolvedValue(true);
        client.dataModeling.recordTelemetry.mutate.mockResolvedValue(undefined);
        client.dataModeling.getDeploymentOptions.query.mockResolvedValue({
            accountName: 'source',
            databases: ['existing-db'],
        });
        client.dataModeling.generateDeploymentTemplate.query.mockImplementation(
            async (input: DeploymentTemplateInput) =>
                `// ${input.databaseMode} ${input.databaseName}: ${input.containers.map((container) => container.entity).join(', ')}`,
        );
        client.dataModeling.deploy.mutate.mockResolvedValue({ status: 'cancelled' });
        client.dataModeling.downloadDeploymentTemplate.mutate.mockResolvedValue('saved');
        client.dataModeling.openDataExplorer.mutate.mockResolvedValue(undefined);
        client.dataModeling.events.subscribe.mockReturnValue({ unsubscribe: vi.fn() });
    });

    it('reserves badge space beside a wrapping title and keeps the footer outside the sticky-navigation scroll region', async () => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 280, 32));
        const saved = restored(4);
        saved.wizard.scenario = 'inventory';
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        const navigation = screen.getByRole('navigation', { name: 'Data modeling steps' });
        const scrollRegion = navigation.closest('[data-header-behavior="sticky-navigation"]');
        expect(scrollRegion).toHaveAttribute('tabindex', '0');
        const content = scrollRegion?.firstElementChild;
        expect(content).toContainElement(navigation);
        expect(content).toHaveStyle({ maxWidth: 'none', padding: '24px' });
        const title = screen.getByRole('heading', { name: 'Workload: Inventory & Supply Chain' });
        expect(scrollRegion).toContainElement(title);
        expect(title).toHaveAccessibleName(title.textContent);
        const preview = screen.getByLabelText('Preview');
        expect(preview).toHaveClass('fui-Badge');
        expect(preview).toBeVisible();
        expect(preview).toHaveTextContent('Preview');
        expect(preview).toHaveAccessibleName('Preview');
        expect(preview).toHaveAttribute('tabindex', '0');
        expect(preview).toHaveStyle({
            position: 'absolute',
            top: '10px',
            right: '20px',
            marginTop: '0px',
            marginRight: '0px',
            height: '32px',
        });
        expect(scrollRegion).not.toContainElement(preview);
        expect(preview.parentElement).toHaveStyle({ position: 'relative' });
        expect(preview.parentElement?.style.getPropertyValue('--preview-badge-clearance')).toBe('308px');
        expect(navigation).toHaveStyle({ marginRight: 'var(--preview-badge-clearance)' });
        expect(preview.parentElement).toContainElement(scrollRegion as HTMLElement);
        expect(title.parentElement?.parentElement).toHaveStyle({ paddingRight: '308px' });
        expect(title.parentElement).toHaveStyle({ minWidth: '0px' });
        expect(title.firstElementChild).toHaveStyle({ overflowWrap: 'anywhere' });
        const titleIcon = title.parentElement?.parentElement?.querySelector('svg');
        expect(titleIcon).toBeVisible();
        expect(titleIcon).toHaveAttribute('aria-hidden', 'true');
        expect(titleIcon).toHaveAttribute('focusable', 'false');
        expect(titleIcon?.parentElement).toHaveStyle({ height: '56px' });
        expect(title.parentElement?.parentElement).toHaveStyle({ alignItems: 'center' });
        expect(scrollRegion).toContainElement(screen.getByRole('heading', { name: 'Partition key recommendation' }));
        expect(scrollRegion).not.toContainElement(screen.getByRole('button', { name: 'Start Over' }));
        expect(within(navigation).getByRole('button', { name: 'Result' })).toHaveAttribute('aria-current', 'step');
    });

    it('keeps a single merged template subtitle above all container tabs', async () => {
        const user = userEvent.setup();
        const saved = createInitialSnapshot();
        saved.wizard = { ...applyScenario(saved.wizard, 'chat'), step: 2 };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        const subtitle =
            'Pre-filled a Chat & Sessions sample template. Switch tabs to edit this container’s data, queries and scale to match your app. Each container gets its own partition-key recommendation.';
        const notice = screen.getByText(subtitle);
        const tabs = screen.getByRole('tablist');
        expect(notice.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        for (const tab of ['Data', 'Queries', 'Scale']) {
            await user.click(screen.getByRole('tab', { name: tab }));
            expect(screen.getAllByText(/Pre-filled/)).toHaveLength(1);
            expect(notice).toBeVisible();
        }
    });

    it('supports keyboard step navigation, focuses its heading, and unmounts the previous content', async () => {
        const user = userEvent.setup();
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        const review = screen.getByRole('button', { name: 'Review' });
        expect(review).toHaveTextContent('Review');
        expect(review).toHaveAccessibleName('Review');
        review.focus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Review your inputs' })).toHaveFocus());
        expect(screen.queryByRole('region', { name: 'Partition key recommendation' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute('aria-current', 'step');
        expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
    });

    it('bolds only the selected step while preserving green completion checks when revisiting a step', async () => {
        const user = userEvent.setup();
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        const navigation = screen.getByRole('navigation', { name: 'Data modeling steps' });
        const result = within(navigation).getByRole('button', { name: 'Result' });
        const review = within(navigation).getByRole('button', { name: 'Review' });
        // jsdom does not resolve selector specificity like a browser; inspect the scoped override directly.
        const selectedRule = Array.from(document.styleSheets)
            .flatMap((sheet) => Array.from(sheet.cssRules))
            .find(
                (rule): rule is CSSStyleRule =>
                    rule instanceof CSSStyleRule &&
                    rule.selectorText.endsWith('[aria-current="step"]') &&
                    rule.style.getPropertyValue('font-weight') === tokens.fontWeightBold,
            );
        expect(selectedRule).toBeDefined();
        expect(result.matches(selectedRule!.selectorText)).toBe(true);
        expect(review.matches(selectedRule!.selectorText)).toBe(false);
        expect(review.querySelector('svg')).toHaveStyle({ color: tokens.colorPaletteGreenForeground1 });

        await user.click(review);

        expect(navigation.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
        expect(review).toHaveAttribute('aria-current', 'step');
        expect(review.matches(selectedRule!.selectorText)).toBe(true);
        expect(result).not.toHaveAttribute('aria-current');
        expect(result.matches(selectedRule!.selectorText)).toBe(false);
        expect(review.querySelector('svg')).toHaveStyle({ color: tokens.colorPaletteGreenForeground1 });
        expect(result.querySelector('svg')).toHaveStyle({ color: tokens.colorPaletteGreenForeground1 });
    });

    it('deploys directly from the final step without generating or submitting Bicep or saving deployment state', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        const steps = within(screen.getByRole('navigation', { name: 'Data modeling steps' }));
        expect(steps.getAllByRole('button').map((button) => button.textContent)).toEqual([
            'Workload',
            'Container:Orders',
            'Review',
            'Result',
            'Deploy',
        ]);
        expect(client.dataModeling.getDeploymentOptions.query).not.toHaveBeenCalled();
        await enterDeployStep();
        const section = within(screen.getByRole('region', { name: 'Deploy data model' }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Deploy data model' })).toHaveFocus());
        await screen.findByText('source', { selector: 'dd' });
        expect(client.dataModeling.deploy.mutate).not.toHaveBeenCalled();
        fireEvent.change(section.getByRole('textbox', { name: 'New database name' }), {
            target: { value: 'fresh-db' },
        });
        const deploy = section.getByRole('button', { name: 'Deploy' });
        await waitFor(() => expect(deploy).toBeEnabled());
        expect(section.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        expect(client.dataModeling.generateDeploymentTemplate.query).not.toHaveBeenCalled();
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledWith({
            databaseMode: 'new',
            databaseName: 'fresh-db',
            containers: [{ entity: 'Orders', partitionKey: '/orderId' }],
        });
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('downloads the current deployment editor contents through the host route without deploying', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        await enterDeployStep();
        await screen.findByText('source', { selector: 'dd' });
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: 'fresh-db' } });
        await userEvent.click(screen.getByRole('radio', { name: 'Bicep' }));
        const editor = screen.getByRole('textbox', { name: 'Bicep deployment template' });
        await waitFor(() => expect(editor).toHaveValue('// new fresh-db: Orders'));
        fireEvent.change(editor, { target: { value: '// my edited Bicep' } });
        await userEvent.click(screen.getByRole('button', { name: 'Download' }));
        expect(client.dataModeling.downloadDeploymentTemplate.mutate).toHaveBeenCalledExactlyOnceWith({
            format: 'bicep',
            databaseName: 'fresh-db',
            template: '// my edited Bicep',
        });
        expect(client.dataModeling.recordTelemetry.mutate).toHaveBeenCalledWith({
            type: 'action',
            action: 'downloadCode',
            method: 'bicep',
            outcome: 'success',
            codeCustomized: true,
        });
        expect(screen.getByText('Code downloaded.')).toBeVisible();
        expect(client.dataModeling.deploy.mutate).not.toHaveBeenCalled();
    });

    it('keeps a deployment draft on Back but does not restore it or Deploy navigation after reopening', async () => {
        const saved = restored(4);
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await enterDeployStep();
        await userEvent.click(screen.getByRole('radio', { name: 'Bicep' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
            target: { value: 'unsaved-db' },
        });
        await waitFor(() =>
            expect(screen.getByRole('textbox', { name: 'Bicep deployment template' })).toHaveValue(
                '// new unsaved-db: Orders',
            ),
        );
        fireEvent.change(screen.getByRole('textbox', { name: 'Bicep deployment template' }), {
            target: { value: '// unsaved Bicep' },
        });
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('img', { name: /100.*Orders.*\/orderId/ })).toBeVisible();
        expect(screen.queryByText("Copilot's analysis of your workload profile.")).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^(Show|Hide) details$/ })).not.toBeInTheDocument();
        await enterDeployStep();
        expect(screen.getByRole('radio', { name: 'Bicep' })).toBeChecked();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('unsaved-db');
        expect(screen.getByRole('textbox', { name: 'Bicep deployment template' })).toHaveValue('// unsaved Bicep');
        await userEvent.click(screen.getByRole('checkbox', { name: 'Orders' }));
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        mounted.unmount();
        render(<DataModelingWizard />);
        await continueExisting();
        expect(screen.getByRole('img', { name: /100.*Orders.*\/orderId/ })).toBeVisible();
        expect(screen.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        await enterDeployStep();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('');
        expect(screen.getByRole('radio', { name: 'Direct' })).toBeChecked();
        expect(screen.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('radio', { name: 'Bicep' }));
        expect(screen.getByRole('textbox', { name: 'Bicep deployment template' })).toHaveValue('');
        expect(screen.getByRole('checkbox', { name: 'Orders' })).toBeChecked();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('restores saved deployment success, green step and portal action after closing and reopening', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        client.dataModeling.deploy.mutate.mockResolvedValueOnce({
            status: 'deployed',
            databaseName: 'fresh-db',
            createdCount: 1,
            existingCount: 0,
        });
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await enterDeployStep();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: 'fresh-db' } });
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(await screen.findByRole('region', { name: 'Deployment successful' })).toBeVisible();

        client.dataModeling.getDeploymentOptions.query.mockResolvedValue({
            accountName: 'source',
            databases: ['existing-db', 'fresh-db'],
        });
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        await enterDeployStep();
        const success = within(screen.getByRole('region', { name: 'Deployment successful' }));
        expect(
            success.getByText('Data model deployed to "fresh-db": 1 container(s) created, 0 left unchanged.'),
        ).toBeVisible();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('fresh-db');
        const explorer = success.getByRole('button', { name: 'Open in Data Explorer' });
        expect(explorer).toHaveAccessibleName('Open in Data Explorer');
        await userEvent.click(explorer);
        expect(client.dataModeling.openDataExplorer.mutate).toHaveBeenCalledWith({
            databaseId: 'fresh-db',
            containerId: 'Orders',
        });
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledOnce();
        await waitFor(() => expect(lastSave().deployment?.result.databaseName).toBe('fresh-db'));
        const saved = ModelingAdvisorSnapshotSchema.parse(JSON.parse(JSON.stringify(lastSave())));
        expect(saved.deployment?.input).toEqual({
            databaseMode: 'new',
            databaseName: 'fresh-db',
            containers: [{ entity: 'Orders', partitionKey: '/orderId' }],
        });
        expect(saved.deployment).not.toHaveProperty('template');
        mounted.unmount();
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        expect(await screen.findByRole('region', { name: 'Deployment successful' })).toBeVisible();
        expect(
            within(screen.getByRole('navigation', { name: 'Data modeling steps' }))
                .getByRole('button', {
                    name: 'Deploy',
                })
                .querySelector('svg'),
        ).toHaveStyle({ color: tokens.colorPaletteGreenForeground1 });
        expect(
            screen.getByText('Data model deployed to "fresh-db": 1 container(s) created, 0 left unchanged.'),
        ).toBeVisible();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('fresh-db');
        await userEvent.click(screen.getByRole('button', { name: 'Open in Data Explorer' }));
        expect(client.dataModeling.openDataExplorer.mutate).toHaveBeenLastCalledWith({
            databaseId: 'fresh-db',
            containerId: 'Orders',
        });
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledOnce();

        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
            target: { value: 'another-db' },
        });
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: 'fresh-db' } });
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        await enterDeployStep();
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledOnce();
        await waitFor(() => expect(lastSave().deployment).toBeUndefined());
        expect(
            within(screen.getByRole('navigation', { name: 'Data modeling steps' }))
                .getByRole('button', {
                    name: 'Deploy',
                })
                .querySelector('svg'),
        ).not.toHaveStyle({ color: tokens.colorPaletteGreenForeground1 });
    });

    it('locks navigation during deployment and saves only its successful completion, not its template', async () => {
        let finish!: (result: {
            status: 'deployed';
            databaseName: string;
            createdCount: number;
            existingCount: number;
        }) => void;
        client.dataModeling.deploy.mutate.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        await enterDeployStep();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: 'fresh-db' } });
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Start Over' })).toBeDisabled();
        for (const name of ['Workload', 'Container: Orders', 'Review', 'Result']) {
            const step = await getStepControl(name);
            expect(step).toHaveAttribute('aria-disabled', 'true');
            await userEvent.click(step);
            expect(screen.getByRole('region', { name: 'Deploy data model' })).toBeVisible();
        }
        await act(async () =>
            finish({ status: 'deployed', databaseName: 'fresh-db', createdCount: 1, existingCount: 0 }),
        );
        expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
        await waitFor(() =>
            expect(lastSave().deployment?.result).toEqual({
                status: 'deployed',
                databaseName: 'fresh-db',
                createdCount: 1,
                existingCount: 0,
            }),
        );
        expect(lastSave().deployment).not.toHaveProperty('template');
    });

    it('restores an existing-database deployment and clears saved completion when a retry is cancelled', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(deployedSnapshot());
        render(<DataModelingWizard />);
        await continueExisting();
        expect(await screen.findByRole('region', { name: 'Deployment successful' })).toBeVisible();
        expect(screen.getByRole('radio', { name: 'Existing database' })).toBeChecked();
        expect(screen.getByRole('combobox', { name: 'Existing database' })).toHaveTextContent('existing-db');
        expect(
            screen.getByText('Data model deployed to "existing-db": 0 container(s) created, 1 left unchanged.'),
        ).toBeVisible();
        expect(client.dataModeling.deploy.mutate).not.toHaveBeenCalled();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(await screen.findByText('Deployment cancelled. No deployment was started.')).toBeVisible();
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        await waitFor(() => expect(client.dataModeling.saveState.mutate).toHaveBeenCalled());
        expect(lastSave().deployment).toBeUndefined();
    });

    it.each(['Start Over', 'new recommendation'] as const)('clears persisted completion on %s', async (action) => {
        client.dataModeling.loadState.query.mockResolvedValue(deployedSnapshot());
        render(<DataModelingWizard />);
        await continueExisting();
        await screen.findByRole('region', { name: 'Deployment successful' });
        if (action === 'Start Over') {
            await userEvent.click(screen.getByRole('button', { name: 'Start Over' }));
        } else {
            await userEvent.click(
                within(screen.getByRole('navigation', { name: 'Data modeling steps' })).getByRole('button', {
                    name: 'Review',
                }),
            );
            await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
            await confirmAdvance();
        }
        await waitFor(() =>
            expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(
                action === 'new recommendation' ? 1 : 0,
            ),
        );
        await waitFor(() => expect(client.dataModeling.saveState.mutate).toHaveBeenCalled());
        expect(lastSave().deployment).toBeUndefined();
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
        expect(client.dataModeling.deploy.mutate).not.toHaveBeenCalled();
    });

    it('keeps deployment success visible after a save failure and retries saving without deploying again', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        client.dataModeling.saveState.mutate.mockRejectedValueOnce(new Error('Disk full'));
        client.dataModeling.deploy.mutate.mockResolvedValueOnce({
            status: 'deployed',
            databaseName: 'fresh-db',
            createdCount: 1,
            existingCount: 0,
        });
        render(<DataModelingWizard />);
        await continueExisting();
        await enterDeployStep();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: 'fresh-db' } });
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        const retry = await screen.findByRole('button', { name: 'Retry saving' });
        expect(screen.getByRole('region', { name: 'Deployment successful' })).toBeVisible();
        expect(screen.queryByText(/Deployment failed/)).not.toBeInTheDocument();
        await userEvent.click(retry);
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry saving' })).not.toBeInTheDocument());
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledOnce();
        expect(client.dataModeling.saveState.mutate).toHaveBeenCalledTimes(2);
        expect(lastSave().deployment?.result.databaseName).toBe('fresh-db');
    });

    it.each(['idle', 'waiting', 'stopped', 'error'] as const)(
        'does not unlock Deploy for a %s recommendation',
        async (status) => {
            const saved = restored(4);
            saved.recommendation = { status };
            client.dataModeling.loadState.query.mockResolvedValue(saved);
            render(<DataModelingWizard />);
            await continueExisting();
            expectNoActionableDeployButton();
            expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
        },
    );

    it('opens directly on Workload with no saved project', async () => {
        render(<DataModelingWizard />);
        expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('does not emit workload selections when continuing saved work', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(1));
        render(<DataModelingWizard />);
        await continueExisting();
        expect(usage().scenario).toBe('other');
        expect(
            client.dataModeling.recordTelemetry.mutate.mock.calls.some(
                ([event]) => (event as ModelingTelemetryEvent).type === 'scenarioSelected',
            ),
        ).toBe(false);
    });

    it('hydrates the host-selected saved model without prompting or autosaving', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        expect(client.dataModeling.confirm.mutate).not.toHaveBeenCalled();
        expect(await screen.findByRole('img', { name: /100.*Orders.*\/orderId/ })).toBeVisible();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('hydrates a fresh model selected by the host without saving again', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(createInitialSnapshot());
        render(<DataModelingWizard />);
        expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        expect(client.dataModeling.confirm.mutate).not.toHaveBeenCalled();
        expect(screen.queryByRole('img', { name: /100.*Orders.*\/orderId/ })).not.toBeInTheDocument();
    });

    it.each([true, false, undefined])('removes a container only after native Yes (response: %s)', async (response) => {
        const saved = restored();
        saved.wizard.dataModel.containers.push(createBlankContainer('Users'));
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        const description =
            "Removes this container from your model. Doesn't delete any container or data in your Azure account.";
        const remove = screen.getByRole('button', { name: 'Remove from model' });
        expect(remove).toHaveTextContent('Remove from model');
        expect(remove).toHaveAccessibleName('Remove from model');
        expect(remove).toHaveAccessibleDescription(description);
        await userEvent.click(remove);
        expect(client.dataModeling.confirm.mutate).toHaveBeenLastCalledWith({
            message: 'Remove from model?',
            detail: `Remove the “Orders” container? This cannot be undone. ${description}`,
            buttons: { primary: 'Yes', secondary: 'No', secondaryIsCloseAffordance: true },
        });
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await answerConfirmation('Remove from model?', response);
        expect(client.dataModeling.saveState.mutate).toHaveBeenCalledTimes(response === true ? 1 : 0);
        expect((lastSave() ?? saved).wizard.dataModel.containers.map((container) => container.entity)).toEqual(
            response === true ? ['Users'] : ['Orders', 'Users'],
        );
        expect(remove).toHaveProperty('disabled', response === true);
        expect(document.activeElement === remove).toBe(response !== true);
    });

    it('adds a validated name from the native input box without rendering a modal', async ({ onTestFinished }) => {
        // jsdom's zero-width navigation triggers Fluent's synchronous test-only overflow path when adding a step.
        const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
        onTestFinished(() => width.mockRestore());
        client.dataModeling.loadState.query.mockResolvedValue(restored());
        let submitName: (value: string | undefined) => void = () => {
            throw new Error('Input not opened');
        };
        client.dataModeling.promptContainerName.mutate.mockImplementationOnce(
            () =>
                new Promise<string | undefined>((resolve) => {
                    submitName = resolve;
                }),
        );
        render(<DataModelingWizard />);
        await continueExisting();
        const add = screen.getByRole('button', { name: 'Add container' });
        expect(add).toHaveTextContent('Add container');
        expect(add).toHaveAccessibleName('Add container');
        await userEvent.click(add);
        expect(client.dataModeling.promptContainerName.mutate).toHaveBeenCalledWith({ existingNames: ['Orders'] });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Container name' })).not.toBeInTheDocument();
        expect(add).toBeDisabled();
        fireEvent.click(add);
        expect(client.dataModeling.promptContainerName.mutate).toHaveBeenCalledOnce();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await act(async () => submitName('New Orders=1'));
        await waitFor(() =>
            expect(lastSave().wizard.dataModel.containers.map((container) => container.entity)).toEqual([
                'Orders',
                'New Orders=1',
            ]),
        );
    });

    it.each([undefined, '', ' ', 'bad/name', ' Orders ', 'New Orders ', 'Orders', 'x'.repeat(256)])(
        'does not add or save cancelled or invalid native input %j',
        async (name) => {
            client.dataModeling.loadState.query.mockResolvedValue(restored());
            client.dataModeling.promptContainerName.mutate.mockResolvedValueOnce(name);
            render(<DataModelingWizard />);
            await continueExisting();
            const add = screen.getByRole('button', { name: 'Add container' });
            await userEvent.click(add);
            await waitFor(() => expect(add).toBeEnabled());
            expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
            const errors = screen.queryAllByRole('alert').filter((element) => element.textContent);
            expect(errors).toHaveLength(name === undefined ? 0 : 1);
        },
    );

    it.each([
        { action: 'Add container', containerCount: 1, focusTarget: 'Add container' },
        { action: 'Retry', containerCount: 1, focusTarget: 'Add container' },
        { action: 'Retry', containerCount: MAX_CONTAINERS - 1, focusTarget: 'Next' },
    ])(
        'surfaces native input failures above the footer and retries via $action with $containerCount containers',
        async ({ action, containerCount, focusTarget }) => {
            const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
            onTestFinished(() => width.mockRestore());
            const saved = restored();
            saved.wizard.dataModel.containers.push(
                ...Array.from({ length: containerCount - 1 }, (_, index) => createBlankContainer(`Container${index}`)),
            );
            client.dataModeling.loadState.query.mockResolvedValue(saved);
            client.dataModeling.promptContainerName.mutate.mockRejectedValueOnce(new Error('Input unavailable'));
            let submitName: (value: string | undefined) => void = () => {
                throw new Error('Retry input not opened');
            };
            client.dataModeling.promptContainerName.mutate.mockImplementationOnce(
                () =>
                    new Promise<string | undefined>((resolve) => {
                        submitName = resolve;
                    }),
            );
            render(<DataModelingWizard />);
            await continueExisting();
            const add = screen.getByRole('button', { name: 'Add container' });
            await userEvent.click(add);
            const error = await screen.findByText('Could not add the container. Please try again.');
            expect(error).toHaveAttribute('role', 'alert');
            expect(screen.getAllByText('Could not add the container. Please try again.')).toHaveLength(1);
            expect(screen.getByLabelText('Preview')).toHaveStyle({ top: '10px', right: '20px' });
            expect(error.parentElement?.nextElementSibling).toContainElement(add);
            const retry = within(error.parentElement!).getByRole('button', { name: 'Retry' });
            expect(retry).toHaveTextContent('Retry');
            expect(retry).toHaveAccessibleName('Retry');
            expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
            await userEvent.click(action === 'Retry' ? retry : add);
            expect(client.dataModeling.promptContainerName.mutate).toHaveBeenCalledTimes(2);
            expect(screen.queryByText('Could not add the container. Please try again.')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
            expect(add).toBeDisabled();
            fireEvent.click(add);
            expect(client.dataModeling.promptContainerName.mutate).toHaveBeenCalledTimes(2);
            await act(async () => submitName('Recovered'));
            await waitFor(() =>
                expect(lastSave().wizard.dataModel.containers.map((container) => container.entity)).toEqual([
                    ...saved.wizard.dataModel.containers.map((container) => container.entity),
                    'Recovered',
                ]),
            );
            expect(add).toHaveProperty('disabled', containerCount + 1 === MAX_CONTAINERS);
            const focusedButton = screen.getByRole('button', { name: focusTarget });
            expect(focusedButton).toBeEnabled();
            expect(focusedButton).toHaveTextContent(focusTarget);
            expect(focusedButton).toHaveAccessibleName(focusTarget);
            expect(focusedButton).toHaveFocus();
        },
    );

    it('rechecks duplicate names against model edits made while the native input is open', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored());
        let submitName: (value: string) => void = () => {
            throw new Error('Input not opened');
        };
        client.dataModeling.promptContainerName.mutate.mockImplementationOnce(
            () =>
                new Promise<string>((resolve) => {
                    submitName = resolve;
                }),
        );
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Add container' }));
        await userEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Container name' }), { target: { value: 'Users' } });
        await userEvent.click(screen.getByRole('button', { name: 'Save container name' }));
        await waitFor(() => expect(lastSave().wizard.dataModel.containers[0].entity).toBe('Users'));
        client.dataModeling.saveState.mutate.mockClear();
        await act(async () => submitName('Users'));
        expect(screen.getByText('A container with this name already exists in the model.')).toHaveAttribute(
            'role',
            'alert',
        );
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('validates container renaming on both Save and Enter and allows the unchanged name', async () => {
        const saved = restored();
        saved.wizard.dataModel.containers.push(createBlankContainer('Users'));
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
        const nameInput = screen.getByRole('textbox', { name: 'Container name' });
        const save = screen.getByRole('button', { name: 'Save container name' });
        expect(save).toBeEnabled();
        for (const name of [
            'bad/name',
            'Users',
            ' Users ',
            'Updated Orders ',
            ' Updated Orders',
            '',
            'x'.repeat(256),
        ]) {
            fireEvent.change(nameInput, { target: { value: name } });
            expect(nameInput).toHaveAttribute('aria-invalid', 'true');
            expect(nameInput).toHaveAccessibleDescription();
            expect(save).toBeDisabled();
            fireEvent.keyDown(nameInput, { key: 'Enter' });
            expect(nameInput).toBeVisible();
            expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        }
        fireEvent.change(nameInput, { target: { value: 'Updated Orders' } });
        fireEvent.keyDown(nameInput, { key: 'Enter' });
        await waitFor(() => expect(lastSave().wizard.dataModel.containers[0].entity).toBe('Updated Orders'));
    });

    it('preserves inputs and cardinality, but does not save tabs, draft properties, or dialogs', async () => {
        const user = userEvent.setup();
        const saved = restored();
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await user.click(screen.getByRole('tab', { name: 'Scale' }));
        const distinctValues = screen.getByRole('combobox', { name: 'Estimated distinct values for id' });
        expect(distinctValues).toHaveValue('1000');
        expect(within(distinctValues).getByRole('option', { selected: true })).toHaveTextContent(
            'Hundreds – thousands',
        );
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await user.click(screen.getByRole('tab', { name: 'Data' }));
        fireEvent.change(screen.getByPlaceholderText('Add property…'), { target: { value: 'draft' } });
        let submitName: (value: string) => void = () => {
            throw new Error('Input not opened');
        };
        client.dataModeling.promptContainerName.mutate.mockImplementationOnce(
            () =>
                new Promise<string>((resolve) => {
                    submitName = resolve;
                }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Add container' }));
        expect(client.dataModeling.promptContainerName.mutate).toHaveBeenCalledOnce();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        mounted.unmount();
        await act(async () => submitName('unsaved name'));
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        render(<DataModelingWizard />);
        await continueExisting();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByPlaceholderText('Add property…')).toHaveValue('');
        await user.click(screen.getByRole('button', { name: 'Next' }));
        await answerConfirmation('Configure queries and scale?', false);
        expect(lastSave().wizard).toEqual({
            ...saved.wizard,
            step: 3,
            reachedSteps: ['workload', `container:${saved.wizard.dataModel.activeContainerId}`, 'review'],
        });
        const { deployment, ...modelingState } = lastSave();
        expect(deployment).toBeUndefined();
        expect(Object.keys(modelingState).sort()).toEqual(['recommendation', 'wizard']);
    });

    it('prompts before leaving unvisited container tabs and focuses Queries when choosing Configure', async () => {
        const saved = restored();
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        client.dataModeling.confirm.mutate.mockClear();
        const next = screen.getByRole('button', { name: 'Next' });
        expect(next).toHaveTextContent('Next');
        expect(next).toHaveAccessibleName('Next');
        await userEvent.click(next);
        expect(client.dataModeling.confirm.mutate).toHaveBeenCalledExactlyOnceWith({
            message: 'Configure queries and scale?',
            detail: 'You have not visited the Queries or Scale tabs for this container. Configure them now, or go to the next step?',
            buttons: { primary: 'Configure', secondary: 'Next' },
        });
        expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await userEvent.click(next);
        expect(client.dataModeling.confirm.mutate).toHaveBeenCalledOnce();
        await answerConfirmation('Configure queries and scale?', true);
        const queries = screen.getByRole('tab', { name: 'Queries' });
        expect(queries).toHaveTextContent('Queries');
        expect(queries).toHaveAccessibleName('Queries');
        expect(queries).toHaveAttribute('aria-selected', 'true');
        expect(queries).toHaveFocus();
        expect(screen.getByRole('textbox', { name: 'Description for read 1' })).toBeVisible();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('tab', { name: 'Data' }));
        await userEvent.click(next);
        expect(client.dataModeling.confirm.mutate).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Get Recommendation' })).toBeVisible();
    });

    it('stays on Data after dismissal, then advances to Review when choosing Next', async () => {
        const saved = restored();
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        const next = screen.getByRole('button', { name: 'Next' });
        await userEvent.click(next);
        await answerConfirmation('Configure queries and scale?', undefined);
        expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
        expect(next).toHaveFocus();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await userEvent.click(next);
        await answerConfirmation('Configure queries and scale?', false);
        expect(screen.getByRole('button', { name: 'Get Recommendation' })).toBeVisible();
        expect(lastSave().wizard.dataModel).toEqual(saved.wizard.dataModel);
    });

    it.each([
        { tab: 'Queries', returnToData: false },
        { tab: 'Queries', returnToData: true },
        { tab: 'Scale', returnToData: false },
        { tab: 'Scale', returnToData: true },
    ])('does not prompt after visiting $tab (return to Data: $returnToData)', async ({ tab, returnToData }) => {
        const saved = restored();
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        client.dataModeling.confirm.mutate.mockClear();
        const user = userEvent.setup();
        screen.getByRole('tab', { name: tab }).focus();
        await user.keyboard('{Enter}');
        if (returnToData) {
            await user.click(screen.getByRole('tab', { name: 'Data' }));
        }
        await user.click(screen.getByRole('button', { name: 'Next' }));
        expect(client.dataModeling.confirm.mutate).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Get Recommendation' })).toBeVisible();
    });

    it('tracks visits per container and remembers them when revisiting a step', async () => {
        const saved = restored();
        saved.recommendation = { status: 'idle' };
        saved.wizard.dataModel.containers.push(createBlankContainer('Users'));
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('tab', { name: 'Scale' }));
        await userEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'Next' }));
        await answerConfirmation('Configure queries and scale?', undefined);
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'Next' }));
        await confirmAdvance();
        await userEvent.click(screen.getByRole('button', { name: 'Next' }));
        await answerConfirmation('Configure queries and scale?', false);
        expect(screen.getByRole('button', { name: 'Get Recommendation' })).toBeVisible();
        expect(lastSave().wizard.dataModel.containers).toEqual(saved.wizard.dataModel.containers);
    });

    it('advances to the next container when choosing Next in the reminder', async () => {
        const saved = restored();
        saved.recommendation = { status: 'idle' };
        const users = createBlankContainer('Users');
        saved.wizard.dataModel.containers.push(users);
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Next' }));
        await answerConfirmation('Configure queries and scale?', false);
        expect(lastSave().wizard.step).toBe(3);
        expect(lastSave().wizard.dataModel.activeContainerId).toBe(users.id);
        expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'Next' }));
        await answerConfirmation('Configure queries and scale?', true);
        expect(screen.getByRole('tab', { name: 'Queries' })).toHaveFocus();
        expect(lastSave().wizard.step).toBe(3);
    });

    it('preserves the existing recommendation when choosing Configure instead of advancing', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored());
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Next' }));
        await answerConfirmation('Configure queries and scale?', true);
        expect(screen.getByRole('tab', { name: 'Queries' })).toHaveAttribute('aria-selected', 'true');
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Result' }));
        expect(screen.getByRole('img', { name: /100.*Orders.*\/orderId/ })).toBeVisible();
    });

    it('keeps Data selected after a reminder failure and allows retry', async () => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 280, 32));
        const saved = restored();
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        client.dataModeling.confirm.mutate.mockRejectedValueOnce(new Error('Dialog unavailable'));
        const next = screen.getByRole('button', { name: 'Next' });
        await userEvent.click(next);
        const message = 'Could not open the confirmation dialog. Please try again.';
        expect(await screen.findByText(message)).toHaveAttribute('role', 'alert');
        expect(screen.getByText(message)).toHaveStyle({ paddingRight: '308px' });
        expect(screen.getByLabelText('Preview')).toHaveStyle({ top: '10px', right: '20px' });
        expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
        expect(next).toHaveFocus();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
        await userEvent.click(next);
        await answerConfirmation('Configure queries and scale?', false);
        expect(screen.queryByText(message)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Get Recommendation' })).toBeVisible();
    });

    it('reports load failures without enabling edits or saving, and retries detection', async () => {
        client.dataModeling.loadState.query
            .mockRejectedValueOnce(new Error('invalid file'))
            .mockResolvedValue(restored());
        render(<DataModelingWizard />);
        await userEvent.click(await screen.findByRole('button', { name: 'Retry loading' }));
        await continueExisting();
        expect(client.dataModeling.confirm.mutate).not.toHaveBeenCalled();
        expect(client.dataModeling.saveState.mutate).not.toHaveBeenCalled();
    });

    it('surfaces a failed edit save and retries the updated state', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        client.dataModeling.saveState.mutate.mockRejectedValueOnce(new Error('disk full'));
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Start Over' }));
        const retry = await screen.findByRole('button', { name: 'Retry saving' });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
        // Status rows share one viewport-height column with the wizard so they cannot add a document scrollbar.
        const viewport = retry.parentElement!.parentElement!;
        expect(viewport).toHaveStyle({
            display: 'flex',
            'flex-direction': 'column',
            height: `${window.innerHeight}px`,
            overflow: 'hidden',
        });
        expect(viewport).toContainElement(screen.getByRole('alert'));
        const wizardHost = screen
            .getByRole('navigation', { name: 'Data modeling steps' })
            .closest('[data-header-behavior]')!.parentElement!.parentElement!;
        expect(viewport).toContainElement(wizardHost);
        expect(wizardHost).toHaveStyle({ flex: '1 1 auto' });
        await userEvent.click(retry);
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry saving' })).not.toBeInTheDocument());
        expect(lastSave()).toEqual(createInitialSnapshot());
    });

    it('saves recommendation events and ignores late events after Start Over', async () => {
        const saved = restored(3);
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await confirmAdvance();
        expect(lastSave().recommendation.status).toBe('waiting');
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: saved.recommendation.value! }));
        expect(lastSave().recommendation).toEqual({
            status: 'received',
            value: saved.recommendation.value,
        });
        await userEvent.click(screen.getByRole('button', { name: 'Start Over' }));
        act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: saved.recommendation.value! }));
        expect(lastSave()).toEqual(createInitialSnapshot());
        expect(await getStepControl('Review')).toHaveAttribute('aria-disabled', 'true');
        expect(await getStepControl('Result')).toHaveAttribute('aria-disabled', 'true');
    });

    it.each(['stopped', 'error'] as const)(
        'returns to Review without changing model inputs from the %s recovery actions',
        async (status) => {
            const saved = restored(4);
            saved.recommendation = { status };
            client.dataModeling.loadState.query.mockResolvedValue(saved);
            render(<DataModelingWizard />);
            await continueExisting();
            const retry = screen.getByRole('button', { name: 'Retry' });
            const edit = screen.getByRole('button', { name: 'Edit model' });
            expect(edit.nextElementSibling).toBe(retry);
            expect(edit).toHaveTextContent('Edit model');
            expect(edit).toHaveAccessibleName('Edit model');
            const primary = status === 'error' ? edit : retry;
            const secondary = status === 'error' ? retry : edit;
            expect(primary).toHaveStyle({ backgroundColor: tokens.colorBrandBackground });
            expect(secondary).toHaveStyle({ backgroundColor: tokens.colorNeutralBackground1 });
            // Restored stopped state focuses Retry in a passive effect; flush it before moving focus to Edit.
            await act(async () => {});
            edit.focus();
            expect(edit).toHaveFocus();
            await userEvent.keyboard('{Enter}');
            await waitFor(() => expect(screen.getByRole('heading', { name: 'Review your inputs' })).toHaveFocus());
            expect(lastSave().wizard.step).toBe(3);
            expect(lastSave().wizard.dataModel).toEqual(saved.wizard.dataModel);
            expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
        },
    );

    it('stops local waiting, preserves inputs, rejects late events, and retries with a fresh request ID', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        const firstRequest = client.dataModeling.requestRecommendation.mutate.mock.calls[0][0] as { requestId: string };
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const stop = screen.getByRole('button', { name: 'Stop waiting' });
        expect(stop).toHaveTextContent('Stop waiting');
        expect(stop).toHaveAccessibleName('Stop waiting');
        expect(stop).toHaveAccessibleDescription(
            'This only resets local tracking; it does not stop the agent in Chat.',
        );
        stop.focus();
        await userEvent.keyboard('{Enter}');
        expect(client.dataModeling.stopWaitingForRecommendation.mutate).toHaveBeenCalledExactlyOnceWith({
            requestId: firstRequest.requestId,
        });
        const retry = await screen.findByRole('button', { name: 'Retry' });
        expect(retry).toHaveTextContent('Retry');
        expect(retry).toHaveAccessibleName('Retry');
        expect(retry).toHaveFocus();
        expect(lastSave().recommendation).toEqual({ status: 'stopped' });
        expect(lastSave().wizard.dataModel).toEqual(saved.wizard.dataModel);
        expectNoActionableDeployButton();
        const result = restored().recommendation.value!;
        for (const requestId of [firstRequest.requestId, undefined]) {
            act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: result, requestId }));
            act(() => callbacks.onData({ type: 'recommendationError', message: 'Late failure', requestId }));
        }
        expect(lastSave().recommendation).toEqual({ status: 'stopped' });
        await userEvent.keyboard(' ');
        await waitFor(() => expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(2));
        const secondRequest = client.dataModeling.requestRecommendation.mutate.mock.calls[1][0] as {
            requestId: string;
        };
        expect(secondRequest.requestId).not.toBe(firstRequest.requestId);
        expect(screen.getByRole('button', { name: 'Stop waiting' })).toHaveFocus();
        for (const requestId of [firstRequest.requestId, undefined]) {
            act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: result, requestId }));
            act(() => callbacks.onData({ type: 'recommendationError', message: 'Late failure', requestId }));
        }
        expect(lastSave().recommendation).toEqual({ status: 'waiting' });
        act(() =>
            callbacks.onData({
                type: 'recommendationReceived',
                recommendation: result,
                requestId: secondRequest.requestId,
            }),
        );
        expect(lastSave().recommendation).toEqual({ status: 'received', value: result });
        expect(screen.getByRole('img', { name: /100.*Orders.*\/orderId/ })).toBeVisible();
    });

    it.each(['declined', 'failed'] as const)(
        'keeps waiting and restores focus when local-stop confirmation is %s',
        async (outcome) => {
            const saved = restored(3);
            saved.recommendation = { status: 'idle' };
            client.dataModeling.loadState.query.mockResolvedValue(saved);
            if (outcome === 'declined')
                client.dataModeling.stopWaitingForRecommendation.mutate.mockResolvedValueOnce(false);
            else
                client.dataModeling.stopWaitingForRecommendation.mutate.mockRejectedValueOnce(
                    new Error('Confirmation unavailable'),
                );
            render(<DataModelingWizard />);
            await continueExisting();
            await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
            await userEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
            const stop = screen.getByRole('button', { name: 'Stop waiting' });
            await waitFor(() => expect(stop).toBeEnabled());
            expect(stop).toHaveFocus();
            expect(lastSave().recommendation).toEqual({ status: 'waiting' });
            expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
            expect(
                screen.queryByText('Could not stop waiting for the recommendation. Please try again.') !== null,
            ).toBe(outcome === 'failed');
            await userEvent.click(stop);
            expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
        },
    );

    it('does not erase a result delivered while stop confirmation is open', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        let confirmStop!: (confirmed: boolean) => void;
        client.dataModeling.stopWaitingForRecommendation.mutate.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    confirmStop = resolve;
                }),
        );
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await userEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
        expect(screen.getByRole('button', { name: 'Stop waiting' })).toBeDisabled();
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const result = restored().recommendation.value!;
        act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: result }));
        await act(async () => confirmStop(true));
        expect(lastSave().recommendation).toEqual({ status: 'received', value: result });
    });

    it('can stop before saving finishes without dispatching the abandoned request', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        let finishSave!: () => void;
        client.dataModeling.saveState.mutate.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishSave = resolve;
                }),
        );
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await userEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
        expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
        await act(async () => finishSave());
        expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
        expect(lastSave().recommendation).toEqual({ status: 'stopped' });
    });

    it('ignores a late launch failure after stopping while Chat dispatch is pending', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        let failDispatch!: (reason: Error) => void;
        client.dataModeling.requestRecommendation.mutate.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    failDispatch = reject;
                }),
        );
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await userEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
        await act(async () => failDispatch(new Error('Late Chat failure')));
        expect(lastSave().recommendation).toEqual({ status: 'stopped' });
        expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    });

    it('restores a stopped session with retry and ignores uncorrelated abandoned results', async () => {
        const saved = restored(4);
        saved.recommendation = { status: 'stopped' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        act(() =>
            callbacks.onData({ type: 'recommendationReceived', recommendation: restored().recommendation.value! }),
        );
        expect(lastSave().recommendation).toEqual({ status: 'waiting' });
    });

    it('shows workload validation on Review and blocks recommendations until the workload is corrected', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        const container = saved.wizard.dataModel.containers[0];
        container.document.avgSizeKb = 11;
        container.document.maxSizeKb = 11;
        container.reads[0].qps = 1_000_000;
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();

        expect(
            screen
                .getByText(/^Orders: Estimated throughput.*Check the query and write rates\.$/)
                .closest('[role="alert"]'),
        ).toHaveTextContent(/^Fix these issues before requesting a recommendation\./);
        const request = screen.getByRole('button', { name: 'Get Recommendation' });
        expect(request).toBeDisabled();
        await userEvent.click(request);
        expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
        expect(await getStepControl('Result')).toHaveAttribute('aria-disabled', 'true');

        await userEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
        await userEvent.click(screen.getByRole('tab', { name: 'Queries' }));
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Peak QPS for read 1' }), {
            target: { value: '100' },
        });
        await userEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.queryByText(/Estimated throughput/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Get Recommendation' })).toBeEnabled();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await waitFor(() => expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledOnce());
    });

    it('waits for the input save before opening Chat', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        let finishSave!: () => void;
        client.dataModeling.saveState.mutate.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishSave = resolve;
                }),
        );
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        expect(lastSave().wizard.step).toBe(4);
        expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
        await act(async () => {
            finishSave();
        });
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledOnce();
    });

    it('preserves the recommendation and forward navigation when browsing completed steps', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(await getStepControl('Review'));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        await userEvent.click(await getStepControl('Result'));
        expect(screen.getByRole('img', { name: /100.*Orders.*\/orderId/ })).toBeVisible();
        expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
    });

    it('preserves model scores, verdicts, and the selected key through save, restore, and deployment', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledWith({
            ...lastSave().wizard,
            requestId: expect.any(String),
        });
        expect(lastSave().wizard.dataModel).toEqual(saved.wizard.dataModel);
        await userEvent.click(await getStepControl('Review'));
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const result = restored().recommendation.value!;
        result.containers[0].partitionKey = '/write';
        result.containers[0].rationale = 'Write distribution best fits this workload.';
        result.containers[0].candidates = [
            {
                partitionKey: '/write',
                score: 100,
                verdict: 'recommended',
                assessments: [],
            },
            {
                partitionKey: '/read',
                score: 0,
                verdict: 'avoid',
                assessments: [],
            },
        ];
        act(() => callbacks.onData({ type: 'recommendationReceived', recommendation: result }));
        const persisted = lastSave();
        expect(persisted.wizard).not.toHaveProperty('weights');
        expect(persisted.recommendation).toEqual({ status: 'received', value: result });
        mounted.unmount();
        client.dataModeling.loadState.query.mockResolvedValue({
            ...persisted,
            wizard: { ...persisted.wizard, step: 4 },
        });
        render(<DataModelingWizard />);
        await continueExisting();
        expect(screen.getByText('/write')).toBeVisible();
        expect(screen.queryByRole('textbox', { name: 'Container creation code sample' })).not.toBeInTheDocument();
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledOnce();
        await enterDeployStep();
        fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
            target: { value: 'model-db' },
        });
        const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
            name: 'Deploy',
        });
        await waitFor(() => expect(deploy).toBeEnabled());
        await userEvent.click(deploy);
        await confirmDeployment();
        expect(client.dataModeling.deploy.mutate).toHaveBeenCalledWith({
            databaseMode: 'new',
            databaseName: 'model-db',
            containers: [{ entity: 'Orders', partitionKey: '/write' }],
        });
    });

    it('shows an explicit recommendation failure, blocks deployment, and allows retry', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const message = 'Cannot recommend a key: provide dominant read predicates and peak QPS.';
        act(() => callbacks.onData({ type: 'recommendationError', message }));
        expect(lastSave().recommendation).toEqual({ status: 'error', error: message });
        expect(screen.getByText(message)).toBeVisible();
        expectNoActionableDeployButton();
        expect(screen.queryByRole('img', { name: /100.*Orders.*\/orderId/ })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(2));
        expect(lastSave().recommendation).toEqual({ status: 'waiting' });
    });

    it('rejects invalid results rather than inventing missing scores', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const invalid = restored().recommendation.value!;
        Reflect.deleteProperty(invalid.containers[0].candidates![0], 'score');
        act(() =>
            callbacks.onData({
                type: 'recommendationReceived',
                recommendation: invalid,
            }),
        );
        expect(lastSave().recommendation.status).toBe('error');
        expect(screen.getByText('The recommendation is invalid. Request a new recommendation.')).toBeInTheDocument();
    });

    it('prefixes only the recommendation action with a decorative sparkle icon', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();

        for (const [step, label] of [
            ['Workload', 'Start'],
            ['Container: Orders', 'Next'],
        ]) {
            await userEvent.click(await getStepControl(step));
            const button = screen.getByRole('button', { name: label });
            expect(button).toHaveTextContent(label);
            expect(button).toHaveAccessibleName(label);
            expect(button.querySelector('svg')).not.toBeInTheDocument();
        }

        await userEvent.click(await getStepControl('Review'));
        const button = screen.getByRole('button', { name: 'Get Recommendation' });
        expect(button).toHaveTextContent('Get Recommendation');
        expect(button).toHaveAccessibleName('Get Recommendation');
        const icon = button.querySelector('svg');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(button.firstElementChild).toContainElement(icon);
    });

    it.each([false, undefined])(
        'keeps the result and restores focus when confirmation is dismissed with %s',
        async (dismissal) => {
            const user = userEvent.setup();
            client.dataModeling.loadState.query.mockResolvedValue(restored(4));
            render(<DataModelingWizard />);
            await continueExisting();
            await user.click(await getStepControl('Review'));
            const next = screen.getByRole('button', { name: 'Get Recommendation' });
            await user.click(next);
            await answerConfirmation('Restart from this step?', dismissal);
            await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
            await waitFor(() => expect(next).toHaveFocus());
            await user.click(await getStepControl('Result'));
            expect(screen.getByRole('img', { name: /100.*Orders.*\/orderId/ })).toBeVisible();
            expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
        },
    );

    it.each([
        { step: 'Workload', next: 'Start' },
        { step: 'Container: Orders', next: 'Next' },
    ])('invalidates downstream progress from $step only after confirmation and persists it', async ({ step, next }) => {
        const saved = restored(4);
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        const mounted = render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(await getStepControl(step));
        await userEvent.click(screen.getByRole('button', { name: next }));
        if (next === 'Next') {
            await answerConfirmation('Configure queries and scale?', false);
        }
        await confirmAdvance();
        expect(lastSave().wizard.dataModel.containers).toEqual(saved.wizard.dataModel.containers);
        expect(lastSave().recommendation).toEqual({ status: 'idle' });
        expect(await getStepControl('Result')).toHaveAttribute('aria-disabled', 'true');
        const persisted = lastSave();
        mounted.unmount();
        client.dataModeling.loadState.query.mockResolvedValue(persisted);
        render(<DataModelingWizard />);
        await continueExisting();
        expect(await getStepControl('Result')).toHaveAttribute('aria-disabled', 'true');
        while (screen.queryByRole('button', { name: 'Next' })) {
            await userEvent.click(screen.getByRole('button', { name: 'Next' }));
            await answerConfirmation('Configure queries and scale?', false);
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        }
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledWith({
            ...lastSave().wizard,
            requestId: expect.any(String),
        });
        expect(lastSave().wizard.dataModel).toEqual(saved.wizard.dataModel);
    });

    it('sends the selected scenario and unmodified model so the host can apply the default hint rule', async () => {
        const saved = createInitialSnapshot();
        saved.wizard = { ...applyScenario(saved.wizard, 'inventory'), step: 4 };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await waitFor(() => expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledOnce());
        expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledWith({
            ...lastSave().wizard,
            requestId: expect.any(String),
        });
        expect(lastSave().wizard.scenario).toBe('inventory');
        expect(lastSave().wizard.dataModel).toEqual(saved.wizard.dataModel);
    });

    it('counts only displayed container tabs and keeps restored results uncorrelated', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        expect(usage()).toMatchObject({
            containerCount: 1,
            dataViewedCount: 0,
            queriesNeverViewedCount: 1,
            scaleNeverViewedCount: 1,
        });
        expect(client.dataModeling.recordTelemetry.mutate).toHaveBeenCalledWith({
            type: 'recommendationDisplayed',
            requestId: undefined,
        });
        await userEvent.click(await getStepControl('Container: Orders'));
        expect(usage()).toMatchObject({ dataViewedCount: 1, dataCoverage: 1, queriesViewedCount: 0 });
        await userEvent.click(screen.getByRole('tab', { name: 'Queries' }));
        expect(usage()).toMatchObject({ queriesViewedCount: 1, queriesNeverViewedCount: 0, scaleViewedCount: 0 });
        await userEvent.click(screen.getByRole('tab', { name: 'Data' }));
        await userEvent.click(screen.getByRole('tab', { name: 'Queries' }));
        expect(usage().queriesViewedCount).toBe(1);
        await userEvent.click(screen.getByRole('tab', { name: 'Scale' }));
        expect(usage()).toMatchObject({ scaleViewedCount: 1, scaleCoverage: 1 });
        const payloads = JSON.stringify(client.dataModeling.recordTelemetry.mutate.mock.calls);
        expect(payloads).not.toContain('Orders');
        expect(payloads).not.toContain('/orderId');
        expect(payloads).not.toContain('Restored result');
        const controls = client.dataModeling.recordTelemetry.mutate.mock.calls
            .map(([event]) => event as ModelingTelemetryEvent)
            .filter((event) => event.type === 'control');
        expect(controls).toEqual([
            { type: 'control', control: 'containerQueriesTab' },
            { type: 'control', control: 'containerDataTab' },
            { type: 'control', control: 'containerQueriesTab' },
            { type: 'control', control: 'containerScaleTab' },
        ]);
    });

    it.each([
        { button: 'Start', control: 'footerStart', step: 1 },
        { button: 'Next', control: 'footerNext', step: 2 },
        { button: 'Back', control: 'footerBack', step: 2 },
        { button: 'Get Recommendation', control: 'footerGetRecommendation', step: 3 },
        { button: 'Add container', control: 'footerAddContainer', step: 2 },
        { button: 'Remove from model', control: 'footerRemoveContainer', step: 2 },
        { button: 'Start Over', control: 'footerStartOver', step: 4 },
        { button: 'Deploy', control: 'footerDeploy', step: 4 },
    ])('records footer $button activation, independently of completion', async ({ button, control, step }) => {
        const saved = restored(step);
        if (control === 'footerRemoveContainer') {
            saved.wizard.dataModel.containers.push(createBlankContainer('PrivateSecondContainer'));
        }
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        const footerButton = screen.getAllByRole('button', { name: button }).find((element) => !element.closest('nav'));
        if (!footerButton) throw new Error('Missing footer button');
        await userEvent.click(footerButton);
        expect(client.dataModeling.recordTelemetry.mutate).toHaveBeenCalledWith({ type: 'control', control });
    });

    it('does not count a hidden container section until the document is visible', async () => {
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        try {
            client.dataModeling.loadState.query.mockResolvedValue(restored(2));
            render(<DataModelingWizard />);
            await continueExisting();
            expect(usage().dataViewedCount).toBe(0);
            visibility.mockReturnValue('visible');
            act(() => document.dispatchEvent(new Event('visibilitychange')));
            expect(usage().dataViewedCount).toBe(1);
        } finally {
            visibility.mockRestore();
        }
    });

    it('retains feedback across navigation, deduplicates votes, and resets for a new recommendation', async () => {
        client.dataModeling.loadState.query.mockResolvedValue(restored(4));
        render(<DataModelingWizard />);
        await continueExisting();
        const up = () => screen.getByRole('button', { name: 'Helpful recommendation' });
        const down = () => screen.getByRole('button', { name: 'Unhelpful recommendation' });
        await userEvent.click(up());
        expect(up()).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(await getStepControl('Review'));
        await userEvent.click(await getStepControl('Result'));
        expect(up()).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(up());
        await userEvent.click(down());
        expect(down()).toHaveAttribute('aria-pressed', 'true');
        const votes = client.dataModeling.recordTelemetry.mutate.mock.calls
            .map(([event]) => event as ModelingTelemetryEvent)
            .filter((event) => event.type === 'feedback');
        expect(votes).toEqual([
            { type: 'feedback', vote: 'up' },
            { type: 'feedback', vote: 'down' },
        ]);
        await userEvent.click(await getStepControl('Review'));
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        await confirmAdvance();
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        act(() =>
            callbacks.onData({ type: 'recommendationReceived', recommendation: restored().recommendation.value! }),
        );
        expect(up()).toHaveAttribute('aria-pressed', 'false');
        expect(down()).toHaveAttribute('aria-pressed', 'false');
        expect(lastSave()).not.toHaveProperty('feedback');
        expect(lastSave().recommendation).not.toHaveProperty('feedback');
    });

    it('keeps telemetry bridge errors out of the modeling flow and never logs raw failures', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        client.dataModeling.recordTelemetry.mutate.mockRejectedValueOnce(new Error('private-transport-details'));
        try {
            render(<DataModelingWizard />);
            await screen.findByRole('button', { name: 'Start' });
            await waitFor(() =>
                expect(warning).toHaveBeenCalledWith('[Data Modeler] Could not record usage telemetry.'),
            );
            expect(JSON.stringify(warning.mock.calls)).not.toContain('private-transport-details');
            expect(screen.queryByRole('alert')).toBeEmptyDOMElement();
        } finally {
            warning.mockRestore();
        }
    });

    it('ignores stale correlated results and records the displayed current attempt without persisting IDs', async () => {
        const saved = restored(3);
        saved.recommendation = { status: 'idle' };
        client.dataModeling.loadState.query.mockResolvedValue(saved);
        render(<DataModelingWizard />);
        await continueExisting();
        await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
        const request = client.dataModeling.requestRecommendation.mutate.mock.calls.at(-1)?.[0] as {
            requestId: string;
        };
        const callbacks = client.dataModeling.events.subscribe.mock.calls[0][1] as {
            onData: (event: DataModelingEvent) => void;
        };
        const recommendation = restored().recommendation.value!;
        act(() =>
            callbacks.onData({
                type: 'recommendationReceived',
                requestId: crypto.randomUUID(),
                recommendation,
            }),
        );
        expect(lastSave().recommendation.status).toBe('waiting');
        act(() => callbacks.onData({ type: 'recommendationReceived', requestId: request.requestId, recommendation }));
        expect(lastSave().recommendation.status).toBe('received');
        expect(client.dataModeling.recordTelemetry.mutate).toHaveBeenCalledWith({
            type: 'recommendationDisplayed',
            requestId: request.requestId,
        });
        expect(JSON.stringify(lastSave())).not.toContain(request.requestId);
    });
    describe('recommendation input invalidation', () => {
        const changedMessage = 'The model has changed. Get a new recommendation before deploying.';
        const callbacks = () =>
            client.dataModeling.events.subscribe.mock.calls.at(-1)![1] as {
                onData: (event: DataModelingEvent) => void;
            };
        const latestRequest = () =>
            client.dataModeling.requestRecommendation.mutate.mock.calls.at(
                -1,
            )![0] as ModelingAdvisorSnapshot['wizard'] & { requestId: string };
        const resultFor = (entity: string) => {
            const result = restored().recommendation.value!;
            result.containers[0].entity = entity;
            return result;
        };
        const deliver = (entity: string, requestId = latestRequest().requestId) =>
            act(() =>
                callbacks().onData({ type: 'recommendationReceived', requestId, recommendation: resultFor(entity) }),
            );
        const rename = async () => {
            await userEvent.click(await getStepControl('Container: Orders'));
            await userEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
            fireEvent.change(screen.getByRole('textbox', { name: 'Container name' }), {
                target: { value: 'RenamedOrders' },
            });
            await userEvent.click(screen.getByRole('button', { name: 'Save container name' }));
        };
        const start = async () => {
            const saved = restored(3);
            saved.recommendation = { status: 'idle' };
            client.dataModeling.loadState.query.mockResolvedValue(saved);
            const mounted = render(
                <StrictMode>
                    <DataModelingWizard />
                </StrictMode>,
            );
            await continueExisting();
            await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
            return mounted;
        };

        it('requires regeneration after renaming, clears the draft, and allows a fresh deployment', async () => {
            await start();
            deliver('Orders');
            await enterDeployStep();
            fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
                target: { value: 'old-draft' },
            });
            await rename();
            expect(lastSave().recommendation).toEqual({ status: 'error', error: changedMessage });
            expect(lastSave().deployment).toBeUndefined();
            const deployStep = await getStepControl('Deploy');
            expect(deployStep).toHaveAttribute('aria-disabled', 'true');
            await userEvent.click(deployStep);
            expect(screen.queryByRole('region', { name: 'Deploy data model' })).not.toBeInTheDocument();
            expect(client.dataModeling.deploy.mutate).not.toHaveBeenCalled();
            await userEvent.click(await getStepControl('Result'));
            expect(screen.getByText(changedMessage)).toBeVisible();
            expect(screen.getByText(changedMessage).closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
            expectNoActionableDeployButton();
            await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
            expect(latestRequest().dataModel.containers[0].entity).toBe('RenamedOrders');
            deliver('RenamedOrders');
            await enterDeployStep();
            expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('');
            fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
                target: { value: 'fresh-db' },
            });
            client.dataModeling.deploy.mutate.mockResolvedValueOnce({
                status: 'deployed',
                databaseName: 'fresh-db',
                createdCount: 1,
                existingCount: 0,
            });
            const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
                name: 'Deploy',
            });
            expect(deploy).toHaveTextContent('Deploy');
            expect(deploy).toHaveAccessibleName('Deploy');
            await waitFor(() => expect(deploy).toBeEnabled());
            await userEvent.click(deploy);
            await confirmDeployment();
            expect(await screen.findByRole('region', { name: 'Deployment successful' })).toBeVisible();
            expect(client.dataModeling.deploy.mutate).toHaveBeenCalledExactlyOnceWith({
                databaseMode: 'new',
                databaseName: 'fresh-db',
                containers: [{ entity: 'RenamedOrders', partitionKey: '/orderId' }],
            });
            const completed = lastSave();
            // Duplicate delivery must not clear a legitimate deployment's completion.
            deliver('RenamedOrders');
            expect(lastSave()).toBe(completed);
            expect(completed.deployment?.input.containers[0].entity).toBe('RenamedOrders');
        });

        it('persists invalidation of a completed deployment through the saved schema and reload', async () => {
            client.dataModeling.loadState.query.mockResolvedValue(deployedSnapshot());
            const mounted = render(<DataModelingWizard />);
            await continueExisting();
            expect(await screen.findByRole('region', { name: 'Deployment successful' })).toBeVisible();
            await rename();
            const saved = ModelingAdvisorSnapshotSchema.parse(JSON.parse(JSON.stringify(lastSave())));
            expect(saved.recommendation).toEqual({ status: 'error', error: changedMessage });
            expect(saved.deployment).toBeUndefined();
            mounted.unmount();
            client.dataModeling.loadState.query.mockResolvedValue(saved);
            render(<DataModelingWizard />);
            await continueExisting();
            expect(await getStepControl('Deploy')).toHaveAttribute('aria-disabled', 'true');
            expect(screen.queryByRole('button', { name: 'Open in Data Explorer' })).not.toBeInTheDocument();
            await userEvent.click(await getStepControl('Result'));
            await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
            act(() => callbacks().onData({ type: 'recommendationReceived', recommendation: resultFor('Orders') }));
            expect(lastSave().recommendation.status).toBe('waiting');
            deliver('RenamedOrders');
            await enterDeployStep();
            expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
            expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveValue('');
        });

        it.each(['schema', 'document', 'arrays', 'query', 'scale', 'workload', 'add', 'remove'] as const)(
            'invalidates a recommendation after a %s input edit',
            async (edit) => {
                // Match the existing add-container test's layout stub for Fluent's overflow measurement.
                vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
                const saved = restored(2);
                if (edit === 'remove') saved.wizard.dataModel.containers.push(createBlankContainer('Users'));
                client.dataModeling.loadState.query.mockResolvedValue(saved);
                render(<DataModelingWizard />);
                await continueExisting();
                switch (edit) {
                    case 'schema':
                        fireEvent.change(screen.getByRole('combobox', { name: 'Type for id' }), {
                            target: { value: 'number' },
                        });
                        break;
                    case 'document':
                        fireEvent.change(screen.getByRole('spinbutton', { name: 'Average document size' }), {
                            target: { value: '2' },
                        });
                        break;
                    case 'arrays':
                        await userEvent.click(
                            screen.getByRole('checkbox', { name: 'This container has arrays / nested collections' }),
                        );
                        break;
                    case 'query':
                        await userEvent.click(screen.getByRole('tab', { name: 'Queries' }));
                        fireEvent.change(
                            screen.getByPlaceholderText('SELECT * FROM c WHERE customerId = @customerId'),
                            { target: { value: 'SELECT * FROM c WHERE c.id = @id' } },
                        );
                        break;
                    case 'scale':
                        await userEvent.click(screen.getByRole('tab', { name: 'Scale' }));
                        fireEvent.change(screen.getByRole('combobox', { name: 'Estimated distinct values for id' }), {
                            target: { value: '500000' },
                        });
                        break;
                    case 'workload':
                        await userEvent.click(await getStepControl('Workload'));
                        await userEvent.click(screen.getByRole('radio', { name: /Chat & Sessions/ }));
                        break;
                    case 'add':
                        client.dataModeling.promptContainerName.mutate.mockResolvedValueOnce('Users');
                        await userEvent.click(screen.getByRole('button', { name: 'Add container' }));
                        break;
                    case 'remove':
                        await userEvent.click(screen.getByRole('button', { name: 'Remove from model' }));
                        await answerConfirmation('Remove from model?', true);
                        break;
                }
                expect(lastSave().recommendation).toEqual({ status: 'error', error: changedMessage });
                expect(await getStepControl('Deploy')).toHaveAttribute('aria-disabled', 'true');
                expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
            },
        );

        it('preserves results through active-container navigation, tabs, and no-op schema and name edits', async () => {
            const saved = restored(2);
            saved.wizard.dataModel.containers.push(createBlankContainer('Users'));
            client.dataModeling.loadState.query.mockResolvedValue(saved);
            render(
                <StrictMode>
                    <DataModelingWizard />
                </StrictMode>,
            );
            await continueExisting();
            await userEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
            await userEvent.click(screen.getByRole('button', { name: 'Save container name' }));
            fireEvent.change(screen.getByRole('combobox', { name: 'Type for id' }), { target: { value: 'string' } });
            for (const tab of ['Queries', 'Scale', 'Data']) {
                await userEvent.click(screen.getByRole('tab', { name: tab }));
            }
            await userEvent.click(await getStepControl('Container: Users'));
            expect(lastSave().wizard.dataModel.activeContainerId).toBe(saved.wizard.dataModel.containers[1].id);
            await userEvent.click(await getStepControl('Result'));
            expect(lastSave().recommendation).toEqual(saved.recommendation);
            await enterDeployStep();
            expect(screen.getByRole('region', { name: 'Deploy data model' })).toBeVisible();
            expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
        });

        it.each([
            'save resolves',
            'save rejects',
            'start resolves',
            'start rejects',
            'stop resolves',
            'stop rejects',
        ] as const)('fences stale events and async work when %s after an edit and a new request', async (boundary) => {
            let resolve!: (value?: boolean) => void;
            let reject!: (error: Error) => void;
            const pending = new Promise<boolean | undefined>((done, fail) => {
                resolve = done;
                reject = fail;
            });
            const route = boundary.startsWith('save')
                ? client.dataModeling.saveState
                : boundary.startsWith('start')
                  ? client.dataModeling.requestRecommendation
                  : client.dataModeling.stopWaitingForRecommendation;
            route.mutate.mockImplementationOnce(() => pending);
            await start();
            const firstId = client.dataModeling.requestRecommendation.mutate.mock.calls.at(-1)?.[0].requestId;
            if (boundary.startsWith('stop')) {
                await userEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
            }
            await rename();
            expect(lastSave().recommendation.value).toBeUndefined();
            await userEvent.click(await getStepControl('Result'));
            await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
            const current = latestRequest();
            expect(current.dataModel.containers[0].entity).toBe('RenamedOrders');
            expect(current.requestId).not.toBe(firstId);
            for (const requestId of [firstId, undefined]) {
                act(() => {
                    callbacks().onData({
                        type: 'recommendationReceived',
                        requestId,
                        recommendation: resultFor('Orders'),
                    });
                    callbacks().onData({ type: 'recommendationError', requestId, message: 'Old failure' });
                });
            }
            await act(async () => {
                if (boundary.endsWith('rejects')) reject(new Error('Old request failed'));
                else resolve(true);
            });
            expect(lastSave().recommendation).toEqual({ status: 'waiting' });
            expectNoActionableDeployButton();
            expect(client.dataModeling.requestRecommendation.mutate).toHaveBeenCalledTimes(
                boundary.startsWith('save') ? 1 : 2,
            );
            deliver('RenamedOrders');
            expect(lastSave().recommendation.value?.containers[0].entity).toBe('RenamedOrders');
        });

        it.each(['separate', 'same'] as const)(
            'blocks an old deployment confirmation when a container prompt changes inputs in a %s batch',
            async (batch) => {
                vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
                client.dataModeling.loadState.query.mockResolvedValue(restored(2));
                let finishAdd!: (name: string) => void;
                client.dataModeling.promptContainerName.mutate.mockImplementationOnce(
                    () =>
                        new Promise<string>((resolve) => {
                            finishAdd = resolve;
                        }),
                );
                render(<DataModelingWizard />);
                await continueExisting();
                await userEvent.click(screen.getByRole('button', { name: 'Add container' }));
                await userEvent.click(await getStepControl('Deploy'));
                fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
                    target: { value: 'fresh-db' },
                });
                const deploy = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole('button', {
                    name: 'Deploy',
                });
                await waitFor(() => expect(deploy).toBeEnabled());
                await userEvent.click(deploy);
                expect(respondToConfirmation).toBeTypeOf('function');
                if (batch === 'same') {
                    await act(async () => {
                        finishAdd('Users');
                        respondToConfirmation!(true);
                    });
                } else {
                    await act(async () => finishAdd('Users'));
                    await confirmDeployment();
                }
                expect(client.dataModeling.deploy.mutate).not.toHaveBeenCalled();
                expect(lastSave().recommendation).toEqual({ status: 'error', error: changedMessage });
                expect(lastSave().deployment).toBeUndefined();
                expect(await getStepControl('Deploy')).toHaveAttribute('aria-disabled', 'true');
            },
        );

        it.each(['resolves', 'rejects'] as const)(
            'retires a pending save that %s in the same batch as a native container prompt',
            async (outcome) => {
                vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
                const saved = restored(2);
                saved.recommendation = { status: 'idle' };
                saved.wizard.reachedSteps = [
                    'workload',
                    `container:${saved.wizard.dataModel.containers[0].id}`,
                    'review',
                    'result',
                ];
                client.dataModeling.loadState.query.mockResolvedValue(saved);
                let finishAdd!: (name: string) => void;
                client.dataModeling.promptContainerName.mutate.mockImplementationOnce(
                    () =>
                        new Promise<string>((resolve) => {
                            finishAdd = resolve;
                        }),
                );
                render(<DataModelingWizard />);
                await continueExisting();
                await userEvent.click(screen.getByRole('button', { name: 'Add container' }));
                await userEvent.click(await getStepControl('Result'));
                let finishSave!: () => void;
                let failSave!: (error: Error) => void;
                client.dataModeling.saveState.mutate.mockImplementationOnce(
                    () =>
                        new Promise<void>((resolve, reject) => {
                            finishSave = resolve;
                            failSave = reject;
                        }),
                );
                await userEvent.click(screen.getByRole('button', { name: 'Get Recommendation' }));
                await act(async () => {
                    finishAdd('Users');
                    if (outcome === 'resolves') finishSave();
                    else failSave(new Error('Old save failed'));
                });
                expect(lastSave().wizard.dataModel.containers.map((container) => container.entity)).toEqual([
                    'Orders',
                    'Users',
                ]);
                expect(lastSave().recommendation).toEqual({ status: 'error', error: changedMessage });
                expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
                await userEvent.click(await getStepControl('Result'));
                await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
                expect(latestRequest().dataModel.containers.map((container) => container.entity)).toEqual([
                    'Orders',
                    'Users',
                ]);
                deliver('Users');
                expect(lastSave().recommendation.value?.containers[0].entity).toBe('Users');
            },
        );

        it.each(['cancelled', 'deployed', 'rejected'] as const)(
            'keeps a new deployment busy when the invalidated deployment finishes as %s',
            async (outcome) => {
                vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1024);
                client.dataModeling.loadState.query.mockResolvedValue(restored(2));
                let finishAdd!: (name: string) => void;
                client.dataModeling.promptContainerName.mutate.mockImplementationOnce(
                    () =>
                        new Promise<string>((resolve) => {
                            finishAdd = resolve;
                        }),
                );
                let finishOldDeploy!: (value: ModelDeploymentResult) => void;
                let failOldDeploy!: (error: Error) => void;
                client.dataModeling.deploy.mutate.mockImplementationOnce(
                    () =>
                        new Promise<ModelDeploymentResult>((resolve, reject) => {
                            finishOldDeploy = resolve;
                            failOldDeploy = reject;
                        }),
                );
                render(<DataModelingWizard />);
                await continueExisting();
                await userEvent.click(screen.getByRole('button', { name: 'Add container' }));
                await userEvent.click(await getStepControl('Deploy'));
                const openDeploy = async (databaseName: string) => {
                    fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), {
                        target: { value: databaseName },
                    });
                    const button = within(screen.getByRole('region', { name: 'Deploy data model' })).getByRole(
                        'button',
                        {
                            name: 'Deploy',
                        },
                    );
                    await waitFor(() => expect(button).toBeEnabled());
                    await userEvent.click(button);
                    await confirmDeployment();
                };
                await openDeploy('old-db');
                await act(async () => finishAdd('Users'));
                await userEvent.click(await getStepControl('Result'));
                await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
                deliver('Users');
                await enterDeployStep();
                let finishNewDeploy!: (value: ModelDeploymentResult) => void;
                client.dataModeling.deploy.mutate.mockImplementationOnce(
                    () =>
                        new Promise<ModelDeploymentResult>((resolve) => {
                            finishNewDeploy = resolve;
                        }),
                );
                await openDeploy('new-db');
                expect(await getStepControl('Workload')).toHaveAttribute('aria-disabled', 'true');
                await act(async () => {
                    if (outcome === 'rejected') failOldDeploy(new Error('Old deployment failed'));
                    else if (outcome === 'cancelled') finishOldDeploy({ status: 'cancelled' });
                    else {
                        finishOldDeploy({
                            status: 'deployed',
                            databaseName: 'old-db',
                            createdCount: 1,
                            existingCount: 0,
                        });
                    }
                });
                const workload = await getStepControl('Workload');
                await userEvent.click(workload);
                expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
                expect(workload).toHaveAttribute('aria-disabled', 'true');
                expect(lastSave().deployment).toBeUndefined();
                expect(lastSave().recommendation.value?.containers[0].entity).toBe('Users');
                expect(screen.queryByText(/Old deployment failed/)).not.toBeInTheDocument();
                await act(async () => {
                    finishNewDeploy({ status: 'deployed', databaseName: 'new-db', createdCount: 1, existingCount: 0 });
                });
                expect(await screen.findByRole('region', { name: 'Deployment successful' })).toBeVisible();
                expect(lastSave().deployment?.input.databaseName).toBe('new-db');
                expect(await getStepControl('Workload')).not.toHaveAttribute('aria-disabled', 'true');
            },
        );

        it.each([false, true])(
            'retires a save after same-batch schema edits in StrictMode (rollback=%s)',
            async (rollback) => {
                let finishSave!: () => void;
                client.dataModeling.saveState.mutate.mockImplementationOnce(
                    () =>
                        new Promise<void>((resolve) => {
                            finishSave = resolve;
                        }),
                );
                await start();
                await userEvent.click(await getStepControl('Container: Orders'));
                const field = screen.getByRole('combobox', { name: 'Type for id' });
                await act(async () => {
                    fireEvent.change(field, { target: { value: 'number' } });
                    if (rollback) fireEvent.change(field, { target: { value: 'string' } });
                    finishSave();
                });
                expect(lastSave().recommendation).toEqual({ status: 'error', error: changedMessage });
                expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
            },
        );

        it('rejects a result queued in the same batch as an input edit', async () => {
            await start();
            const requestId = latestRequest().requestId;
            await userEvent.click(await getStepControl('Container: Orders'));
            await userEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
            fireEvent.change(screen.getByRole('textbox', { name: 'Container name' }), {
                target: { value: 'RenamedOrders' },
            });
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: 'Save container name' }));
                callbacks().onData({ type: 'recommendationReceived', requestId, recommendation: resultFor('Orders') });
            });
            expect(lastSave().recommendation).toEqual({ status: 'error', error: changedMessage });
            expect(await getStepControl('Deploy')).toHaveAttribute('aria-disabled', 'true');
        });

        it.each(['reset', 'unmount'] as const)('retires a pending save on %s', async (action) => {
            let finishSave!: () => void;
            client.dataModeling.saveState.mutate.mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        finishSave = resolve;
                    }),
            );
            const mounted = await start();
            const oldCallbacks = callbacks();
            if (action === 'reset') await userEvent.click(screen.getByRole('button', { name: 'Start Over' }));
            else mounted.unmount();
            const saveCount = client.dataModeling.saveState.mutate.mock.calls.length;
            const expectedSnapshot = action === 'reset' ? createInitialSnapshot() : lastSave();
            await act(async () => {
                finishSave();
                oldCallbacks.onData({ type: 'recommendationReceived', recommendation: resultFor('Orders') });
            });
            expect(client.dataModeling.requestRecommendation.mutate).not.toHaveBeenCalled();
            expect(client.dataModeling.saveState.mutate).toHaveBeenCalledTimes(saveCount);
            expect(lastSave()).toEqual(expectedSnapshot);
        });
    });
});
