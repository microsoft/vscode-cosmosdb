/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { type CosmosDBAccountModel } from '../tree/cosmosdb/models/CosmosDBAccountModel';
import { assignDiagnosticsDataRole } from './roleAction';

const io = vi.hoisted(() => ({ confirm: vi.fn(), assign: vi.fn(), warn: vi.fn() }));
vi.mock('vscode', () => ({ window: { showWarningMessage: io.confirm } }));
vi.mock('../cosmosdb/utils/rbacUtils', () => ({ addRbacContributorPermission: io.assign }));
vi.mock('../extensionVariables', () => ({ ext: { outputChannel: { warn: io.warn } } }));

const testAccount = {
    id: 'resource',
    name: 'test-account',
    resourceGroup: 'test-group',
    subscription: { subscriptionId: 'subscription' },
} as CosmosDBAccountModel;
const principalId = '44c205ac-c76f-44ce-9212-04a60b429589';
const context = { valuesToMask: [] } as unknown as IActionContext;

beforeEach(() => {
    vi.resetAllMocks();
    context.valuesToMask.length = 0;
});

it('only assigns the verified principal at account scope after explicit confirmation', async () => {
    io.confirm.mockImplementation(async (_text, _options, confirm) => confirm);
    await expect(assignDiagnosticsDataRole(context, testAccount, principalId, () => true)).resolves.toBe('assigned');
    expect(io.confirm).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        { modal: true, detail: expect.stringContaining('read and write') },
        'Add Data Contributor role',
    );
    expect(io.assign).toHaveBeenCalledExactlyOnceWith(
        testAccount.name,
        principalId,
        testAccount.resourceGroup,
        context,
        testAccount.subscription,
    );
    expect(context.valuesToMask).toContain(principalId);
});

it('does not write when dismissed or when the diagnostics tab was closed during confirmation', async () => {
    await expect(assignDiagnosticsDataRole(context, testAccount, principalId, () => true)).resolves.toBe('cancelled');
    let current = true;
    io.confirm.mockImplementation(async (_text, _options, confirm) => {
        current = false;
        return confirm;
    });
    await expect(assignDiagnosticsDataRole(context, testAccount, principalId, () => current)).resolves.toBe(
        'unavailable',
    );
    expect(io.assign).not.toHaveBeenCalled();
});

it('returns a bounded permission denial without logging role recipients or the raw ARM error', async () => {
    io.confirm.mockResolvedValue('Add Data Contributor role');
    io.assign.mockRejectedValue({ statusCode: 403, message: `cannot grant role to ${principalId}` });
    await expect(assignDiagnosticsDataRole(context, testAccount, principalId, () => true)).resolves.toBe('denied');
    expect(io.warn).toHaveBeenCalledExactlyOnceWith('[Connection diagnostics] Data role assignment denied');
});
