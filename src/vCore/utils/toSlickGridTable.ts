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

    let i = 0;
    for (const doc of documents) {
        i++;
        const row = { id: i };

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
