---
title: Add Spatial Indexes for Geo Queries
impact: MEDIUM-HIGH
impactDescription: enables efficient location queries
tags: index, spatial, geospatial, location
---

## Add Spatial Indexes for Geo Queries

Create spatial indexes for properties that store geographic data when you need to perform proximity or geometry queries.

**Incorrect (geo queries without spatial index):**

```csharp
// Document with location
{
    "id": "store-1",
    "name": "Downtown Store",
    "location": {
        "type": "Point",
        "coordinates": [-122.4194, 37.7749]  // [longitude, latitude]
    }
}

// Query without spatial index - expensive full scan!
var query = @"
    SELECT * FROM c 
    WHERE ST_DISTANCE(c.location, {'type':'Point','coordinates':[-122.4,37.7]}) < 5000";
```

**Correct (spatial index for location queries):**

```csharp
// Create indexing policy with spatial index
var indexingPolicy = new IndexingPolicy
{
    IndexingMode = IndexingMode.Consistent,
    
    // Include path with spatial index
    SpatialIndexes =
    {
        new SpatialPath
        {
            Path = "/location/?",
            SpatialTypes =
            {
                SpatialType.Point
            }
        }
    }
};

// If you have multiple geometry types
var indexingPolicyMulti = new IndexingPolicy
{
    SpatialIndexes =
    {
        // Store locations as points
        new SpatialPath
        {
            Path = "/location/?",
            SpatialTypes = { SpatialType.Point }
        },
        // Delivery zones as polygons
        new SpatialPath
        {
            Path = "/deliveryArea/?",
            SpatialTypes = { SpatialType.Polygon }
        }
    }
};
```

```json
// JSON indexing policy with spatial index
{
    "indexingMode": "consistent",
    "spatialIndexes": [
        {
            "path": "/location/?",
            "types": ["Point"]
        },
        {
            "path": "/boundaries/?",
            "types": ["Polygon"]
        }
    ]
}
```

```csharp
// Efficient spatial queries with index

// Find stores within 5km of user
var nearbyQuery = @"
    SELECT c.name, c.address, 
           ST_DISTANCE(c.location, @userLocation) AS distanceMeters
    FROM c 
    WHERE ST_DISTANCE(c.location, @userLocation) < 5000
    ORDER BY ST_DISTANCE(c.location, @userLocation)";

var userLocation = new
{
    type = "Point",
    coordinates = new[] { -122.4194, 37.7749 }
};

var stores = await container.GetItemQueryIterator<Store>(
    new QueryDefinition(nearbyQuery)
        .WithParameter("@userLocation", userLocation)
).ReadNextAsync();

// Check if point is within polygon (delivery zone)
var withinQuery = @"
    SELECT * FROM c 
    WHERE ST_WITHIN(@orderLocation, c.deliveryArea)";

// Find intersecting regions
var intersectQuery = @"
    SELECT * FROM c 
    WHERE ST_INTERSECTS(c.boundaries, @searchArea)";
```

Supported spatial functions:
- `ST_DISTANCE` - Distance between geometries
- `ST_WITHIN` - Point within polygon
- `ST_INTERSECTS` - Geometries intersect
- `ST_ISVALID` - Validate GeoJSON
- `ST_ISVALIDDETAILED` - Validation with details

Reference: [Geospatial queries](https://learn.microsoft.com/azure/cosmos-db/nosql/query/geospatial)
