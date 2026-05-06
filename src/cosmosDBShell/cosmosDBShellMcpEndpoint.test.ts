/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getCosmosDBShellMcpEndpoint } from './cosmosDBShellMcpEndpoint';

describe('cosmosDBShellMcpEndpoint', () => {
    it('uses the IPv4 loopback address for the MCP endpoint', () => {
        expect(getCosmosDBShellMcpEndpoint('6128')).toBe('http://127.0.0.1:6128');
    });
});
