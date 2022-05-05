/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const isWindows: boolean = /^win/.test(process.platform);

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CoreExperience, GremlinExperience, MongoExperience, TableExperience } from './AzureDBExperiences';
import { ext } from './extensionVariables';

export namespace Links {
    export const LocalConnectionDebuggingTips: string = 'https://aka.ms/AA5zah5';
}

export interface IThemedIconPath {
    light: string;
    dark: string;
}

export function getThemedIconPath(iconName: string): IThemedIconPath {
    const a = {
        light: path.join(getResourcesPath(), 'icons', 'light', iconName),
        dark: path.join(getResourcesPath(), 'icons', 'dark', iconName)
    };
    assert(fs.existsSync(a.light));
    return a;
}

export function getThemeAgnosticIconPath(iconName: string): IThemedIconPath {
    const a = {
        light: path.join(getResourcesPath(), 'icons', 'theme-agnostic', iconName),
        dark: path.join(getResourcesPath(), 'icons', 'theme-agnostic', iconName)
    };
    assert(fs.existsSync(a.light));
    return a;
}

export function getResourcesPath(): string {
    return ext.context.asAbsolutePath('resources');
}

export const doubleClickDebounceDelay = 500; //milliseconds

export const defaultStoredProcedure =
    `function sample(prefix) {
    var collection = getContext().getCollection();

    // Query documents and take 1st item.
    var isAccepted = collection.queryDocuments(
        collection.getSelfLink(),
        'SELECT * FROM root r',
        function (err, feed, options) {
            if (err) throw err;

            // Check the feed and if empty, set the body to 'no docs found',
            // else take 1st element from feed
            if (!feed || !feed.length) {
                var response = getContext().getResponse();
                response.setBody('no docs found');
            }

            else {
                var response = getContext().getResponse();
                var body = { prefix: prefix, feed: feed[0] };
                response.setBody(JSON.stringify(body));
            }
        });

    if (!isAccepted) throw new Error('The query was not accepted by the server.');
};` ;

export const emulatorPassword = 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';

// https://docs.mongodb.com/manual/mongo/#working-with-the-mongo-shell
export const testDb: string = 'test';

export const connectedPostgresKey: string = 'ms-azuretools.vscode-azuredatabases.connectedPostgresDB';
export const postgresLanguageId: string = 'postgres';
export const postgresFileExtension: string = `.psql`;
export const postgresBaseFileName: string = 'query';
export const postgresDefaultPort = '5432';
export const postgresDefaultDatabase = 'postgres';
export const SERVERLESS_CAPABILITY_NAME = 'EnableServerless';

const databaseAccountType = 'Microsoft.DocumentDB/databaseAccounts';

export const mongoDefaultExperienceTag = "Azure Cosmos DB for MongoDB API";

export const cosmosMongoFilter = {
    type: databaseAccountType,
    kind: MongoExperience.kind,
    tags: {
        defaultExperience: mongoDefaultExperienceTag
    }
};

export const gremlinDefaultExperienceTag = 'Gremlin (graph)';

export const cosmosGremlinFilter = {
    type: databaseAccountType,
    kind: GremlinExperience.kind,
    tags: {
        defaultExperience: gremlinDefaultExperienceTag
    }
};

export const tableDefaultExperienceTag = 'Azure Table';

export const cosmosTableFilter = {
    type: databaseAccountType,
    kind: TableExperience.kind,
    tags: {
        defaultExperience: tableDefaultExperienceTag
    }
};

export const sqlDefaultExperienceTag = 'Core (SQL)';

export const sqlFilter = {
    type: databaseAccountType,
    kind: CoreExperience.kind,
    tags: {
        defaultExperience: sqlDefaultExperienceTag
    }
};

export const postgresFlexibleFilter = {
    type: 'Microsoft.DBforPostgreSQL/flexibleServers'
};

export const postgresSingleFilter = {
    type: 'Microsoft.DBForPostgreSQL/servers'
};
