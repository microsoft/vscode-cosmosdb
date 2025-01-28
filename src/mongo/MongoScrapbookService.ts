/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type DatabaseItemModel } from '../mongoClusters/MongoClustersClient';
import { type MongoClusterModel } from '../mongoClusters/tree/MongoClusterModel';
import { type MongoAccountModel } from '../tree/mongo/MongoAccountModel';
import { MongoCodeLensProvider } from './services/MongoCodeLensProvider';

export class MongoScrapbookServiceImpl {
    private _cluster: MongoClusterModel | MongoAccountModel | undefined = undefined;
    private _database: DatabaseItemModel | undefined = undefined;

    private _isExecutingAllCommands: boolean = false;
    private _singleCommandInExecution: vscode.Range | undefined = undefined;

    private _mongoCodeLensProvider = new MongoCodeLensProvider();

    public getCodeLensProvider(): MongoCodeLensProvider {
        return this._mongoCodeLensProvider;
    }

    // eslint-disable-next-line no-unused-vars
    public setConnectedCluster(cluster: MongoClusterModel | MongoAccountModel, database: DatabaseItemModel): void {
        this._cluster = cluster;
        this._database = database;

        this._mongoCodeLensProvider.updateCodeLens();
    }

    public clearConnection(): void {
        this._cluster = undefined;
        this._database = undefined;

        this._mongoCodeLensProvider.updateCodeLens();
    }

    public setExecutingAllCommands(state: boolean): void {
        this._isExecutingAllCommands = state;

        this._mongoCodeLensProvider.updateCodeLens();
    }

    public isExecutingAllCommands(): boolean {
        return this._isExecutingAllCommands;
    }

    public setSingleCommandInExecution(range: vscode.Range | undefined): void {
        this._singleCommandInExecution = range;

        this._mongoCodeLensProvider.updateCodeLens();
    }

    public getSingleCommandInExecution(): vscode.Range | undefined {
        return this._singleCommandInExecution;
    }

    public isConnected(): boolean {
        return this._cluster !== undefined;
    }

    public getDatabaseName(): string | undefined {
        if (!this._database) return undefined;

        return this._database.name;
    }

    public getClusterId() {
        if (!this._cluster) return undefined;

        return this._cluster.id;
    }

    public getDisplayName(): string | undefined {
        if (!this._cluster || !this._database) return undefined;

        return `${this._cluster.name}/${this._database.name}`;
    }
}

export const MongoScrapbookService = new MongoScrapbookServiceImpl();
