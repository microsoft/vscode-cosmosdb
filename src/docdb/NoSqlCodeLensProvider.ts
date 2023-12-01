/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, callWithTelemetryAndErrorHandling } from "@microsoft/vscode-azext-utils";
import {
    CancellationToken,
    CodeLens,
    CodeLensProvider,
    Event,
    EventEmitter,
    Position,
    ProviderResult,
    Range,
    TextDocument
} from "vscode";
import { KeyValueStore } from "../KeyValueStore";

export type NoSqlQueryConnection = {
    databaseId: string;
    containerId: string;
    endpoint: string;
    masterKey: string;
    isEmulator: boolean;
};

export const noSqlQueryConnectionKey = "NO_SQL_QUERY_CONNECTION_KEY.v1";

export class NoSqlCodeLensProvider implements CodeLensProvider {
    private _onDidChangeEmitter: EventEmitter<void> = new EventEmitter<void>();

    public get onDidChangeCodeLenses(): Event<void> {
        return this._onDidChangeEmitter.event;
    }

    public updateCodeLens(): void {
        this._onDidChangeEmitter.fire();
    }

    public provideCodeLenses(document: TextDocument, _token: CancellationToken): ProviderResult<CodeLens[]> {
        return callWithTelemetryAndErrorHandling("nosql.provideCodeLenses", (context: IActionContext) => {
            context.telemetry.suppressIfSuccessful = true;
            const text = document.getText();
            const queryText = text;

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
            const connectedCollection: NoSqlQueryConnection | undefined = KeyValueStore.instance.get(noSqlQueryConnectionKey) as any;
            let connectCodeLens: CodeLens;
            if (!connectedCollection) {
                connectCodeLens = new CodeLens(
                    new Range(new Position(0, 0), new Position(0, 0)),
                    {
                        title: "Not connected",
                        command: "cosmosDB.connectNoSqlContainer",
                        arguments: []
                    }
                );
            } else {
                connectCodeLens = new CodeLens(
                    new Range(new Position(0, 0), new Position(0, 0)),
                    {
                        title: `Connected to ${connectedCollection.databaseId}.${connectedCollection.containerId}`,
                        command: "cosmosDB.connectNoSqlContainer",
                        arguments: []
                    }
                );
            }
            const lenses: CodeLens[] = [
                connectCodeLens,
                new CodeLens(
                    new Range(new Position(0, 0), new Position(0, 0)),
                    {
                        title: "Execute",
                        command: "cosmosDB.executeNoSqlQuery",
                        arguments: [{ queryText }]
                    }
                ),
                new CodeLens(
                    new Range(new Position(0, 0), new Position(0, 0)),
                    {
                        title: "Execute with Query Metrics",
                        command: "cosmosDB.executeNoSqlQuery",
                        arguments: [{ queryText, populateQueryMetrics: true }]
                    }
                ),
                new CodeLens(
                    new Range(new Position(0, 0), new Position(0, 0)),
                    {
                        title: "Get Query Plan",
                        command: "cosmosDB.getNoSqlQueryPlan",
                        arguments: [{ queryText }]
                    }
                )
            ];

            return lenses;
        });
    }
}
