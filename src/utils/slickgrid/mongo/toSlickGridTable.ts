import { type Document, type WithId } from 'mongodb';
import { MongoBSONTypes } from '../../json/mongo/MongoBSONTypes';
import { valueToDisplayString } from '../../json/mongo/MongoValueFormatters';

export function getFieldsTopLevel(documents: WithId<Document>[]): string[] {
    const keys = new Set<string>();

    for (const doc of documents) {
        for (const key of Object.keys(doc)) {
            keys.add(key);
        }
    }

    return Array.from(keys);
}

export function getDataTopLevel(documents: WithId<Document>[]): object[] {
    const result = new Array<object>();

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
        const row = { id: `${i}/${randomId}` };

        for (const key of Object.keys(doc)) {
            if (key === '_id') {
                row[key] = { value: valueToDisplayString(doc[key], MongoBSONTypes.ObjectId), type: MongoBSONTypes.ObjectId };
            } else {
                const value: unknown = doc[key];
                const type: MongoBSONTypes = MongoBSONTypes.inferType(value);

                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                if (value instanceof Array) {
                    row[key] = `(elements: ${value.length})`;
                } else {
                    row[key] = valueToDisplayString(value, type);
                }
            }
        }

        result.push(row);
    }

    return result;
}
