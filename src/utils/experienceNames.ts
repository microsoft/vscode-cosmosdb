/* ------------------------------------------------------------------------------------------
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Experience } from "../constants";

export function getExperienceName(experience: Experience) {
    switch (experience) {
        case Experience.DocumentDB: return "SQL";
        case Experience.Graph: return "Gremlin (graph)";
        case Experience.MongoDB: return "MongoDB";
        case Experience.Table: return "Azure Table";
    }
}

export function getShortExperienceName(experience: Experience) {
    switch (experience) {
        case Experience.DocumentDB: return "SQL";
        case Experience.Graph: return "Gremlin";
        case Experience.MongoDB: return "MongoDB";
        case Experience.Table: return "Table";
    }
}
