/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, callWithTelemetryAndErrorHandling } from "@microsoft/vscode-azext-utils";
import {
    CancellationToken,
    CodeLens,
    CodeLensProvider,
    Position,
    ProviderResult,
    Range,
    TextDocument
} from "vscode";

export class NoSqlCodeLensProvider implements CodeLensProvider {
    public provideCodeLenses(_document: TextDocument, _token: CancellationToken): ProviderResult<CodeLens[]> {
        return callWithTelemetryAndErrorHandling("nosql.provideCodeLenses", (context: IActionContext) => {
            context.telemetry.suppressIfSuccessful = true;
            const database = {};
            const lenses: CodeLens[] = [
                new CodeLens(
                    new Range(new Position(0, 0), new Position(0, 0)),
                    {
                        title: "Execute",
                        command: "cosmosDB.executeNoSqlQuery",
                        arguments: [database]
                    }
                )
            ];

            return lenses;
        });
    }
}
