/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SqlNode } from '../../ast/nodes.js';

export interface LookaheadScenario {
    id: string;
    description: string;
    query: string;
    expectedKinds: SqlNode['kind'][];
}

// Workload fields come from the products/orders schemas. Reference links and execution prerequisites
// are documented in docs/architecture.md; these fixtures assert parser behavior, not server execution.
export const lookaheadScenarios: LookaheadScenario[] = [
    {
        id: 'LA-01',
        description: 'partition-filtered projection with nested BETWEEN and parameterized paging',
        query: `SELECT c.id, c.shipping["address"].city AS city, c.totalAmount
FROM c
WHERE c._partitionKey = @customerId
  AND ((c.totalAmount BETWEEN @minTotal AND @maxTotal) OR c.status IN ("pending", "processing"))
  AND NOT IS_NULL(c.shipping.carrier)
ORDER BY c.createdAt DESC, c.id ASC
OFFSET @offset LIMIT @limit`,
        expectedKinds: [
            'BetweenScalarExpression',
            'InScalarExpression',
            'MemberIndexerScalarExpression',
            'OffsetLimitClause',
        ],
    },
    {
        id: 'LA-02',
        description: 'array self-join with aliases, computed projection and nested range filters',
        query: `SELECT o.id, i.productId, i.quantity * i.unitPrice AS lineTotal
FROM orders AS o JOIN i IN o.items
WHERE o._partitionKey = @customerId
  AND (i.quantity BETWEEN 1 AND @maxQuantity)
  AND (i.unitPrice NOT BETWEEN @lowPrice AND @highPrice)
  AND STARTSWITH(i.name, @prefix, true)`,
        expectedKinds: [
            'JoinCollectionExpression',
            'ArrayIteratorCollectionExpression',
            'BetweenScalarExpression',
            'FunctionCallScalarExpression',
        ],
    },
    {
        id: 'LA-03',
        description: 'push predicates into an array subquery before joining',
        query: `SELECT o.id, item.productId
FROM orders o
JOIN (SELECT VALUE i FROM i IN o.items WHERE i.quantity > @minQuantity AND i.unitPrice < @maxPrice) AS item
WHERE o._partitionKey = @customerId`,
        expectedKinds: ['JoinCollectionExpression', 'SubqueryCollection', 'ArrayIteratorCollectionExpression'],
    },
    {
        id: 'LA-04',
        description: 'correlated EXISTS with nested alias shadowing and outer references',
        query: `SELECT o.id
FROM orders o
WHERE o._partitionKey = @customerId
  AND EXISTS(
    SELECT VALUE i FROM i IN o.items
    WHERE (i.quantity BETWEEN 1 AND @maxQuantity)
      AND EXISTS(SELECT VALUE i FROM i IN o.items WHERE i.productId = @productId AND i.unitPrice > @minPrice)
  )`,
        expectedKinds: ['ExistsScalarExpression', 'BetweenScalarExpression', 'ArrayIteratorCollectionExpression'],
    },
    {
        id: 'LA-05',
        description: 'ARRAY and aggregate scalar subqueries in an object projection',
        query: `SELECT VALUE {
  "id": o.id,
  "items": ARRAY(SELECT VALUE {"id": i.productId, "total": i.quantity * i.unitPrice} FROM i IN o.items WHERE i.quantity > @minQuantity),
  "count": (SELECT VALUE COUNT(1) FROM i IN o.items WHERE i.unitPrice >= @minPrice)
}
FROM orders o WHERE o._partitionKey = @customerId`,
        expectedKinds: [
            'ObjectCreateScalarExpression',
            'ArrayScalarExpression',
            'SubqueryScalarExpression',
            'FunctionCallScalarExpression',
        ],
    },
    {
        id: 'LA-06',
        description: 'evaluate a correlated aggregate once through a subquery join',
        query: `SELECT o.id, totals.itemCount, totals.subtotal
FROM orders o
JOIN (SELECT COUNT(1) AS itemCount, SUM(i.quantity * i.unitPrice) AS subtotal FROM i IN o.items) AS totals
WHERE o._partitionKey = @customerId AND totals.itemCount > @minCount AND totals.subtotal > @minTotal`,
        expectedKinds: ['JoinCollectionExpression', 'SubqueryCollection', 'SelectItem'],
    },
    {
        id: 'LA-07',
        description: 'partition-filtered grouping over array elements',
        query: `SELECT i.productId, COUNT(1) AS itemCount, SUM(i.quantity * i.unitPrice) AS revenue
FROM orders o JOIN i IN o.items
WHERE o._partitionKey = @customerId AND o.status != "cancelled"
GROUP BY i.productId`,
        expectedKinds: ['GroupByClause', 'JoinCollectionExpression', 'FunctionCallScalarExpression'],
    },
    {
        id: 'LA-08',
        description: 'coalesce, ternary and nested function calls',
        query: `SELECT VALUE {
  "id": c.id,
  "brand": c.brand ?? "unknown",
  "price": c.inStock ? ROUND(c.price * @factor) : (c.rating ?? 0),
  "label": CONCAT(LEFT(c.name, 3), "-", RIGHT(c.id, 2))
}
FROM c WHERE c._partitionKey = @category AND ((c.price BETWEEN @min AND @max) OR IS_NULL(c.rating))`,
        expectedKinds: [
            'CoalesceScalarExpression',
            'ConditionalScalarExpression',
            'BetweenScalarExpression',
            'FunctionCallScalarExpression',
        ],
    },
    {
        id: 'LA-09',
        description: 'ranked full-text scoring with a partition filter and bounded results',
        query: `SELECT TOP 10 c.id, c.description
FROM c WHERE c._partitionKey = @category AND FullTextContains(c.description, "database")
ORDER BY RANK FullTextScore(c.description, "database", "query")`,
        expectedKinds: ['OrderByClause', 'TopSpec', 'FunctionCallScalarExpression'],
    },
    {
        id: 'LA-10',
        description: 'weighted hybrid ranking with parameterized vector and literal options',
        query: `SELECT TOP 10 c.id, c.text
FROM c
ORDER BY RANK RRF(FullTextScore(c.text, "database"), VectorDistance(c.vector, @embedding, false, {"distanceFunction": "cosine", "dataType": "float32"}), [2, 1])`,
        expectedKinds: ['OrderByClause', 'ArrayCreateScalarExpression', 'ObjectCreateScalarExpression'],
    },
    {
        id: 'LA-11',
        description: 'keywords inside comments and literals with mixed member access and UTF-16 ranges',
        query: `SELECT c["shipping"].address["city"] AS city, "🧪 WHERE BETWEEN AND" AS label
FROM c /* ORDER BY RANK is not syntax here */
WHERE c._partitionKey = @customerId
  AND c.shipping.address.city LIKE @pattern -- JOIN i IN c.items
  AND c.status NOT IN ("cancelled", "pending")`,
        expectedKinds: ['MemberIndexerScalarExpression', 'LikeScalarExpression', 'InScalarExpression'],
    },
    // These cases probe the parser's existing dialect and gates, not recommended application queries.
    {
        id: 'GATE-01',
        description: 'FIRST LAST and ALL distinguish function arguments from subqueries',
        query: `SELECT FIRST(c.tags), LAST(c.tags), ALL(c.tags),
FIRST(SELECT VALUE t FROM t IN c.tags), LAST(SELECT VALUE t FROM t IN c.tags), ALL(SELECT VALUE t FROM t IN c.tags)
FROM c`,
        expectedKinds: [
            'FunctionCallScalarExpression',
            'FirstScalarExpression',
            'LastScalarExpression',
            'ExistsScalarExpression',
        ],
    },
    {
        id: 'GATE-02',
        description: 'keyword-like function names versus property references',
        query: `SELECT rank, rank(c.price), let, let(c.price), LEFT(c.name, 2), RIGHT(c.name, 2)
FROM c ORDER BY rank(c.price)`,
        expectedKinds: ['PropertyRefScalarExpression', 'FunctionCallScalarExpression', 'OrderByClause'],
    },
    {
        id: 'GATE-03',
        description: 'keyword-like iterator aliases versus ordinary collection aliases',
        query: `SELECT rank.productId, let.productId
FROM orders o JOIN rank IN o.items JOIN let IN o.items
WHERE rank.productId = let.productId`,
        expectedKinds: ['ArrayIteratorCollectionExpression', 'JoinCollectionExpression'],
    },
    {
        id: 'GATE-04',
        description: 'parenthesized scalar versus LET expression versus SELECT subquery',
        query: `SELECT (c.price + 1), (LET adjusted = c.price * 2 IN adjusted + 1),
(SELECT VALUE COUNT(1) FROM t IN c.tags)
FROM c WHERE ((c.price + 1) BETWEEN (1 + 2) AND (10 * 20))`,
        expectedKinds: ['LetScalarExpression', 'SubqueryScalarExpression', 'BetweenScalarExpression'],
    },
    {
        id: 'GATE-05',
        description: 'UDF member access and chained dynamic indexers',
        query: `SELECT udf.details(c.id).name, c["items"][0].productId, c.items[c.totalAmount > 0 ? 0 : 1].quantity
FROM c WHERE (c.totalAmount NOT BETWEEN 1 + 2 AND 100 * 2) OR c.status LIKE "pend" || "%"`,
        expectedKinds: [
            'FunctionCallScalarExpression',
            'MemberIndexerScalarExpression',
            'ConditionalScalarExpression',
            'LikeScalarExpression',
        ],
    },
];
