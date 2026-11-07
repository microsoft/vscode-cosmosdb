# Optional MongoDB source guidance

Read only for MongoDB evidence. This supplements the common workflow; it does not select a
MongoDB-compatible destination. Target Azure Cosmos DB for NoSQL.

Acquire collection validators, indexes, shard keys, collation, representative canonical Extended JSON,
application models, filters, aggregation pipelines, and updates when authorized. Never connect or sample
production merely because migration was requested. Record sampling method, scope, count, and limitations.
Validators and samples describe different assurance: variants absent from a sample may still exist.

Start from the existing document structure. Preserve names, nested objects, arrays, missing/null distinctions,
and additional properties; use subtree mappings rather than flattened copies of every descendant.
Prefer retaining a compatible string `_id` as the target identity when its uniqueness/routing scope permits.
Separate, flatten, or denormalize only for an evidenced Cosmos DB benefit, and record the migration tradeoffs.

## Native identity and scope

For ordinary unsharded collections, `_id` is a required, immutable primary key with an automatically created unique
index. Its uniqueness is collection-scoped, not database-wide or cross-collection. This is native MongoDB behavior;
JSON Schema does not need to declare a separate uniqueness constraint. Record the native identity in the inventory,
with its qualified scope, rather than treating it as absent or waiving it solely because index metadata was not supplied.
If an older inventory omitted that identity solely because the schema lacked a uniqueness declaration, propose
repairing the preflight evidence in its owning phase. Do not silently rewrite upstream artifacts or manufacture a waiver.

Confirm collection options and sharding instead of inferring them from names:

- If `_id` is not the shard key, the default `_id` index enforces uniqueness per shard, not across the whole sharded
  collection. Establish whether the application guarantees cross-shard uniqueness or whether the source identity
  needs routing components.
- Time-series collections do not have the ordinary default `_id` unique-index guarantee. Do not apply ordinary
  collection assumptions to measurements.
- Unconfirmed topology or collation remains an explicit verification obligation, not proof that all identity
  semantics are unknown. Do not claim a collection-wide guarantee where these exceptions are unresolved.

For new target designs, use this identity order:

1. Compatible string `_id`: copy its value to Cosmos `id` with `native-string`.
2. Homogeneous ObjectId `_id`: use `objectid-hex`, preserving the native value as canonical lowercase hexadecimal.
   The retained `_id` may use its canonical Extended JSON representation; apply the chosen representation consistently.
3. Mixed types, composite identities, or incompatible values: use an explicit, lossless type-preserving mapping.
   An ObjectId and a string with the same hex text must not collapse to the same identity.
4. Preserve `_id` by default for document compatibility. If preserving its name is unnecessary and the engineer
   explicitly agrees, `identity.sourceKey: "rename"` can move its value to `id` without storing a duplicate `_id`.
   Cosmos requires `id`; it does not require the separate original property.

Do not change deployed identities merely to adopt a simpler encoding. Verify key type, uniqueness scope, collisions,
Unicode/character constraints, and final byte lengths before import; fail closed rather than sanitize or truncate.
Encoding identical source keys still produces identical target keys and cannot manufacture uniqueness.
If `_id` is retained, application writes must keep it immutable and consistent with `id`; Cosmos does not
automatically enforce that relationship between an ordinary property and the item identifier.

Choose the partition key separately from ID conversion. `/id` supports independent known-ID reads, but it does not
co-locate an entity's events or other related items. Ask about grouped reads, writes, transaction scope, retention,
and scale when code is unavailable. Cosmos enforces `(partition key, id)` uniqueness: preserve the required source
guarantee through a justified routing/enforcement design. When merging collections, account for their independent
ID namespaces; a discriminator field alone does not prevent collisions.

## Values and behavior

Inventory `_id` identity and its uniqueness scope, ordered compound indexes and shard routing,
missing versus null, literal dotted names, nested objects/arrays, heterogeneous arrays, and variant
native types. Use typed path segments, not dot-separated strings. Preserve ObjectId, Decimal128,
Int64, Binary subtype, BSON Date, timestamp, regex, and other BSON values explicitly; do not round,
truncate, stringify indiscriminately, or assume JavaScript JSON preserves BSON. The bounded conversion
helper supports canonical Extended JSON representations; unfamiliar BSON wrappers remain obligations.
Use explicit recursive subtree conversions when choosing JSON representations for BSON values. For dates used
in time queries, prefer the bounded ISO UTC date conversion rather than JSON text embedded in a string. Apply the
same representation consistently instead of retaining both raw subtrees and independently converted projections.

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
- https://www.mongodb.com/docs/manual/core/document/#the-_id-field
- https://www.mongodb.com/docs/manual/tutorial/maintain-uniqueness-in-sharded-clusters/
- https://www.mongodb.com/docs/manual/core/timeseries/timeseries-limitations/#indexes
- https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/
- https://www.mongodb.com/docs/manual/core/schema-validation/
- https://www.mongodb.com/docs/manual/core/index-ttl/
- https://www.mongodb.com/docs/manual/core/transactions/

No portable fixture constitutes live MongoDB extraction or target behavioral validation.
