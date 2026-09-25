/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { CosmosDBAttachAccountResourceItem } from '../../tree/workspace-view/cosmosdb/CosmosDBAttachAccountResourceItem';
import { NewCoreEmulatorConnectionItem } from '../../tree/workspace-view/cosmosdb/LocalEmulators/NewCoreEmulatorConnectionItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { newEmulatorConnection } from '../newEmulatorConnection/newEmulatorConnection';
import { newConnection } from './newConnection';

const mocks = vi.hoisted(() => ({
    prompt: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizard: vi.fn(function () {
        return { prompt: mocks.prompt, execute: mocks.execute };
    }),
}));
vi.mock('../../constants', () => ({ isEmulatorSupported: true }));
vi.mock('../../utils/dialogs/showConfirmation', () => ({ showConfirmationAsInSettings: vi.fn() }));
vi.mock('./CosmosDBConnectionStringStep', () => ({ CosmosDBConnectionStringStep: class {} }));
vi.mock('./CosmosDBTenantStep', () => ({ CosmosDBTenantStep: class {} }));
vi.mock('./CosmosDBExecuteStep', () => ({ CosmosDBExecuteStep: class {} }));
vi.mock('../newEmulatorConnection/PromptEmulatorTypeStep', () => ({ PromptEmulatorTypeStep: class {} }));
vi.mock('../newEmulatorConnection/PromptEmulatorPortStep', () => ({ PromptEmulatorPortStep: class {} }));
vi.mock('../newEmulatorConnection/nosql/PromptNosqlEmulatorConnectionStringStep', () => ({
    PromptNosqlEmulatorConnectionStringStep: class {},
}));
vi.mock('../newEmulatorConnection/ExecuteStep', () => ({ ExecuteStep: class {} }));

// Wizard services are mocked; these commands only forward the action context.
const context = { errorHandling: {} } as IActionContext;

describe('Connection commands without a selected tree node', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens New Connection from the Command Palette without relying on a cached tree', async () => {
        await newConnection(context);

        expect(AzureWizard).toHaveBeenCalledWith(
            { ...context, parentId: WorkspaceResourceType.AttachedAccounts },
            expect.objectContaining({ title: 'New Connection' }),
        );
        expect(mocks.prompt).toHaveBeenCalledOnce();
        expect(mocks.execute).toHaveBeenCalledOnce();
        expect(showConfirmationAsInSettings).toHaveBeenCalledOnce();
    });

    it('opens New Emulator Connection from the Command Palette', async () => {
        await newEmulatorConnection(context);

        expect(AzureWizard).toHaveBeenCalledWith(
            { ...context, parentTreeElementId: `${WorkspaceResourceType.AttachedAccounts}/localEmulators` },
            expect.objectContaining({ title: 'New Emulator Connection' }),
        );
        expect(mocks.prompt).toHaveBeenCalledOnce();
        expect(mocks.execute).toHaveBeenCalledOnce();
    });

    it('preserves the parent supplied by the normal connection tree item', async () => {
        await newConnection(context, new CosmosDBAttachAccountResourceItem('tree-parent'));

        expect(AzureWizard).toHaveBeenCalledWith({ ...context, parentId: 'tree-parent' }, expect.any(Object));
    });

    it('preserves the parent supplied by the emulator connection tree item', async () => {
        await newEmulatorConnection(context, new NewCoreEmulatorConnectionItem('emulator-parent'));

        expect(AzureWizard).toHaveBeenCalledWith(
            { ...context, parentTreeElementId: 'emulator-parent' },
            expect.any(Object),
        );
    });
});
