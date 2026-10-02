/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from 'es-toolkit';
import { buildDataModel, type DataModel, type WizardState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { DATA_MODEL_DEFAULTS } from '../webviews/cosmosdb/DataModeling/dataModelDefaults';
import { getScenarioList } from '../webviews/cosmosdb/DataModeling/scenarios';

/** Remove generated row IDs and navigation, not user-editable schema or workload values. */
function modelingInputs(model: DataModel) {
    return model.containers.map(({ id: _id, properties, reads, scale, ...container }) => ({
        ...container,
        properties: properties.map(({ id: _id, ...property }) => property),
        reads: reads.map(({ id: _id, ...read }) => read),
        scale: {
            ...scale,
            candidates: scale.candidates.map(({ id: _id, ...candidate }) => candidate),
        },
    }));
}

/** Derive hint eligibility from actual inputs rather than asking the model to guess whether they were edited. */
export function getRecommendationScenarioContext(wizard: WizardState) {
    const scenario = wizard.scenario;
    if (!scenario || scenario === 'other') {
        return { scenario: scenario ?? null, defaultsUnchanged: false, hint: null, containerHints: [] };
    }

    const defaultsUnchanged = isEqual(modelingInputs(wizard.dataModel), modelingInputs(buildDataModel(scenario)));
    return {
        scenario,
        defaultsUnchanged,
        hint: getScenarioList().find((item) => item.id === scenario)?.hint ?? null,
        // Only untouched built-in models receive preferred keys; edited models must be evaluated independently.
        containerHints: defaultsUnchanged
            ? DATA_MODEL_DEFAULTS[scenario].containers.map(({ entity, partitionKey }) => ({ entity, partitionKey }))
            : [],
    };
}
