/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

export enum HierarchyStep {
    First = 1,
    Second = 2,
    Third = 3,
}

export class PromptPartitionKeyStep extends AzureWizardPromptStep<CreateContainerWizardContext> {
    public hideStepCount: boolean = false;

    constructor(public readonly hierarchyStep: HierarchyStep) {
        super();
    }

    public async prompt(context: CreateContainerWizardContext): Promise<void> {
        const placeHolder =
            this.hierarchyStep === HierarchyStep.First
                ? 'first partition key e.g., /TenantId'
                : this.hierarchyStep === HierarchyStep.Second
                  ? 'second partition key e.g., /UserId'
                  : this.hierarchyStep === HierarchyStep.Third
                    ? 'third partition key e.g., /address/zipCode'
                    : 'partition key';
        const prompt =
            `Enter the partition key for the container` +
            (this.hierarchyStep === HierarchyStep.First ? '' : ` (leave blank to skip)`);

        let partitionKey = (
            await context.ui.showInputBox({
                prompt,
                placeHolder,
                value: '',
                validateInput: (name: string) => this.validateInput(name),
                asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
            })
        ).trim();

        if (partitionKey.length === 0) {
            return;
        }

        if (partitionKey && partitionKey.length && partitionKey[0] !== '/') {
            partitionKey = '/' + partitionKey;
        }

        context.valuesToMask.push(partitionKey, partitionKey.slice(1));

        context.partitionKey ??= { paths: [] };
        context.partitionKey.paths.push(partitionKey);
    }

    public shouldPrompt(context: CreateContainerWizardContext): boolean {
        if (this.hierarchyStep === HierarchyStep.First || this.hierarchyStep === HierarchyStep.Second) {
            return true;
        }

        if (this.hierarchyStep === HierarchyStep.Third) {
            return (context.partitionKey?.paths?.length ?? 0) >= 2;
        }

        return false;
    }

    public validateInput(partitionKey: string | undefined): string | undefined {
        partitionKey = partitionKey ? partitionKey.trim() : '';

        if (partitionKey.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (/[^a-zA-Z0-9_/]/.test(partitionKey)) {
            return `Partition key cannot contain the wildcard characters`;
        }

        if (!/^\/?[^/]*$/.test(partitionKey)) {
            return 'Partition key can only start with a forward slash (/)';
        }

        if (partitionKey.length > 255) {
            return 'Partition key cannot be longer than 255 characters';
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateContainerWizardContext,
        partitionKey: string,
    ): Promise<string | undefined> {
        if (this.hierarchyStep === HierarchyStep.First && partitionKey.length === 0) {
            return 'Partition key is required.';
        }

        if (partitionKey && partitionKey.length && partitionKey[0] !== '/') {
            partitionKey = '/' + partitionKey;
        }

        if (context.partitionKey?.paths?.includes(partitionKey)) {
            return 'Partition key must be unique.';
        }

        return undefined;
    }
}
