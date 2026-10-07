/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';
import { type DatabaseMode } from '../../dataModeling/deploymentModel';
import { type CosmosModel } from '../../panels/migration/cosmosModel';

function terraformString(value: string): string {
    return JSON.stringify(value)
        .replace(/\$\{/g, () => '$${')
        .replace(/%\{/g, '%%{');
}

function csharpString(value: string): string {
    // JSON and ordinary C# strings share escapes, except JSON has no escape for Unicode line separators.
    return JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, (character) => {
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
    });
}

function deploymentTarget(metadata?: AzureResourceMetadata) {
    return {
        subscriptionId: metadata?.subscription.subscriptionId || '<subscription-id>',
        resourceGroup: metadata?.resourceGroup || '<resource-group-name>',
        accountName: metadata?.accountName || '<cosmos-account-name>',
    };
}

function requireDatabaseName(model: CosmosModel): string {
    if (!model.databaseName) throw new Error(l10n.t('A database name is required to generate deployment code.'));
    return model.databaseName;
}

/** Export only missing containers; existing resources remain outside this configuration's ownership. */
export function buildTerraformDeployment(
    model: CosmosModel,
    databaseMode: DatabaseMode,
    metadata?: AzureResourceMetadata,
): string {
    const target = deploymentTarget(metadata);
    const existingDatabase = databaseMode === 'existing';
    const variables: [string, string][] = [
        ['subscription_id', target.subscriptionId],
        ['resource_group_name', target.resourceGroup],
        ['account_name', target.accountName],
        ['database_name', requireDatabaseName(model)],
    ];
    return [
        '# Save as main.tf. Authenticate with Azure CLI or workload/managed identity; do not add credentials.',
        '# Replace any <...> placeholders. This targets an existing Azure Cosmos DB for NoSQL account.',
        '# Review: terraform init, terraform validate, terraform plan; then apply the reviewed plan.',
        '# Matching existing containers are omitted to preserve their policies and throughput.',
        '# Keep the original configuration and state after applying; regenerated exports omit existing containers.',
        '# If adopting existing resources, import them into state and reconcile ALL policies before applying.',
        '# Never apply a plan that replaces or destroys an existing database or container.',
        '# Throughput is intentionally unspecified: review shared/provisioned/serverless capacity before applying.',
        '# https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/cosmosdb_sql_container',
        '',
        'terraform {',
        '  required_version = ">= 1.5.0"',
        '  required_providers {',
        '    azurerm = {',
        '      source  = "hashicorp/azurerm"',
        '      version = ">= 4.2.0, < 5.0.0"',
        '    }',
        '  }',
        '}',
        '',
        'provider "azurerm" {',
        '  features {}',
        '  subscription_id = var.subscription_id',
        '}',
        '',
        ...variables.flatMap(([name, value]) => [
            `variable "${name}" {`,
            '  type    = string',
            `  default = ${terraformString(value)}`,
            '}',
            '',
        ]),
        `${existingDatabase ? 'data' : 'resource'} "azurerm_cosmosdb_sql_database" "database" {`,
        '  name                = var.database_name',
        '  resource_group_name = var.resource_group_name',
        '  account_name        = var.account_name',
        ...(existingDatabase ? [] : ['', '  lifecycle {', '    prevent_destroy = true', '  }']),
        '}',
        '',
        'locals {',
        '  containers = {',
        ...model.containers.flatMap((container) => {
            const paths = container.partitionKeys?.map((key) => key.path) ?? ['/id'];
            return [
                `    ${terraformString(container.name)} = {`,
                `      partition_key_paths = [${paths.map(terraformString).join(', ')}]`,
                `      partition_key_kind  = "${paths.length > 1 ? 'MultiHash' : 'Hash'}"`,
                '    }',
            ];
        }),
        '  }',
        '}',
        '',
        'resource "azurerm_cosmosdb_sql_container" "containers" {',
        '  for_each = local.containers',
        '',
        '  name                  = each.key',
        '  resource_group_name   = var.resource_group_name',
        '  account_name          = var.account_name',
        `  database_name         = ${existingDatabase ? 'data.' : ''}azurerm_cosmosdb_sql_database.database.name`,
        '  partition_key_paths   = each.value.partition_key_paths',
        '  partition_key_kind    = each.value.partition_key_kind',
        '  partition_key_version = 2',
        '',
        '  lifecycle {',
        '    prevent_destroy = true',
        '  }',
        '}',
        '',
    ].join('\n');
}

/** Use ARM with Entra authentication: Cosmos data-plane tokens cannot provision databases or containers. */
export function buildSdkDeployment(
    model: CosmosModel,
    databaseMode: DatabaseMode,
    metadata?: AzureResourceMetadata,
): string {
    const target = deploymentTarget(metadata);
    return [
        '// Save as Program.cs in a .NET console project (C# 10 or later).',
        '// Add packages: dotnet add package Azure.Identity',
        '//               dotnet add package Azure.ResourceManager.CosmosDB',
        '// Sign in locally with Azure CLI, or use a managed/workload identity when hosted in Azure.',
        '// The identity needs Azure management-plane permissions to read/create SQL databases and containers.',
        '// Cosmos data-plane RBAC alone cannot provision resources. No account keys are required.',
        '// Replace <...> placeholders. This ARM export targets Azure, not the local Cosmos DB emulator.',
        '// For sovereign clouds configure DefaultAzureCredential authority and ArmClient environment.',
        '// Run only after reviewing: dotnet run. Do not provision the same resources concurrently.',
        '// On partial failure, select the existing database and regenerate; matching containers are preserved.',
        '// Throughput is unspecified: review shared/provisioned/serverless capacity before running.',
        '// https://learn.microsoft.com/dotnet/api/azure.resourcemanager.cosmosdb',
        '',
        'using System;',
        'using System.Collections.Generic;',
        'using System.Linq;',
        'using Azure;',
        'using Azure.Identity;',
        'using Azure.ResourceManager;',
        'using Azure.ResourceManager.CosmosDB;',
        'using Azure.ResourceManager.CosmosDB.Models;',
        '',
        `string subscriptionId = ${csharpString(target.subscriptionId)};`,
        `string resourceGroupName = ${csharpString(target.resourceGroup)};`,
        `string accountName = ${csharpString(target.accountName)};`,
        `string databaseName = ${csharpString(requireDatabaseName(model))};`,
        '',
        'var client = new ArmClient(new DefaultAzureCredential());',
        'var accountId = CosmosDBAccountResource.CreateResourceIdentifier(',
        '    subscriptionId, resourceGroupName, accountName);',
        '',
        'try',
        '{',
        '    var account = (await client.GetCosmosDBAccountResource(accountId).GetAsync()).Value;',
        '    var databases = account.GetCosmosDBSqlDatabases();',
        ...(databaseMode === 'new'
            ? [
                  '    if ((await databases.ExistsAsync(databaseName)).Value)',
                  '        throw new InvalidOperationException("The database already exists. Select existing database mode.");',
                  '',
                  '    var databaseContent = new CosmosDBSqlDatabaseCreateOrUpdateContent(',
                  '        account.Data.Location, new CosmosDBSqlDatabaseResourceInfo(databaseName));',
                  '    var database = (await databases.CreateOrUpdateAsync(',
                  '        WaitUntil.Completed, databaseName, databaseContent)).Value;',
              ]
            : ['    var database = (await databases.GetAsync(databaseName)).Value;']),
        '    var containers = database.GetCosmosDBSqlContainers();',
        '    var requested = new CosmosDBSqlContainerResourceInfo[]',
        '    {',
        ...model.containers.flatMap((container) => {
            const paths = container.partitionKeys?.map((key) => key.path) ?? ['/id'];
            return [
                `        new CosmosDBSqlContainerResourceInfo(${csharpString(container.name)})`,
                '        {',
                '            PartitionKey = new CosmosDBContainerPartitionKey',
                '            {',
                `                Kind = CosmosDBPartitionKind.${paths.length > 1 ? 'MultiHash' : 'Hash'},`,
                '                Version = 2,',
                `                Paths = { ${paths.map(csharpString).join(', ')} }`,
                '            }',
                '        },',
            ];
        }),
        '    };',
        '',
        '    // Check every selected container before creating any; never update existing container settings.',
        '    var pending = new List<CosmosDBSqlContainerResourceInfo>();',
        '    foreach (var definition in requested)',
        '    {',
        '        var existing = await containers.GetIfExistsAsync(definition.ContainerName);',
        '        if (!existing.HasValue)',
        '        {',
        '            pending.Add(definition);',
        '            continue;',
        '        }',
        '',
        '        var current = existing.Value ?? throw new InvalidOperationException("Azure returned no container resource.");',
        '        var key = current.Data.Resource.PartitionKey;',
        '        if (key is null || (key.Kind ?? CosmosDBPartitionKind.Hash) != definition.PartitionKey.Kind',
        '            || !key.Paths.SequenceEqual(definition.PartitionKey.Paths, StringComparer.Ordinal))',
        '            throw new InvalidOperationException("An existing container has a different partition key.");',
        '        Console.WriteLine($"Preserved existing container: {definition.ContainerName}");',
        '    }',
        '',
        '    foreach (var definition in pending)',
        '    {',
        '        // Abort if another deployment created it after the preflight; do not call the update API on it.',
        '        if ((await containers.ExistsAsync(definition.ContainerName)).Value)',
        '            throw new InvalidOperationException("A container appeared during deployment. Regenerate the export.");',
        '        var content = new CosmosDBSqlContainerCreateOrUpdateContent(account.Data.Location, definition);',
        '        await containers.CreateOrUpdateAsync(WaitUntil.Completed, definition.ContainerName, content);',
        '        Console.WriteLine($"Created container: {definition.ContainerName}");',
        '    }',
        '}',
        'catch (RequestFailedException error)',
        '{',
        '    Console.Error.WriteLine($"Azure request failed (HTTP {error.Status}, code {error.ErrorCode}).");',
        '    throw;',
        '}',
        '',
    ].join('\n');
}
