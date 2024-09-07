import { type Document, type WithId } from 'mongodb';

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
                row[key] = doc[key].toString();
            } else {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                if (doc[key] instanceof Array) {
                    row[key] = `(elements: ${doc[key].length})`;
                } else {
                    row[key] = `${doc[key]}`; // TODO: merge value.toString methods from toSlickGridTree.ts and toSlickGridTable.ts into one location
                }
            }
        }

        result.push(row);
    }

    return result;
}
