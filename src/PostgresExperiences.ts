/* ------------------------------------------------------------------------------------------
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from 'azure-arm-postgresql/lib/models';
import { API, DBAccountKind, Experience } from './experience';

export function getExperienceLabel_postgres(account: Server): string {
    const experience: Experience | undefined = tryGetExperience_postgres(account);

    if (experience) {
        return experience.shortName;
    }

    return <API>(account && account.tags && account.tags.defaultExperience);
}

export function tryGetExperience_postgres(account: Server): Experience | undefined {

    if (account) {

        return PostgresExperience;
    }

    return undefined;
}

const PostgresExperience: Experience = { api: API.Postgres, longName: "PostgreSQL", description: "PostgreSQL", shortName: "Postgres", kind: DBAccountKind.Postgres, tag: "Postgres" };
