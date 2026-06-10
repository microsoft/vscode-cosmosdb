/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { describe, expect, it, vi } from 'vitest';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { type AzureResourceMetadata } from '../AzureResourceMetadata';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';

class FakeArmControlPlane {
    constructor(public metadata: AzureResourceMetadata) {}
}

class FakeSdkControlPlane {
    constructor(public accountInfo: AccountInfo) {}
}

vi.mock('./ArmCosmosDBControlPlane', () => ({
    ArmCosmosDBControlPlane: FakeArmControlPlane,
}));

vi.mock('./CosmosDBSdkControlPlane', () => ({
    CosmosDBSdkControlPlane: FakeSdkControlPlane,
}));

const { getControlPlane, getControlPlaneForConnection } = await import('./index');

const fakeSubscription = {
    subscriptionId: '00000000-0000-0000-0000-000000000000',
} as unknown as AzureSubscription;

function makeMetadata(overrides: Partial<AzureResourceMetadata> = {}): AzureResourceMetadata {
    return {
        subscription: fakeSubscription,
        resourceGroup: 'rg-test',
        accountName: 'test-account',
        accountId: 'test-account-id',
        documentEndpoint: 'https://example.documents.azure.com:443/',
        ...overrides,
    } as unknown as AzureResourceMetadata;
}

function makeAccountInfo(overrides: Partial<AccountInfo> = {}): AccountInfo {
    return {
        credentials: [],
        endpoint: 'https://example.documents.azure.com:443/',
        id: 'test-id',
        isEmulator: false,
        isServerless: false,
        name: 'test-account',
        ...overrides,
    };
}

function makeConnection(overrides: Partial<NoSqlQueryConnection> = {}): NoSqlQueryConnection {
    return {
        databaseId: 'db1',
        containerId: 'c1',
        endpoint: 'https://example.documents.azure.com:443/',
        credentials: [],
        isEmulator: false,
        ...overrides,
    };
}

describe('getControlPlane', () => {
    it('returns ARM control plane for Azure-signed-in account with Azure metadata', () => {
        const meta = makeMetadata();
        const plane = getControlPlane(makeAccountInfo({ azureMetadata: meta }));
        expect(plane).toBeInstanceOf(FakeArmControlPlane);
        expect((plane as unknown as FakeArmControlPlane).metadata).toBe(meta);
    });

    it('returns SDK control plane for the local emulator even with Azure metadata', () => {
        const plane = getControlPlane(
            makeAccountInfo({
                isEmulator: true,
                azureMetadata: makeMetadata(),
            }),
        );
        expect(plane).toBeInstanceOf(FakeSdkControlPlane);
    });

    it('returns SDK control plane for workspace-attached account (no Azure metadata)', () => {
        const plane = getControlPlane(makeAccountInfo());
        expect(plane).toBeInstanceOf(FakeSdkControlPlane);
    });
});

describe('getControlPlaneForConnection', () => {
    it('returns ARM control plane when connection carries Azure metadata', () => {
        const meta = makeMetadata();
        const plane = getControlPlaneForConnection(makeConnection({ azureMetadata: meta }));
        expect(plane).toBeInstanceOf(FakeArmControlPlane);
        expect((plane as unknown as FakeArmControlPlane).metadata).toBe(meta);
    });

    it('returns SDK control plane for the local emulator even with Azure metadata', () => {
        const plane = getControlPlaneForConnection(
            makeConnection({
                isEmulator: true,
                azureMetadata: makeMetadata(),
            }),
        );
        expect(plane).toBeInstanceOf(FakeSdkControlPlane);
    });

    it('returns SDK control plane for workspace-attached connection (no Azure metadata)', () => {
        const plane = getControlPlaneForConnection(makeConnection());
        expect(plane).toBeInstanceOf(FakeSdkControlPlane);
    });
});
