/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FullTextPolicy, type UniqueKeyPolicy } from '@azure/cosmos';
import { pathToFileURL } from 'node:url';
import * as path from 'path';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { type CosmosContainer, type CosmosModel } from '../cosmosModel';
import { type SampleDataResult } from './seedScriptHelpers';

export interface PortableValidationError {
    path: string;
    message: string;
}

export interface ProvisioningVerificationReport {
    version: 1;
    verifiedAt: string;
    modelSha256: string;
    target: {
        type: 'emulator' | 'azure' | 'provision';
        endpoint: string;
        accountName?: string;
    };
    databaseName: string;
    containers: {
        name: string;
        partitionKeys: string[];
        indexingPolicy: unknown;
        fullTextPolicy?: FullTextPolicy;
        uniqueKeyPolicy?: UniqueKeyPolicy;
        capacityMode: 'serverless' | 'provisioned';
        maxThroughput?: number;
    }[];
    sampleItems: {
        containerName: string;
        id: string;
        partitionKeyValues: unknown[];
        found: boolean;
        document?: Record<string, unknown>;
    }[];
    failures: {
        operation: string;
        resource: string;
        code: string;
    }[];
}

export function normalizeFullTextPolicy(policy: CosmosContainer['fullTextPolicy']): FullTextPolicy | undefined {
    if (policy === undefined) return undefined;
    return {
        defaultLanguage: policy.defaultLanguage,
        fullTextPaths: policy.fullTextPaths
            .map((entry) => ({ path: entry.path, language: entry.language ?? policy.defaultLanguage }))
            .sort((left, right) => left.path.localeCompare(right.path)),
    };
}

export function normalizeUniqueKeyPolicy(policy: UniqueKeyPolicy | undefined): UniqueKeyPolicy | undefined {
    if (!policy?.uniqueKeys?.length) return undefined;
    return {
        uniqueKeys: policy.uniqueKeys
            .map(({ paths }) => ({ paths: [...paths].sort() }))
            .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    };
}

interface SampleDataModule {
    validateSampleData(model: CosmosModel, sampleData: SampleDataResult): PortableValidationError[];
}

interface ModelValidationModule {
    validateCosmosModel(model: CosmosModel): PortableValidationError[];
}

type ProvisioningCapacity = Pick<
    ProvisioningVerificationReport['containers'][number],
    'capacityMode' | 'maxThroughput'
>;

interface ArtifactModule {
    getProvisioningCapacity(
        model: CosmosModel,
        container: CosmosContainer,
        targetEnvironment: ProjectJson['phases']['targetEnvironment'],
    ): ProvisioningCapacity;
    buildProvisioningArtifacts(
        model: CosmosModel,
        sampleData: SampleDataResult,
        project: ProjectJson,
    ): Record<'main.bicep' | 'main.bicepparam' | 'seed-data.csh', string>;
}

interface VerificationModule {
    modelSha256(model: CosmosModel): string;
    validateProvisioningVerification(
        model: CosmosModel,
        sampleData: SampleDataResult,
        project: ProjectJson,
        report: ProvisioningVerificationReport,
    ): PortableValidationError[];
}

async function loadModule<T>(extensionPath: string, scriptName: string): Promise<T> {
    const scriptPath = path.join(extensionPath, 'skills', 'cosmosdb-relational-migration', 'scripts', scriptName);
    return (await import(/* @vite-ignore */ pathToFileURL(scriptPath).href)) as T;
}

export async function validatePortableSampleData(
    extensionPath: string,
    model: CosmosModel,
    sampleData: SampleDataResult,
): Promise<PortableValidationError[]> {
    const module = await loadModule<SampleDataModule>(extensionPath, 'validate-sample-data.mjs');
    return module.validateSampleData(model, sampleData);
}

export async function validatePortableMigrationModel(
    extensionPath: string,
    model: CosmosModel,
): Promise<PortableValidationError[]> {
    const module = await loadModule<ModelValidationModule>(extensionPath, 'validate-cosmos-model.mjs');
    return module.validateCosmosModel(model);
}

export async function buildPortableProvisioningArtifacts(
    extensionPath: string,
    model: CosmosModel,
    sampleData: SampleDataResult,
    project: ProjectJson,
): Promise<Record<'main.bicep' | 'main.bicepparam' | 'seed-data.csh', string>> {
    const module = await loadModule<ArtifactModule>(extensionPath, 'generate-provisioning-artifacts.mjs');
    return module.buildProvisioningArtifacts(model, sampleData, project);
}

export async function getPortableProvisioningCapacity(
    extensionPath: string,
    model: CosmosModel,
    container: CosmosContainer,
    targetEnvironment: ProjectJson['phases']['targetEnvironment'],
): Promise<ProvisioningCapacity> {
    const module = await loadModule<ArtifactModule>(extensionPath, 'generate-provisioning-artifacts.mjs');
    return module.getProvisioningCapacity(model, container, targetEnvironment);
}

export async function hashPortableMigrationModel(extensionPath: string, model: CosmosModel): Promise<string> {
    const module = await loadModule<VerificationModule>(extensionPath, 'validate-provisioning-verification.mjs');
    return module.modelSha256(model);
}

export async function validatePortableProvisioningVerification(
    extensionPath: string,
    model: CosmosModel,
    sampleData: SampleDataResult,
    project: ProjectJson,
    report: ProvisioningVerificationReport,
): Promise<PortableValidationError[]> {
    const module = await loadModule<VerificationModule>(extensionPath, 'validate-provisioning-verification.mjs');
    return module.validateProvisioningVerification(model, sampleData, project, report);
}
