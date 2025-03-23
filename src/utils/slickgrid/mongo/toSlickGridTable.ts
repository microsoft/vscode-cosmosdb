/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON } from 'bson';
import { type Document, type WithId } from 'mongodb';
import { type TableDataEntry } from '../../../documentdb/ClusterSession';
import { MongoBSONTypes } from '../../json/mongo/MongoBSONTypes';
import { valueToDisplayString } from '../../json/mongo/MongoValueFormatters';

/**
 * Extracts data from a list of MongoDB documents at a specified path.
 *
 * @param documents - An array of MongoDB documents with an ID.
 * @param path - An array of strings representing the path to extract data from within each document.
 * @returns An array of objects representing the extracted data at the specified path.
 *
 * @remarks
 * This function ensures that each row has a unique ID by appending a random element to the ID prefix.
 * It also handles the special case of the '_id' field, ensuring it is always included in the data.
 * If the path leads to an array, the function will note the number of elements in the array.
 *
 * @todo Address the issue where the approach solves problems with the tree view but not with the table view.
 */
export function getDataAtPath(documents: WithId<Document>[], path: string[]): TableDataEntry[] {
    const result = new Array<TableDataEntry>();

    /**
     * adding a random element to the idPrefix to make sure that the IDs are unique
     * otherwise, while the data is being updated in the tree, the ID would be the
     * same and the tree would always update
     *
     * todo: continue on this. surprisingly this approach solves issues with the tree view
     * but not with the table view
     */
    const randomId = Date.now().toString().slice(-6);

    let i = 0;
    for (const doc of documents) {
        i++;
        const row: TableDataEntry = { id: `${i}/${randomId}` }; // inject the randomId to make sure the IDs are unique

        // at the root level, extract the objectId for further data edits
        // we also make sure that the '_id' field is always included in the data!
        if (doc._id) {
            row['_id'] = {
                value: valueToDisplayString(doc._id, MongoBSONTypes.inferType(doc._id)),
                type: MongoBSONTypes.inferType(doc._id),
            };
            // TODO: problem here -> what if the user has a field with this name...
            row['x-objectid'] = EJSON.stringify(doc._id, { relaxed: false }); // this is crucial, we need to retain the _id field for future queries from the table view
        }

        // traverse the path to get the level required
        let subdocument: Document = doc;
        for (const key of path) {
            if (subdocument instanceof Object && subdocument[key]) {
                subdocument = subdocument[key] as Document;
            } else {
                // easy, just abort here, and set the subdocument to an empty object
                subdocument = {};
                break;
            }
        }

        if (subdocument !== undefined) {
            // now, we have the subdocument, we can add all its keys to the row
            for (const key of Object.keys(subdocument)) {
                if (key === '_id') {
                    // _id has been processed already
                    continue;
                } else {
                    const value: unknown = subdocument[key];
                    const type: MongoBSONTypes = MongoBSONTypes.inferType(value);

                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    if (value instanceof Array) {
                        row[key] = {
                            value: `array[${value.length}]`,
                            type: MongoBSONTypes.Array,
                        };
                    } else {
                        row[key] = { value: valueToDisplayString(value, type), type: type };
                    }
                }
            }
        }

        result.push(row);
    }

    return result;
}
