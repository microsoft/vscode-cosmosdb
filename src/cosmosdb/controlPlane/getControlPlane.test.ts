/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { describe, expect, it, vi } from 'vitest';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';

class FakeArmControlPlane {
    constructor(
        public subscription: AzureSubscription,
        public resourceGroup: string,
        public accountName: string,
    ) {}
}

class FakeDataPlaneControlPlane {
    constructor(public accountInfo: AccountInfo) {}
}

vi.mock('./ArmCosmosDBControlPlane', () => ({
    ArmCosmosDBControlPlane: FakeArmControlPlane,
}));

vi.mock('./DataPlaneCosmosDBControlPlane', () => ({
    DataPlaneCosmosDBControlPlane: FakeDataPlaneControlPlane,
}));

const { getControlPlane } = await import('./index');

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

const fakeSubscription = {
    subscriptionId: '00000000-0000-0000-0000-000000000000',
} as unknown as AzureSubscription;

describe('getControlPlane', () => {
    it('returns ARM control plane for Azure-signed-in account with subscription and resource group', () => {
        const plane = getControlPlane(
            makeAccountInfo({
                subscription: fakeSubscription,
                resourceGroup: 'rg-test',
            }),
        );
        expect(plane).toBeInstanceOf(FakeArmControlPlane);
        expect((plane as unknown as FakeArmControlPlane).subscription).toBe(fakeSubscription);
        expect((plane as unknown as FakeArmControlPlane).resourceGroup).toBe('rg-test');
        expect((plane as unknown as FakeArmControlPlane).accountName).toBe('test-account');
    });

    it('returns data-plane control plane for the local emulator even with subscription and resource group', () => {
        const plane = getControlPlane(
            makeAccountInfo({
                isEmulator: true,
                subscription: fakeSubscription,
                resourceGroup: 'rg-test',
            }),
        );
        expect(plane).toBeInstanceOf(FakeDataPlaneControlPlane);
    });

    it('returns data-plane control plane for workspace-attached account (no subscription)', () => {
        const plane = getControlPlane(makeAccountInfo());
        expect(plane).toBeInstanceOf(FakeDataPlaneControlPlane);
    });

    it('returns data-plane control plane when subscription is set but resource group is missing', () => {
        const plane = getControlPlane(
            makeAccountInfo({
                subscription: fakeSubscription,
            }),
        );
        expect(plane).toBeInstanceOf(FakeDataPlaneControlPlane);
    });

    it('returns data-plane control plane when resource group is set but subscription is missing', () => {
        const plane = getControlPlane(
            makeAccountInfo({
                resourceGroup: 'rg-test',
            }),
        );
        expect(plane).toBeInstanceOf(FakeDataPlaneControlPlane);
    });
});
