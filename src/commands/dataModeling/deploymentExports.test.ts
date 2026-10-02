/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';
import {
    DeploymentRequestSchema,
    DeploymentTemplateInputSchema,
    GenerateDeploymentTemplateInputSchema,
} from '../../dataModeling/deploymentModel';
import { type CosmosModel } from '../../panels/migration/cosmosModel';
import { buildSdkDeployment, buildTerraformDeployment } from './deploymentExports';

const model: CosmosModel = {
    version: 1,
    domain: '',
    databaseName: 'sales',
    containers: [
        { name: 'Orders', entities: [], partitionKeys: [{ path: '/tenantId' }, { path: '/address/zip' }] },
        { name: 'Users', entities: [], partitionKeys: [{ path: '/id' }] },
    ],
};
const metadata = {
    accountName: 'azure-account',
    resourceGroup: 'modeling-rg',
    subscription: { subscriptionId: 'subscription-id' },
} as AzureResourceMetadata;

describe('deployment export schemas', () => {
    const input = {
        databaseMode: 'existing',
        databaseName: 'sales',
        containers: [{ entity: 'Orders', partitionKey: '/id' }],
    };

    it('keeps the legacy template input and optional format compatible', () => {
        expect(DeploymentTemplateInputSchema.parse(input)).toEqual(input);
        expect(GenerateDeploymentTemplateInputSchema.parse(input)).toEqual(input);
        for (const format of ['bicep', 'terraform', 'sdk']) {
            expect(GenerateDeploymentTemplateInputSchema.parse({ ...input, format })).toEqual({ ...input, format });
        }
        expect(GenerateDeploymentTemplateInputSchema.safeParse({ ...input, format: 'shell' }).success).toBe(false);
    });

    it.each(['format', 'template', 'code'])('rejects %s on direct deployment requests', (key) => {
        expect(DeploymentRequestSchema.safeParse({ ...input, [key]: 'sdk' }).success).toBe(false);
    });

    it.each([buildTerraformDeployment, buildSdkDeployment])(
        'requires a database name in generated code',
        (generate) => {
            expect(() => generate({ ...model, databaseName: undefined }, 'new')).toThrow(
                'A database name is required to generate deployment code.',
            );
        },
    );
});

describe('Terraform deployment export', () => {
    it('exports a complete provider, target variables, new database and every selected container', () => {
        const code = buildTerraformDeployment(model, 'new', metadata);
        expect(code).toContain('source  = "hashicorp/azurerm"');
        expect(code).toContain('version = ">= 4.2.0, < 5.0.0"');
        expect(code).toContain('subscription_id = var.subscription_id');
        for (const value of ['subscription-id', 'modeling-rg', 'azure-account', 'sales']) {
            expect(code).toContain(`default = "${value}"`);
        }
        expect(code).toContain('resource "azurerm_cosmosdb_sql_database" "database"');
        expect(code).toContain('database_name         = azurerm_cosmosdb_sql_database.database.name');
        expect(code).toContain('"Orders" = {');
        expect(code).toContain('"Users" = {');
        expect(code).toContain('for_each = local.containers');
        expect(code).toContain('partition_key_paths = ["/tenantId", "/address/zip"]');
        expect(code).toContain('partition_key_kind  = "MultiHash"');
        expect(code).toContain('partition_key_paths = ["/id"]');
        expect(code).toContain('partition_key_kind  = "Hash"');
        expect(code).toContain('partition_key_version = 2');
        expect(code).toContain('prevent_destroy = true');
        expect(code).not.toContain('throughput =');
        expect(code).not.toContain('resource "azurerm_cosmosdb_account"');
    });

    it('reads an existing database without managing its settings and provides explicit unknown target placeholders', () => {
        const code = buildTerraformDeployment(model, 'existing');
        expect(code).toContain('data "azurerm_cosmosdb_sql_database" "database"');
        expect(code).not.toContain('resource "azurerm_cosmosdb_sql_database"');
        expect(code).toContain('database_name         = data.azurerm_cosmosdb_sql_database.database.name');
        for (const value of ['<subscription-id>', '<resource-group-name>', '<cosmos-account-name>']) {
            expect(code).toContain(value);
        }
        expect(code).toContain('import them into state');
        expect(code).toContain('Keep the original configuration and state');
    });

    it('escapes quotes, backslashes and Terraform interpolation/directive sequences as literals', () => {
        const code = buildTerraformDeployment(
            {
                ...model,
                databaseName: 'db"${literal}',
                containers: [
                    {
                        name: 'o\'brien"${literal}',
                        entities: [],
                        partitionKeys: [{ path: '/a"\\${literal}%{if}' }],
                    },
                ],
            },
            'existing',
        );
        expect(code).toContain('default = "db\\"$${literal}"');
        expect(code).toContain('"o\'brien\\"$${literal}" = {');
        expect(code).toContain('partition_key_paths = ["/a\\"\\\\$${literal}%%{if}"]');
    });

    it('can represent an empty pending selection without adopting existing containers', () => {
        const code = buildTerraformDeployment({ ...model, containers: [] }, 'existing');
        expect(code).toContain('  containers = {\n  }');
        expect(code).toContain('Matching existing containers are omitted');
    });
});

describe('C# SDK deployment export', () => {
    it('generates a complete Entra-authenticated ARM program without account keys', () => {
        const code = buildSdkDeployment(model, 'new', metadata);
        expect(code).toContain('using Azure.Identity;');
        expect(code).toContain('using Azure.ResourceManager.CosmosDB.Models;');
        expect(code).toContain('new ArmClient(new DefaultAzureCredential())');
        expect(code).toContain('string subscriptionId = "subscription-id";');
        expect(code).toContain('string resourceGroupName = "modeling-rg";');
        expect(code).toContain('string accountName = "azure-account";');
        expect(code).toContain('string databaseName = "sales";');
        expect(code).toContain('databases.ExistsAsync(databaseName)');
        expect(code).toContain('new CosmosDBSqlDatabaseResourceInfo(databaseName)');
        expect(code).toContain('databases.CreateOrUpdateAsync(');
        expect(code).toContain('new CosmosDBSqlContainerResourceInfo("Orders")');
        expect(code).toContain('new CosmosDBSqlContainerResourceInfo("Users")');
        expect(code).toContain('Kind = CosmosDBPartitionKind.MultiHash');
        expect(code).toContain('Paths = { "/tenantId", "/address/zip" }');
        expect(code).toContain('Kind = CosmosDBPartitionKind.Hash');
        expect(code).toContain('Paths = { "/id" }');
        expect(code).toContain('Version = 2');
        expect(code).toContain('account.Data.Location');
        expect(code).toContain('catch (RequestFailedException error)');
        expect(code).not.toContain('AccountKey');
        expect(code).not.toContain('connectionString');
    });

    it('gets an existing database, checks key conflicts and skips existing containers before writes', () => {
        const code = buildSdkDeployment(model, 'existing');
        expect(code).toContain('var database = (await databases.GetAsync(databaseName)).Value;');
        expect(code).not.toContain('databases.CreateOrUpdateAsync');
        expect(code).toContain('containers.GetIfExistsAsync(definition.ContainerName)');
        expect(code).toContain('key.Kind ?? CosmosDBPartitionKind.Hash');
        expect(code).toContain('key.Paths.SequenceEqual(definition.PartitionKey.Paths, StringComparer.Ordinal)');
        expect(code).toContain('Preserved existing container');
        expect(code).toContain('foreach (var definition in pending)');
        expect(code).toContain('containers.ExistsAsync(definition.ContainerName)');
        expect(code.indexOf('key.Paths.SequenceEqual')).toBeLessThan(code.indexOf('containers.CreateOrUpdateAsync'));
        expect(code).toContain('<subscription-id>');
        expect(code).toContain('<resource-group-name>');
        expect(code).toContain('<cosmos-account-name>');
    });

    it('uses ordinary escaped C# string literals for names and ordered keys', () => {
        const code = buildSdkDeployment(
            {
                ...model,
                databaseName: 'db"${literal}',
                containers: [
                    {
                        name: 'o\'brien"${literal}\u2028',
                        entities: [],
                        partitionKeys: [{ path: '/a"\\value' }, { path: '/b' }, { path: '/c' }],
                    },
                ],
            },
            'existing',
        );
        expect(code).toContain('string databaseName = "db\\"${literal}";');
        expect(code).toContain('new CosmosDBSqlContainerResourceInfo("o\'brien\\"${literal}\\u2028")');
        expect(code).toContain('Paths = { "/a\\"\\\\value", "/b", "/c" }');
    });
});
