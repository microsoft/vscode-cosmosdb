export enum MongoDatatypes {
    String = 'string',
    Number = 'number',
    Int32 = 'int32',
    Double = 'double',
    Decimal128 = 'decimal128',
    Long = 'long',
    Boolean = 'boolean',
    Object = 'object',
    Array = 'array',
    Null = 'null',
    Undefined = 'undefined',
    Date = 'date',
    RegExp = 'regexp',
    Binary = 'binary',
    ObjectId = 'objectid',
    Symbol = 'symbol',
    Timestamp = 'timestamp',
    MinKey = 'minkey',
    MaxKey = 'maxkey',
    DBRef = 'dbref',
    Code = 'code',
    CodeWithScope = 'codewithscope',
    Map = 'map',
    // Add any deprecated types if necessary
    _UNKNOWN_ = '_unknown_', // Catch-all for unknown types
}

export namespace MongoDatatypes {
    const displayStringMap: Record<MongoDatatypes, string> = {
        [MongoDatatypes.String]: 'String',
        [MongoDatatypes.Number]: 'Number',
        [MongoDatatypes.Int32]: 'Int32',
        [MongoDatatypes.Double]: 'Double',
        [MongoDatatypes.Decimal128]: 'Decimal128',
        [MongoDatatypes.Long]: 'Long',
        [MongoDatatypes.Boolean]: 'Boolean',
        [MongoDatatypes.Object]: 'Object',
        [MongoDatatypes.Array]: 'Array',
        [MongoDatatypes.Null]: 'Null',
        [MongoDatatypes.Undefined]: 'Undefined',
        [MongoDatatypes.Date]: 'Date',
        [MongoDatatypes.RegExp]: 'RegExp',
        [MongoDatatypes.Binary]: 'Binary',
        [MongoDatatypes.ObjectId]: 'ObjectId',
        [MongoDatatypes.Symbol]: 'Symbol',
        [MongoDatatypes.Timestamp]: 'Timestamp',
        [MongoDatatypes.MinKey]: 'MinKey',
        [MongoDatatypes.MaxKey]: 'MaxKey',
        [MongoDatatypes.DBRef]: 'DBRef',
        [MongoDatatypes.Code]: 'Code',
        [MongoDatatypes.CodeWithScope]: 'CodeWithScope',
        [MongoDatatypes.Map]: 'Map',
        [MongoDatatypes._UNKNOWN_]: 'Unknown',
    };

    export function toDisplayString(type: MongoDatatypes): string {
        return displayStringMap[type] || 'Unknown';
    }

    export function toString(type: MongoDatatypes): string {
        return type;
    }

    /**
     * Converts a MongoDB data type to a case sensitive JSON data type
     * @param type The MongoDB data type
     * @returns A corresponding JSON data type (please note: it's case sensitive)
     */
    export function toJSONType(type: MongoDatatypes): string {
        switch (type) {
            case MongoDatatypes.String:
            case MongoDatatypes.Symbol:
            case MongoDatatypes.Date:
            case MongoDatatypes.Timestamp:
            case MongoDatatypes.ObjectId:
            case MongoDatatypes.RegExp:
            case MongoDatatypes.Binary:
            case MongoDatatypes.Code:
                return 'string';

            case MongoDatatypes.Boolean:
                return 'boolean';

            case MongoDatatypes.Int32:
            case MongoDatatypes.Long:
            case MongoDatatypes.Double:
            case MongoDatatypes.Decimal128:
                return 'number';

            case MongoDatatypes.Object:
            case MongoDatatypes.Map:
            case MongoDatatypes.DBRef:
            case MongoDatatypes.CodeWithScope:
                return 'object';

            case MongoDatatypes.Array:
                return 'array';

            case MongoDatatypes.Null:
            case MongoDatatypes.Undefined:
            case MongoDatatypes.MinKey:
            case MongoDatatypes.MaxKey:
                return 'null';

            default:
                return 'string'; // Default to string for unknown types
        }
    }
}
