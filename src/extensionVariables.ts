/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IAzExtLogOutputChannel, type TreeElementStateManager } from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import type * as vscode from 'vscode';
import { type DatabasesFileSystem } from './DatabasesFileSystem';
import { type CosmosDBBranchDataProvider } from './tree/azure-resources-view/cosmosdb/CosmosDBBranchDataProvider';
import { type CosmosDBWorkspaceBranchDataProvider } from './tree/workspace-view/cosmosdb/CosmosDBWorkspaceBranchDataProvider';
import { type CosmosDBWorkspaceItem } from './tree/workspace-view/cosmosdb/CosmosDBWorkspaceItem';

/** Sentinel — distinguishes "not yet set" from any real value (including `false` or `undefined`). */
const UNSET = Symbol('unset');

/**
 * Creates a write-once property descriptor pair.
 * - The getter throws if the field has never been set.
 * - The setter throws if the field has already been set (prevents accidental re-init).
 */
function required<T>(name: string): { get: () => T; set: (v: T) => void } {
    let stored: T | typeof UNSET = UNSET;
    return {
        get: () => {
            if (stored === UNSET) throw new Error(`[ext] '${name}' not initialized — call activate() first.`);
            return stored;
        },
        set: (value: T) => {
            if (stored !== UNSET) throw new Error(`[ext] '${name}' already initialized.`);
            stored = value;
        },
    };
}

/**
 * Creates a write-once property descriptor pair for optional fields.
 * - The getter returns `undefined` until first set.
 * - The setter still throws on a second write.
 */
function optional<T>(name: string): { get: () => T | undefined; set: (v: T | undefined) => void } {
    let stored: T | typeof UNSET = UNSET;
    return {
        get: () => (stored === UNSET ? undefined : stored),
        set: (value: T | undefined) => {
            if (stored !== UNSET) throw new Error(`[ext] '${name}' already initialized.`);
            stored = value as T;
        },
    };
}

class ExtensionService {
    readonly prefix = 'azureDatabases';

    // — Required fields — getter throws before activate() ————————————————————————
    private readonly _context = required<vscode.ExtensionContext>('context');
    private readonly _outputChannel = required<IAzExtLogOutputChannel>('outputChannel');
    private readonly _secretStorage = required<vscode.SecretStorage>('secretStorage');
    private readonly _fileSystem = required<DatabasesFileSystem>('fileSystem');
    private readonly _rgApiV2 = required<AzureResourcesExtensionApiWithActivity>('rgApiV2');
    private readonly _state = required<TreeElementStateManager>('state');
    private readonly _cosmosDBBranchDataProvider = required<CosmosDBBranchDataProvider>('cosmosDBBranchDataProvider');
    private readonly _cosmosDBWorkspaceBranchDataProvider = required<CosmosDBWorkspaceBranchDataProvider>(
        'cosmosDBWorkspaceBranchDataProvider',
    );

    /** Mutable — updated on every workspace tree refresh via onResourceItemRetrieved. */
    cosmosDBWorkspaceBranchDataResource: CosmosDBWorkspaceItem | undefined = undefined;

    // — Optional fields — getter returns undefined before activate() —————————————
    private readonly _isBundle = optional<boolean>('isBundle');

    /** Mutable — can change at runtime when Copilot is installed/uninstalled. */
    isAIFeaturesEnabled: boolean | undefined = undefined;

    // — Getters / setters ————————————————————————————————————————————————————————
    get context() {
        return this._context.get();
    }
    set context(v) {
        this._context.set(v);
    }

    get outputChannel() {
        return this._outputChannel.get();
    }
    set outputChannel(v) {
        this._outputChannel.set(v);
    }

    get secretStorage() {
        return this._secretStorage.get();
    }
    set secretStorage(v) {
        this._secretStorage.set(v);
    }

    get fileSystem() {
        return this._fileSystem.get();
    }
    set fileSystem(v) {
        this._fileSystem.set(v);
    }

    get rgApiV2() {
        return this._rgApiV2.get();
    }
    set rgApiV2(v) {
        this._rgApiV2.set(v);
    }

    get state() {
        return this._state.get();
    }
    set state(v) {
        this._state.set(v);
    }

    get cosmosDBBranchDataProvider() {
        return this._cosmosDBBranchDataProvider.get();
    }
    set cosmosDBBranchDataProvider(v) {
        this._cosmosDBBranchDataProvider.set(v);
    }

    get cosmosDBWorkspaceBranchDataProvider() {
        return this._cosmosDBWorkspaceBranchDataProvider.get();
    }
    set cosmosDBWorkspaceBranchDataProvider(v) {
        this._cosmosDBWorkspaceBranchDataProvider.set(v);
    }

    // cosmosDBWorkspaceBranchDataResource is a plain mutable field (declared above)

    get isBundle() {
        return this._isBundle.get();
    }
    set isBundle(v) {
        this._isBundle.set(v);
    }

    // isAIFeaturesEnabled is a plain mutable field (declared above)

    // — Constants (replaces nested settingsKeys namespace) ———————————————————————
    readonly settingsKeys = {
        documentLabelFields: 'cosmosDB.documentLabelFields',
        enableEndpointDiscovery: 'cosmosDB.enableEndpointDiscovery',
        batchSize: 'azureDatabases.batchSize',
        confirmationStyle: 'azureDatabases.confirmationStyle',
        showOperationSummaries: 'azureDatabases.showOperationSummaries',
        cosmosDbAuthentication: 'azureDatabases.cosmosDB.preferredAuthenticationMethod',
        authManagedIdentityClientId: 'azureDatabases.authentication.managedIdentity.clientID',

        vsCode: {
            proxyStrictSSL: 'http.proxyStrictSSL',
        },
    } as const;
}

/**
 * Singleton service holding all extension-level state.
 * Each required field is write-once: setting it a second time throws an error,
 * and reading it before initialization throws an error.
 * Optional fields return `undefined` until initialized.
 */
export const ext = new ExtensionService();
