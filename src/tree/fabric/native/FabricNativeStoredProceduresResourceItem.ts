/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { type StoredProcedureResource } from '../../cosmosdb/models/CosmosDBTypes';
import { type TreeElement } from '../../TreeElement';
import { FabricStoredProceduresResourceItem } from '../FabricStoredProceduresResourceItem';
import { type FabricStoredProceduresModel } from '../models/FabricStoredProceduresModel';
import { FabricNativeStoredProcedureResourceItem } from './FabricNativeStoredProcedureResourceItem';

export class FabricNativeStoredProceduresResourceItem extends FabricStoredProceduresResourceItem {
    constructor(context: vscode.ExtensionContext, model: FabricStoredProceduresModel, experience: Experience) {
        super(context, model, experience);
    }

    protected getChildrenImpl(storedProcedures: StoredProcedureResource[]): Promise<TreeElement[]> {
        return Promise.resolve(
            storedProcedures.map(
                (procedure) =>
                    new FabricNativeStoredProcedureResourceItem(
                        this.context,
                        { ...this.model, procedure },
                        this.experience,
                    ),
            ),
        );
    }
}
