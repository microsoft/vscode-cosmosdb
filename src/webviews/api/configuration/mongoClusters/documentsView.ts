
export type DocumentsViewWebviewSharedStateType = {
    id: string; // move to base type

    liveConnectionId: string;
    databaseName: string;
    collectionName: string;
    documentId: string;

    mode: string; // 'add', 'view', 'edit'

    documentContent: string;
};

