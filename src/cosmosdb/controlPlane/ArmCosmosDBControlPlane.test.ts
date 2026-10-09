/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHttpHeaders, type PipelineResponse } from '@azure/core-rest-pipeline';
import { SchemaService } from '../../services/SchemaService';
import { ArmTestMetadata, createArmTestClient } from '../armTestUtils';
import { ArmCosmosDBControlPlane } from './ArmCosmosDBControlPlane';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));
vi.mock('../../utils/azureClients', () => ({}));
vi.mock('../../services/SchemaService', () => ({
    SchemaService: {
        getInstance: () => ({
            deleteSchemasForDatabase: deleteDatabaseSchemas,
            deleteSchemasForContainer: deleteContainerSchemas,
        }),
    },
}));
const { deleteDatabaseSchemas, deleteContainerSchemas } = vi.hoisted(() => ({
    deleteDatabaseSchemas: vi.fn().mockResolvedValue(undefined),
    deleteContainerSchemas: vi.fn().mockResolvedValue(undefined),
}));

describe('ARM control-plane long-running operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(['createDatabase', 'createContainer', 'deleteDatabase', 'deleteContainer'] as const)(
        '%s waits for ARM completion before returning or cleaning up schemas',
        async (operation) => {
            const client = createArmTestClient();
            const plane = new ArmCosmosDBControlPlane(new ArmTestMetadata(client));
            const completed = Promise.withResolvers<void>();
            const polling = Promise.withResolvers<void>();
            const resource = operation.endsWith('Container')
                ? { id: 'container', partitionKey: { paths: ['/id'], kind: 'Hash', version: 2 } }
                : { id: 'database' };
            const send = vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_httpClient, request) => {
                if (request.url.includes('/operations/test')) {
                    polling.resolve();
                    await completed.promise;
                    return {
                        request,
                        status: 200,
                        headers: createHttpHeaders(),
                        bodyAsText: JSON.stringify({ status: 'Succeeded' }),
                    };
                }
                return {
                    request,
                    status: 200,
                    headers: createHttpHeaders(),
                    bodyAsText: JSON.stringify({ properties: { resource } }),
                };
            });
            send.mockImplementationOnce((_httpClient, request): Promise<PipelineResponse> =>
                Promise.resolve({
                    request,
                    status: 202,
                    headers: createHttpHeaders({
                        'azure-asyncoperation': 'https://management.azure.com/operations/test',
                        'retry-after': '0',
                    }),
                }),
            );
            const result =
                operation === 'createDatabase'
                    ? plane.createDatabase('database')
                    : operation === 'createContainer'
                      ? plane.createContainer('database', { id: 'container' }, 400)
                      : operation === 'deleteDatabase'
                        ? plane.deleteDatabase('database')
                        : plane.deleteContainer('database', 'container');
            const settled = vi.fn();
            void result.then(settled);
            await polling.promise;
            expect(settled).not.toHaveBeenCalled();
            expect(SchemaService.getInstance().deleteSchemasForDatabase).not.toHaveBeenCalled();
            expect(SchemaService.getInstance().deleteSchemasForContainer).not.toHaveBeenCalled();

            completed.resolve();
            const response = await result;
            expect(response ? response.id : undefined).toBe(operation.startsWith('create') ? resource.id : undefined);
            expect(deleteDatabaseSchemas.mock.calls).toEqual(
                operation === 'deleteDatabase' ? [['https://account.documents.azure.com', 'database']] : [],
            );
            expect(deleteContainerSchemas.mock.calls).toEqual(
                operation === 'deleteContainer'
                    ? [['https://account.documents.azure.com', 'database', 'container']]
                    : [],
            );
            expect(send.mock.calls[0][1].method).toBe(operation.startsWith('create') ? 'PUT' : 'DELETE');
        },
    );

    it('does not remove schemas when ARM deletion fails', async () => {
        const client = createArmTestClient();
        const error = new Error('ARM failed');
        vi.spyOn(client.pipeline, 'sendRequest').mockRejectedValue(error);
        const plane = new ArmCosmosDBControlPlane(new ArmTestMetadata(client));

        await expect(plane.deleteContainer('database', 'container')).rejects.toBe(error);
        expect(deleteContainerSchemas).not.toHaveBeenCalled();
    });
});
