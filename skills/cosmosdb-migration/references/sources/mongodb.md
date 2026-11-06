# Optional MongoDB source guidance

Read only for MongoDB evidence. This supplements the common workflow; it does not select a
MongoDB-compatible destination. Target Azure Cosmos DB for NoSQL.

Acquire collection validators, indexes, shard keys, collation, representative canonical Extended JSON,
application models, filters, aggregation pipelines, and updates when authorized. Never connect or sample
production merely because migration was requested. Record sampling method, scope, count, and limitations.
Validators and samples describe different assurance: variants absent from a sample may still exist.

Inventory `_id` identity and its uniqueness scope, ordered compound indexes and shard routing,
missing versus null, literal dotted names, nested objects/arrays, heterogeneous arrays, and variant
native types. Use typed path segments, not dot-separated strings. Preserve ObjectId, Decimal128,
Int64, Binary subtype, BSON Date, timestamp, regex, and other BSON values explicitly; do not round,
truncate, stringify indiscriminately, or assume JavaScript JSON preserves BSON. The bounded conversion
helper supports canonical Extended JSON representations; unfamiliar BSON wrappers remain obligations.

Review `$set`, `$unset`, `$inc`, array filters, positional updates, upserts, aggregation stages,
read concerns, write concerns, sessions, transactions, retry behavior, and change-stream dependencies.
Record required semantics and choose explicit preservation/replacement/waiver decisions. MongoDB
transactions across documents/shards do not imply NoSQL transactional-batch compatibility: prove
the same complete logical partition key and account for batch limits. ETags and patch operations
require an application design; they are not automatic operator translations.

TTL indexes and absolute per-field expiration differ from Cosmos DB item TTL relative to `_ts`.
An update can reset target expiration. Compare before/after-update executable examples and record
deletion timing expectations; neither system promises immediate physical deletion. Preserve soft
deletion, unique constraints, missing/null filter behavior, and sort/collation requirements explicitly.

Official references, when external research is permitted:
- https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/
- https://www.mongodb.com/docs/manual/core/schema-validation/
- https://www.mongodb.com/docs/manual/core/index-ttl/
- https://www.mongodb.com/docs/manual/core/transactions/

No portable fixture constitutes live MongoDB extraction or target behavioral validation.
