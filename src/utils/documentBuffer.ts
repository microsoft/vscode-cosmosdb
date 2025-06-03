/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON } from 'bson';

/**
 * Configuration options for the document buffer
 */
export interface DocumentBufferOptions {
    /**
     * Maximum size of the buffer in bytes before it should be flushed
     */
    maxBufferSizeBytes: number;

    /**
     * Maximum number of documents in the buffer before it should be flushed
     */
    maxDocumentCount: number;

    /**
     * Maximum size of a single document in bytes that can be added to the buffer
     */
    maxSingleDocumentSizeBytes: number;

    /**
     * Function to calculate the size of a document
     */
    calculateDocumentSize: (document: unknown) => number;
}

/**
 * Error codes for document buffer operations
 */
export enum BufferErrorCode {
    /**
     * No error occurred
     */
    None = 'none',

    /**
     * Document is too large to fit in the buffer based on maxSingleDocumentSizeBytes
     */
    DocumentTooLarge = 'document_too_large',

    /**
     * Buffer has reached maximum number of documents (maxDocumentCount)
     * or maximum size in bytes (maxBufferSizeBytes)
     */
    BufferFull = 'buffer_full',

    /**
     * Document is null or undefined
     */
    EmptyDocument = 'empty_document',

    /**
     * Other unexpected errors
     */
    Other = 'other',
}

/**
 * Result of an insert operation into the document buffer
 */
export interface BufferInsertResult {
    /**
     * Whether the insert operation was successful
     * If true, the documentsToProcess will be undefined
     */
    success: boolean;

    /**
     * Error code indicating the reason for failure
     */
    errorCode: BufferErrorCode;
}

export interface BufferInsertOrFlushResult<T> extends BufferInsertResult {
    /**
     * Documents that need to be processed immediately if not buffered
     * This could be the current document if it's too large, or
     * the contents of the buffer if it's full and needs to be flushed
     */
    documentsToProcess?: T[];
}

/**
 * Document buffer for a specific database/collection pair.
 * Used for batching document inserts to improve performance.
 */
export class DocumentBuffer<T> {
    private documents: T[] = [];
    private currentSize: number = 0;

    /**
     * Create a new document buffer
     *
     * @param options Configuration options for the buffer
     */
    constructor(private readonly options: DocumentBufferOptions) {}

    /**
     * Calculate the size of a document using the provided size calculation function
     */
    public getDocumentSize(document?: T): number {
        if (!document) {
            return 0;
        }
        return this.options.calculateDocumentSize(document);
    }

    /**
     * Check if the buffer should be flushed
     *
     * @param documentSize Size of the document to be added (optional)
     */
    public shouldFlush(documentSize: number = 0): boolean {
        return (
            this.documents.length + 1 > this.options.maxDocumentCount ||
            this.currentSize + documentSize > this.options.maxBufferSizeBytes
        );
    }

    /**
     * Insert a document into the buffer
     * If the document is too large or the buffer is full, it will return the documents that need to be processed
     * Note: It is highly recommended to check if flush needed with `shouldFlush` before inserting
     *
     * @param document The document to insert
     * @returns Result indicating success or documents that need immediate processing
     */
    public instertOrFlush(document: T): BufferInsertOrFlushResult<T> {
        const insertResult = this.insert(document);
        if (insertResult.success) {
            // If the insert was successful, return success with no documents to process
            return { ...insertResult, documentsToProcess: undefined };
        }
        // If the insert failed, we need to determine what to do next
        switch (insertResult.errorCode) {
            case BufferErrorCode.DocumentTooLarge:
                // If the document is too large, return it for immediate processing
                return {
                    ...insertResult,
                    documentsToProcess: [document],
                };

            case BufferErrorCode.BufferFull:
                // If the buffer is full, return the current buffer for processing
                // Note that current document is not added to the buffer yet
                return {
                    ...insertResult,
                    documentsToProcess: this.flush(),
                };

            case BufferErrorCode.EmptyDocument:
                // If the document is empty, return an empty array for processing
                return {
                    ...insertResult,
                    documentsToProcess: [],
                };

            case BufferErrorCode.None:
                // This shouldn't happen since we already checked success, but handle it anyway
                return { ...insertResult, documentsToProcess: undefined };

            case BufferErrorCode.Other:
            default:
                // Handle any other error codes or future additions
                return {
                    ...insertResult,
                    documentsToProcess: [],
                };
        }
    }

    public insert(document: T): BufferInsertResult {
        // Check if the document is valid
        if (!document) {
            return { success: false, errorCode: BufferErrorCode.EmptyDocument };
        }

        const documentSize = this.getDocumentSize(document);

        // If the document is too large to fit in the buffer, return it for immediate processing
        if (documentSize > this.options.maxSingleDocumentSizeBytes) {
            return {
                success: false,
                errorCode: BufferErrorCode.DocumentTooLarge,
            };
        }

        // Check if buffer is full
        if (this.shouldFlush(documentSize)) {
            return {
                success: false,
                errorCode: BufferErrorCode.BufferFull,
            };
        }

        // Add the document to the buffer
        this.documents.push(document);
        this.currentSize += documentSize;

        return { success: true, errorCode: BufferErrorCode.None };
    }

    /**
     * Flush all documents from the buffer
     *
     * @returns All documents currently in the buffer
     */
    public flush(): T[] {
        const documents = [...this.documents];
        this.documents = [];
        this.currentSize = 0;

        return documents;
    }

    /**
     * Get statistics about the current buffer state
     */
    public getStats(): { documentCount: number; currentSizeBytes: number } {
        return {
            documentCount: this.documents.length,
            currentSizeBytes: this.currentSize,
        };
    }
}

// Default configuration for MongoDB buffers
const defaultMongoBufferConfig: DocumentBufferOptions = {
    maxBufferSizeBytes: 32 * 1024 * 1024, // 32MB
    maxDocumentCount: 50,
    maxSingleDocumentSizeBytes: 16 * 1024 * 1024, // 16MB
    calculateDocumentSize: (document: unknown) => {
        // Use EJSON to calculate the size of MongoDB documents
        // Adding 20% for BSON overhead compared to JSON
        return document ? Buffer.byteLength(EJSON.stringify(document)) * 1.2 : 0;
    },
};

// Default configuration for Cosmos DB buffers
const defaultCosmosBufferConfig: DocumentBufferOptions = {
    maxBufferSizeBytes: 4 * 1024 * 1024, // 4MB
    maxDocumentCount: 100,
    maxSingleDocumentSizeBytes: 2 * 1024 * 1024, // 2MB
    calculateDocumentSize: (document: unknown) => {
        return document ? Buffer.byteLength(EJSON.stringify(document)) : 0;
    },
};

/**
 * Create a document buffer configured for MongoDB
 */
export function createMongoDbBuffer<T>(customConfig?: DocumentBufferOptions): DocumentBuffer<T> {
    return new DocumentBuffer<T>({
        ...defaultMongoBufferConfig,
        ...customConfig,
    });
}

/**
 * Create a document buffer configured for Cosmos DB
 */
export function createCosmosDbBuffer<T>(customConfig?: DocumentBufferOptions): DocumentBuffer<T> {
    return new DocumentBuffer<T>({
        ...defaultCosmosBufferConfig,
        ...customConfig,
    });
}
