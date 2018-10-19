import { VscodeCosmos } from "./vscode-cosmosdb.api";

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class CosmosAPI {
    version = '0.00.00';

    async helloworld(): Promise<string> {
        return 'Hello World!';
    }

    api: VscodeCosmos = {
        version: this.version,
        helloworld: () => this.helloworld()
    };
}
