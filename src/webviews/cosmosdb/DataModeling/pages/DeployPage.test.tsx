/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider } from '@fluentui/react-components';
import { type EditorProps } from '@monaco-editor/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type DeploymentContainer,
    type DeploymentOptions,
    type DeploymentRequest,
    type DeploymentTemplateInput,
    type ModelDeploymentResult,
    type SuccessfulDeployment,
} from '../../../../dataModeling/deploymentModel';
import { MonacoEditor } from '../../../MonacoEditor';
import { createDeploymentDraft, DeployPage } from './DeployPage';

vi.mock('../../../MonacoEditor', () => ({
    MonacoEditor: vi.fn(({ value, options, onChange }: EditorProps) => (
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
    )),
}));

const containers: DeploymentContainer[] = [
    { entity: 'Orders', partitionKey: '/tenantId, /id' },
    { entity: 'Users', partitionKey: '/id' },
];
const loadOptions = vi.fn<() => Promise<DeploymentOptions>>();
const generateTemplate = vi.fn<(input: DeploymentTemplateInput) => Promise<string>>();
const onDeploy = vi.fn<(input: DeploymentRequest) => Promise<ModelDeploymentResult>>();
const onOpenDataExplorer = vi.fn<(input: { databaseId: string; containerId: string }) => Promise<void>>();
const onBusyChange = vi.fn();
const onDeployed = vi.fn<(deployment: SuccessfulDeployment) => void>();

function Harness() {
    const [draft, setDraft] = useState(() => createDeploymentDraft(containers));
    const [deployment, setDeployment] = useState<SuccessfulDeployment>();
    return (
        <FluentProvider>
            <DeployPage
                containers={containers}
                draft={draft}
                deployment={deployment}
                onDraftChange={(update) => {
                    // Mirror the wizard: any draft edit clears a persisted deployment.
                    setDeployment(undefined);
                    setDraft(update);
                }}
                loadOptions={loadOptions}
                generateTemplate={generateTemplate}
                onDeploy={onDeploy}
                onOpenDataExplorer={onOpenDataExplorer}
                onBusyChange={onBusyChange}
                onDeploymentChange={(next) => {
                    setDeployment(next);
                    if (next) {
                        onDeployed(next);
                    }
                }}
            />
        </FluentProvider>
    );
}

function changeName(name = 'new-db') {
    fireEvent.change(screen.getByRole('textbox', { name: 'New database name' }), { target: { value: name } });
}

async function waitForTemplate() {
    await waitFor(() => {
        const editor = screen.getByRole('textbox', { name: 'Bicep deployment template' });
        expect(editor).not.toHaveAttribute('readonly');
        expect(editor).not.toHaveValue('');
    });
    return screen.getByRole('textbox', { name: 'Bicep deployment template' });
}

async function chooseBicep() {
    await userEvent.click(screen.getByRole('radio', { name: 'Deploy with Biceps' }));
}

async function waitForDeploy() {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled());
}

async function confirmDeployment() {
    const dialog = await screen.findByRole('alertdialog', {
        name: 'Deploy data model to "new-db" in "source-account"?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
}

beforeEach(() => {
    vi.clearAllMocks();
    loadOptions.mockResolvedValue({
        accountName: 'source-account',
        subscriptionName: 'Engineering',
        resourceGroup: 'modeling-rg',
        databases: ['existing-db', 'other-db'],
    });
    generateTemplate.mockImplementation(
        async (input) =>
            `// ${input.databaseMode} ${input.databaseName}: ${input.containers.map((container) => container.entity).join(', ')}`,
    );
    onDeploy.mockResolvedValue({ status: 'cancelled' });
    onOpenDataExplorer.mockResolvedValue(undefined);
});

describe('Deploy wizard page', () => {
    it('shows named database radios and all container checkboxes selected by default', async () => {
        render(<Harness />);
        expect(screen.getByRole('button', { name: 'Deploy' })).toBeDisabled();
        expect(screen.queryByText('Database name is required.')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'New database name' })).not.toHaveAttribute('aria-invalid', 'true');
        expect(await screen.findByText('source-account', { selector: 'dd' })).toBeVisible();
        const target = within(screen.getByRole('region', { name: 'Deployment target' }));
        expect(target.getByText('Subscription:')).toBeVisible();
        expect(target.getByText('Engineering')).toBeVisible();
        expect(target.getByText('Resource group:')).toBeVisible();
        expect(target.getByText('modeling-rg')).toBeVisible();
        expect(target.getByText('Account:')).toBeVisible();
        expect(screen.getByRole('radiogroup', { name: 'Choose database' })).toBeVisible();
        expect(screen.getByRole('heading', { name: 'Choose database' })).toBeVisible();
        expect(screen.getByRole('radio', { name: 'New database' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'New database' })).toHaveAccessibleName('New database');
        expect(screen.getByRole('radio', { name: 'Existing database' })).not.toBeChecked();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveAccessibleName('New database name');
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        const group = screen.getByRole('group', { name: 'Choose containers to deploy' });
        const panel = screen.getByRole('region', { name: 'Choose containers to deploy' });
        expect(panel).toContainElement(screen.getByRole('heading', { name: 'Choose containers to deploy' }));
        expect(group.querySelector('legend')).not.toBeInTheDocument();
        expect(group.firstElementChild).toHaveStyle({ display: 'flex', flexWrap: 'wrap' });
        for (const { entity } of containers) {
            expect(within(group).getByRole('checkbox', { name: entity })).toBeChecked();
            expect(within(group).getByRole('checkbox', { name: entity })).toHaveAccessibleName(entity);
        }
        expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled();
        expect(screen.queryByText('Database name is required.')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'New database name' })).not.toHaveAttribute('aria-invalid', 'true');
        expect(generateTemplate).not.toHaveBeenCalled();
        expect(screen.getByRole('radiogroup', { name: 'Deployment method' })).toBeVisible();
        expect(screen.getByRole('radio', { name: 'Deploy now' })).toBeChecked();
        const bicepChoice = screen.getByRole('radio', { name: 'Deploy with Biceps' });
        expect(bicepChoice).toHaveAccessibleName('Deploy with Biceps');
        expect(screen.getByText('Deploy with Biceps')).toBeVisible();
        expect(screen.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Copy Bicep' })).not.toBeInTheDocument();
    });

    it('shows the required error when a database name is typed and cleared before deployment', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await screen.findByText('source-account', { selector: 'dd' });
        const nameInput = screen.getByRole('textbox', { name: 'New database name' });
        expect(nameInput).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText('Database name is required.')).not.toBeInTheDocument();
        await user.type(nameInput, 'valid-db');
        expect(nameInput).not.toHaveAttribute('aria-invalid', 'true');
        await user.clear(nameInput);
        expect(nameInput).toHaveValue('');
        expect(nameInput).toHaveFocus();
        expect(nameInput).toHaveAttribute('aria-invalid', 'true');
        expect(nameInput).toHaveAccessibleDescription('Database name is required.');
        expect(screen.getByText('Database name is required.')).toBeVisible();
        await user.type(nameInput, 'corrected-db');
        expect(nameInput).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText('Database name is required.')).not.toBeInTheDocument();
        expect(onDeploy).not.toHaveBeenCalled();
        expect(generateTemplate).not.toHaveBeenCalled();
    });

    it.each([
        ['bad/name', /cannot contain path separators/],
        ['x'.repeat(256), /cannot be longer than 255/],
        ['existing-db', /This database already exists/],
        ['   ', /Database name is required/],
    ])('validates the edited database name "%s" before a deployment attempt', async (name, message) => {
        render(<Harness />);
        await screen.findByText('source-account', { selector: 'dd' });
        changeName(name);
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText(message)).toBeVisible();
        expect(onDeploy).not.toHaveBeenCalled();
        expect(generateTemplate).not.toHaveBeenCalled();
    });

    it('validates required, forbidden, too-long and duplicate names after attempting deployment', async () => {
        render(<Harness />);
        await waitForDeploy();
        const nameInput = screen.getByRole('textbox', { name: 'New database name' });
        const deployButton = screen.getByRole('button', { name: 'Deploy' });
        deployButton.focus();
        await userEvent.keyboard('{Enter}');
        expect(screen.getByText('Database name is required.')).toBeVisible();
        expect(nameInput).toHaveFocus();
        expect(nameInput).toHaveAttribute('aria-invalid', 'true');
        expect(nameInput).toHaveAccessibleDescription('Database name is required.');
        changeName('bad/name');
        expect(nameInput).toHaveAttribute('aria-invalid', 'true');
        await userEvent.click(deployButton);
        changeName('x'.repeat(256));
        expect(screen.getByText(/cannot be longer than 255/)).toBeVisible();
        await userEvent.click(deployButton);
        changeName('existing-db');
        expect(screen.getByText('This database already exists. Select Existing database to use it.')).toBeVisible();
        await userEvent.click(deployButton);
        expect(onDeploy).not.toHaveBeenCalled();
        expect(onBusyChange).not.toHaveBeenCalled();
        changeName(' valid-db ');
        expect(nameInput).not.toHaveAttribute('aria-invalid', 'true');
        expect(
            screen.queryByText('This database already exists. Select Existing database to use it.'),
        ).not.toBeInTheDocument();
        await waitForDeploy();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        const dialog = await screen.findByRole('alertdialog', {
            name: 'Deploy data model to "valid-db" in "source-account"?',
        });
        await userEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
        expect(onDeploy).toHaveBeenCalledOnce();
        expect(onDeploy).toHaveBeenLastCalledWith({
            databaseMode: 'new',
            databaseName: 'valid-db',
            containers,
        });
        expect(generateTemplate).not.toHaveBeenCalled();
    });

    it('defers existing database errors until deployment and focuses the invalid dropdown', async () => {
        render(<Harness />);
        await waitForDeploy();
        await userEvent.click(screen.getByRole('radio', { name: 'Existing database' }));
        const dropdown = screen.getByRole('combobox', { name: 'Existing database' });
        expect(dropdown).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText('Select an existing database.')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        expect(screen.getByText('Select an existing database.')).toBeVisible();
        expect(dropdown).toHaveAttribute('aria-invalid', 'true');
        expect(dropdown).toHaveAccessibleDescription('Select an existing database.');
        expect(dropdown).toHaveFocus();
        expect(onDeploy).not.toHaveBeenCalled();
        expect(onBusyChange).not.toHaveBeenCalled();
        await userEvent.click(dropdown);
        await userEvent.click(screen.getByRole('option', { name: 'existing-db' }));
        expect(dropdown).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText('Select an existing database.')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        const dialog = await screen.findByRole('alertdialog', {
            name: 'Deploy data model to "existing-db" in "source-account"?',
        });
        await userEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
        expect(onDeploy).toHaveBeenCalledExactlyOnceWith({
            databaseMode: 'existing',
            databaseName: 'existing-db',
            containers,
        });
    });

    it('keeps database validation visible in Bicep mode and does not generate an invalid template', async () => {
        render(<Harness />);
        await waitForDeploy();
        await chooseBicep();
        expect(screen.getByText('Database name is required.')).toBeVisible();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('button', { name: 'Regenerate template' })).toBeDisabled();
        expect(generateTemplate).not.toHaveBeenCalled();
        changeName();
        await waitForTemplate();
        expect(screen.queryByText('Database name is required.')).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'New database name' })).not.toHaveAttribute('aria-invalid', 'true');
        expect(generateTemplate).toHaveBeenCalledExactlyOnceWith({
            databaseMode: 'new',
            databaseName: 'new-db',
            containers,
        });
        expect(onDeploy).not.toHaveBeenCalled();
    });

    it('does not mount Monaco or schedule template generation in Deploy now mode', async () => {
        vi.useFakeTimers();
        try {
            render(<Harness />);
            changeName();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
            });
            expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled();
            expect(generateTemplate).not.toHaveBeenCalled();
            expect(MonacoEditor).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the description and editor gap-free without removing the live status regions', async () => {
        render(<Harness />);
        changeName();
        await chooseBicep();
        const editor = await waitForTemplate();
        const description = screen.getByText(
            'Edit and copy this Bicep template for manual deployment with your own tooling. This option does not deploy resources from the wizard.',
        );
        const body = description.parentElement;
        expect(body).toBe(editor.parentElement?.parentElement);
        expect(body).toHaveStyle({ display: 'flex', flexDirection: 'column', gap: '0' });
        if (!body) throw new Error('Bicep template body not found');
        const statuses = within(body).getAllByRole('status');
        expect(statuses).toHaveLength(2);
        for (const status of statuses) {
            expect(status).toBeEmptyDOMElement();
            expect(status).toHaveAttribute('aria-live', 'polite');
            expect(status).not.toHaveAttribute('aria-hidden');
        }
    });

    it('switches to a dropdown for an existing database and generates its template', async () => {
        render(<Harness />);
        await screen.findByText('source-account', { selector: 'dd' });
        await userEvent.click(screen.getByRole('radio', { name: 'Existing database' }));
        expect(screen.queryByRole('textbox', { name: 'New database name' })).not.toBeInTheDocument();
        const dropdown = screen.getByRole('combobox', { name: 'Existing database' });
        expect(dropdown).toHaveAccessibleName('Existing database');
        await userEvent.click(dropdown);
        await userEvent.click(screen.getByRole('option', { name: 'existing-db' }));
        await chooseBicep();
        await waitForTemplate();
        expect(generateTemplate).toHaveBeenLastCalledWith({
            databaseMode: 'existing',
            databaseName: 'existing-db',
            containers,
        });
    });

    it('preserves manual Bicep edits when switching to direct deployment and never submits them', async () => {
        const user = userEvent.setup();
        const writeText = vi.spyOn(navigator.clipboard, 'writeText');
        render(<Harness />);
        await screen.findByText('source-account', { selector: 'dd' });
        changeName();
        await chooseBicep();
        await waitForTemplate();
        await userEvent.click(screen.getByRole('checkbox', { name: 'Users' }));
        const editor = await waitForTemplate();
        expect(generateTemplate).toHaveBeenLastCalledWith({
            databaseMode: 'new',
            databaseName: 'new-db',
            containers: [containers[0]],
        });
        expect(vi.mocked(MonacoEditor).mock.calls.at(-1)?.[0]).toMatchObject({
            language: 'bicep',
            options: {
                readOnly: false,
                domReadOnly: false,
                tabFocusMode: true,
                lineNumbers: 'on',
                scrollbar: { vertical: 'visible', horizontal: 'auto', alwaysConsumeMouseWheel: false },
            },
        });
        expect(editor.parentElement).toHaveStyle({ height: '240px' });
        fireEvent.change(editor, { target: { value: '// customized Bicep\n// throughput = 1000' } });
        expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
        const copy = screen.getByRole('button', { name: 'Copy Bicep' });
        expect(copy).toHaveTextContent('Copy Bicep');
        expect(copy).toHaveAccessibleName('Copy Bicep');
        await user.click(copy);
        expect(writeText).toHaveBeenCalledWith('// customized Bicep\n// throughput = 1000');
        expect(screen.getByText('Bicep copied.')).toBeVisible();
        expect(onDeploy).not.toHaveBeenCalled();
        await user.click(screen.getByRole('radio', { name: 'Deploy now' }));
        const button = screen.getByRole('button', { name: 'Deploy' });
        expect(button).toHaveTextContent('Deploy');
        expect(button).toHaveAccessibleName('Deploy');
        expect(screen.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        await user.click(button);
        await confirmDeployment();
        expect(onDeploy).toHaveBeenCalledWith({
            databaseMode: 'new',
            databaseName: 'new-db',
            containers: [containers[0]],
        });
        await chooseBicep();
        expect(screen.getByRole('textbox', { name: 'Bicep deployment template' })).toHaveValue(
            '// customized Bicep\n// throughput = 1000',
        );
    });

    it('blocks direct deployment when no containers are selected, without requiring a template', async () => {
        render(<Harness />);
        changeName();
        await waitForDeploy();
        await userEvent.click(screen.getByRole('checkbox', { name: 'Orders' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Users' }));
        expect(screen.getByText('Select at least one container to deploy.')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Deploy' })).toBeDisabled();
        expect(generateTemplate).not.toHaveBeenCalled();
    });

    it('keeps custom edits after selection changes until regeneration is explicitly confirmed', async () => {
        render(<Harness />);
        changeName();
        await chooseBicep();
        const editor = await waitForTemplate();
        fireEvent.change(editor, { target: { value: '// my custom template' } });
        await userEvent.click(screen.getByRole('checkbox', { name: 'Users' }));
        expect(editor).toHaveValue('// my custom template');
        expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
        const regenerate = screen.getByRole('button', { name: 'Regenerate template' });
        await userEvent.click(regenerate);
        let dialog = screen.getByRole('alertdialog', { name: 'Replace your template edits?' });
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(editor).toHaveValue('// my custom template');
        await waitFor(() => expect(regenerate).toHaveFocus());
        await userEvent.click(regenerate);
        dialog = screen.getByRole('alertdialog', { name: 'Replace your template edits?' });
        await userEvent.click(within(dialog).getByRole('button', { name: 'Regenerate template' }));
        await waitForTemplate();
        expect(editor).toHaveValue('// new new-db: Orders');
    });

    it('ignores a stale generated template when a newer database selection wins', async () => {
        let resolveFirst!: (template: string) => void;
        generateTemplate.mockImplementationOnce(
            () =>
                new Promise<string>((resolve) => {
                    resolveFirst = resolve;
                }),
        );
        render(<Harness />);
        changeName('first-db');
        await chooseBicep();
        await waitFor(() => expect(generateTemplate).toHaveBeenCalledOnce());
        changeName('second-db');
        const editor = await waitForTemplate();
        await act(async () => resolveFirst('// stale first-db'));
        expect(editor).toHaveValue('// new second-db: Orders, Users');
    });

    it('ignores a pending export response when switching to Deploy now', async () => {
        let resolveFirst!: (template: string) => void;
        generateTemplate.mockImplementationOnce(
            () =>
                new Promise<string>((resolve) => {
                    resolveFirst = resolve;
                }),
        );
        render(<Harness />);
        changeName();
        await chooseBicep();
        await waitFor(() => expect(generateTemplate).toHaveBeenCalledOnce());
        await userEvent.click(screen.getByRole('radio', { name: 'Deploy now' }));
        await waitForDeploy();
        await act(async () => resolveFirst('// stale hidden template'));
        expect(screen.queryByRole('textbox', { name: 'Bicep deployment template' })).not.toBeInTheDocument();
        await chooseBicep();
        const editor = await waitForTemplate();
        expect(editor).toHaveValue('// new new-db: Orders, Users');
        expect(generateTemplate).toHaveBeenCalledTimes(2);
    });

    it('allows direct deployment after a Bicep generation failure', async () => {
        generateTemplate.mockRejectedValueOnce(new Error('Export unavailable'));
        render(<Harness />);
        changeName();
        await chooseBicep();
        await screen.findByText('Could not generate the Bicep template. Export unavailable');
        await userEvent.click(screen.getByRole('radio', { name: 'Deploy now' }));
        await waitForDeploy();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        await confirmDeployment();
        expect(onDeploy).toHaveBeenCalledWith({ databaseMode: 'new', databaseName: 'new-db', containers });
        expect(screen.queryByText(/Could not generate/)).not.toBeInTheDocument();
    });

    it('replaces Deploy with a labeled spinner and restores button focus after deployment', async () => {
        let resolveDeploy!: (result: ModelDeploymentResult) => void;
        onDeploy.mockImplementationOnce(
            () =>
                new Promise<ModelDeploymentResult>((resolve) => {
                    resolveDeploy = resolve;
                }),
        );
        render(<Harness />);
        expect(screen.queryByText('Open in Data Explorer')).not.toBeInTheDocument();
        changeName();
        await waitForDeploy();
        const button = screen.getByRole('button', { name: 'Deploy' });
        await userEvent.click(button);
        await confirmDeployment();
        const spinner = screen.getByRole('progressbar', { name: 'Deploying...' });
        expect(spinner).toBeVisible();
        expect(spinner).toHaveAccessibleName('Deploying...');
        expect(screen.getByText('Deploying...')).toBeVisible();
        expect(spinner.closest('output')).toHaveFocus();
        expect(button).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Existing database' })).toBeDisabled();
        expect(screen.getByRole('textbox', { name: 'New database name' })).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'Users' })).toBeDisabled();
        expect(screen.getByRole('radio', { name: 'Deploy with Biceps' })).toBeDisabled();
        expect(onBusyChange).toHaveBeenLastCalledWith(true);
        expect(onDeploy).toHaveBeenCalledOnce();
        expect(screen.queryByText('Open in Data Explorer')).not.toBeInTheDocument();
        await act(async () =>
            resolveDeploy({ status: 'deployed', databaseName: 'new-db', createdCount: 2, existingCount: 0 }),
        );
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        const successCard = screen.getByRole('region', { name: 'Deployment successful' });
        expect(within(successCard).getByRole('heading', { name: 'Deployment successful', level: 3 })).toBeVisible();
        const successMessage = within(successCard).getByText(
            'Data model deployed to "new-db": 2 container(s) created, 0 left unchanged.',
        );
        expect(successMessage).toBeVisible();
        expect(successMessage).toHaveAttribute('aria-live', 'polite');
        expect(successCard.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
        expect(onDeployed).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Deploy' })).toHaveFocus();
        const explorer = within(successCard).getByRole('button', { name: 'Open in Data Explorer' });
        expect(explorer).toHaveTextContent('Open in Data Explorer');
        expect(explorer).toHaveAccessibleName('Open in Data Explorer');
        expect(explorer).toHaveAccessibleDescription('Open Data Explorer for this account in the Azure portal.');
        await userEvent.tab();
        expect(explorer).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(onOpenDataExplorer).toHaveBeenCalledWith({ databaseId: 'new-db', containerId: 'Orders' });
    });

    it('confirms direct deployment in a Fluent UI dialog and restores focus after cancellation', async () => {
        render(<Harness />);
        changeName();
        await waitForDeploy();
        const deployButton = screen.getByRole('button', { name: 'Deploy' });
        await userEvent.click(deployButton);
        const dialog = await screen.findByRole('alertdialog', {
            name: 'Deploy data model to "new-db" in "source-account"?',
        });
        expect(dialog).toHaveTextContent('Deploy 2 selected container(s): Orders, Users.');
        expect(dialog).toHaveTextContent('Matching existing containers are left unchanged.');
        expect(onDeploy).not.toHaveBeenCalled();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(deployButton).toHaveFocus());
        expect(onDeploy).not.toHaveBeenCalled();
    });

    it('opens the first selected container in the returned database and clears the link when the draft changes', async () => {
        onDeploy.mockResolvedValueOnce({
            status: 'deployed',
            databaseName: 'existing-db',
            createdCount: 0,
            existingCount: 1,
        });
        render(<Harness />);
        await screen.findByText('source-account', { selector: 'dd' });
        await userEvent.click(screen.getByRole('radio', { name: 'Existing database' }));
        await userEvent.click(screen.getByRole('combobox', { name: 'Existing database' }));
        await userEvent.click(screen.getByRole('option', { name: 'existing-db' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Orders' }));
        await waitForDeploy();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        const dialog = await screen.findByRole('alertdialog', {
            name: 'Deploy data model to "existing-db" in "source-account"?',
        });
        await userEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Open in Data Explorer' }));
        expect(onOpenDataExplorer).toHaveBeenCalledWith({ databaseId: 'existing-db', containerId: 'Users' });
        await userEvent.click(screen.getByRole('checkbox', { name: 'Orders' }));
        expect(screen.queryByText('Open in Data Explorer')).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Deployment successful' })).not.toBeInTheDocument();
    });

    it('reports opening failures separately from deployment and allows retrying', async () => {
        onDeploy.mockResolvedValueOnce({
            status: 'deployed',
            databaseName: 'new-db',
            createdCount: 2,
            existingCount: 0,
        });
        let rejectOpen!: (error: Error) => void;
        onOpenDataExplorer.mockImplementationOnce(
            () =>
                new Promise<void>((_, reject) => {
                    rejectOpen = reject;
                }),
        );
        render(<Harness />);
        changeName();
        await waitForDeploy();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        await confirmDeployment();
        const explorer = await screen.findByRole('button', { name: 'Open in Data Explorer' });
        await userEvent.click(explorer);
        expect(explorer).toBeDisabled();
        await act(async () => rejectOpen(new Error('Access denied')));
        expect(screen.getByRole('alert')).toHaveTextContent('Could not open Data Explorer. Access denied');
        expect(screen.getByText(/Data model deployed to/)).toBeVisible();
        expect(explorer).toBeEnabled();
        await userEvent.click(explorer);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(onOpenDataExplorer).toHaveBeenCalledTimes(2);
        expect(onDeploy).toHaveBeenCalledOnce();
    });

    it('clears the previous success link when a subsequent deployment is cancelled', async () => {
        onDeploy.mockResolvedValueOnce({
            status: 'deployed',
            databaseName: 'new-db',
            createdCount: 2,
            existingCount: 0,
        });
        render(<Harness />);
        changeName();
        await waitForDeploy();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        await confirmDeployment();
        expect(await screen.findByRole('button', { name: 'Open in Data Explorer' })).toBeVisible();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        await confirmDeployment();
        expect(screen.queryByText('Open in Data Explorer')).not.toBeInTheDocument();
    });

    it('surfaces direct provisioning failures without generating a Bicep template', async () => {
        onDeploy.mockRejectedValueOnce(new Error('Quota exceeded'));
        render(<Harness />);
        changeName();
        await waitForDeploy();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        await confirmDeployment();
        expect(screen.getByText('Deployment failed. Quota exceeded')).toBeVisible();
        expect(screen.queryByText('Open in Data Explorer')).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Deployment successful' })).not.toBeInTheDocument();
        expect(generateTemplate).not.toHaveBeenCalled();
        expect(onDeployed).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled();
    });

    it('reports cancellation without marking the step complete', async () => {
        render(<Harness />);
        changeName();
        await waitForDeploy();
        await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
        await confirmDeployment();
        expect(screen.getByText('Deployment cancelled. No deployment was started.')).toBeVisible();
        expect(screen.queryByText('Open in Data Explorer')).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Deployment successful' })).not.toBeInTheDocument();
        expect(onDeployed).not.toHaveBeenCalled();
    });

    it('surfaces database-load and template-generation errors with working retry actions', async () => {
        loadOptions.mockRejectedValueOnce(new Error('Access denied'));
        generateTemplate.mockRejectedValueOnce(new Error('Invalid key'));
        render(<Harness />);
        await userEvent.click(await screen.findByRole('button', { name: 'Retry loading databases' }));
        await screen.findByText('source-account', { selector: 'dd' });
        changeName();
        await chooseBicep();
        await screen.findByText('Could not generate the Bicep template. Invalid key');
        expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Regenerate template' }));
        await waitForTemplate();
    });

    it('shows an explicit unsupported-target reason and keeps deployment disabled', async () => {
        loadOptions.mockResolvedValue({
            accountName: 'Endpoint-only account',
            databases: [],
            unavailableReason: 'Reopen the Data Modeler from its connected account.',
        });
        render(<Harness />);
        await screen.findByText('Reopen the Data Modeler from its connected account.');
        changeName();
        expect(screen.getByRole('button', { name: 'Deploy' })).toBeDisabled();
        expect(generateTemplate).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('radio', { name: 'Existing database' }));
        expect(screen.getByRole('combobox', { name: 'Existing database' })).toBeDisabled();
        expect(screen.getByText('This account has no databases. Choose New database to create one.')).toBeVisible();
    });

    it('does not invent subscription or resource group details for a connected local account', async () => {
        loadOptions.mockResolvedValue({ accountName: 'Local emulator', databases: [] });
        render(<Harness />);
        await screen.findByText('Local emulator', { selector: 'dd' });
        const target = within(screen.getByRole('region', { name: 'Deployment target' }));
        expect(target.getAllByText('Not available')).toHaveLength(2);
        expect(screen.getByRole('radio', { name: 'New database' })).toBeEnabled();
    });

    it.each(['getDeploymentOptions', 'generateDeploymentTemplate', 'deploy'] as const)(
        'explains how to recover when an older host lacks %s',
        async (procedure) => {
            const error = new Error(`No procedure found on path "dataModeling.${procedure}"`);
            if (procedure === 'getDeploymentOptions') {
                loadOptions.mockRejectedValueOnce(error);
            } else if (procedure === 'generateDeploymentTemplate') {
                generateTemplate.mockRejectedValueOnce(error);
            } else {
                onDeploy.mockRejectedValueOnce(error);
            }
            render(<Harness />);
            if (procedure !== 'getDeploymentOptions') {
                changeName();
                if (procedure === 'deploy') {
                    await waitForDeploy();
                    await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
                    await confirmDeployment();
                } else {
                    await chooseBicep();
                }
            }
            expect(await screen.findByText(/The webview is newer than the running extension host/)).toHaveTextContent(
                'Developer: Reload Window',
            );
            expect(onDeployed).not.toHaveBeenCalled();
        },
    );
});
