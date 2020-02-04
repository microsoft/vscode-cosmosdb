import { ext } from "../extensionVariables";
import { MongoCodeLensProvider } from "./services/MongoCodeLensProvider";
import { MongoDatabaseTreeItem } from "./tree/MongoDatabaseTreeItem";

export function setConnectedNode(node: MongoDatabaseTreeItem | undefined, codeLensProvider: MongoCodeLensProvider) {
    ext.connectedMongoDB = node;
    const dbName = node && node.label;
    codeLensProvider.setConnectedDatabase(dbName);
}
