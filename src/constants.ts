/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageItem } from "vscode";

export const DefaultBatchSize: number = 50;

export namespace DialogBoxResponses {
    export const Yes: MessageItem = { title: "Yes" };
    export const OK: MessageItem = { title: "OK" };
    export const DontShowAgain: MessageItem = { title: "Don't Show Again" };
    export const upload: MessageItem = { title: "Upload" };
    export const uploadDontWarn: MessageItem = { title: "Upload, don't warn again" };
    export const No: MessageItem = { title: "No" };
    export const Cancel: MessageItem = { title: "Cancel", isCloseAffordance: true };
}

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
};`
