export interface MongoClusterUser {
    id: string;
    name: string;
    type: string;
    properties: {
        user: string;
        provisioningState: string;
    };
    systemData?: {
        createdAt?: string;
        createdBy?: string;
        createdByType?: string;
        lastModifiedAt?: string;
        lastModifiedBy?: string;
        lastModifiedByType?: string;
    };
}
