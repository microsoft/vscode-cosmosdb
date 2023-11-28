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
    public provideCodeLenses(document: TextDocument, _token: CancellationToken): ProviderResult<CodeLens[]> {
        return callWithTelemetryAndErrorHandling("nosql.provideCodeLenses", (context: IActionContext) => {
            context.telemetry.suppressIfSuccessful = true;
            const text = document.getText();
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const queryObject = JSON.parse(text);
            const lenses: CodeLens[] = [
                new CodeLens(
                    new Range(new Position(0, 0), new Position(0, 0)),
                    {
                        title: "Execute",
                        command: "cosmosDB.executeNoSqlQuery",
                        arguments: [queryObject]
                    }
                ),
                new CodeLens(
                    new Range(new Position(0, 0), new Position(0, 0)),
                    {
                        title: "Execute",
                        command: "cosmosDB.getNoSqlQueryPlan",
                        arguments: [queryObject]
                    }
                )
            ];

            return lenses;
        });
    }
}
