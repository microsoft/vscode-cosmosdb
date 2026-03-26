---
title: Use ID references with transient hydration for document relationships
impact: HIGH
impactDescription: enables correct relationship handling without JOINs while preserving UI/API object access
tags: model, relationships, references, transient, hydration, jsonignore
---

## Use ID References with Transient Hydration for Document Relationships

Cosmos DB has no cross-document JOINs. When entities need to reference each other, store relationship IDs as persistent fields and use transient (`@JsonIgnore`) properties for hydrated object access. A service layer populates the transient properties before rendering.

This pattern goes beyond basic referencing (see `model-reference-large`) by providing a **complete strategy for applications that need both document storage efficiency and runtime object graphs** (e.g., web apps with templates, REST APIs returning nested objects).

**Incorrect (JPA relationship annotations — no Cosmos equivalent):**

```java
@Entity
public class Vet {
    @Id
    private Integer id;

    @ManyToMany
    @JoinTable(name = "vet_specialties")
    private List<Specialty> specialties;  // JPA manages this relationship
}
```

**Also incorrect (embedding unbounded relationships directly):**

```java
@Container(containerName = "vets")
public class Vet {
    @Id
    private String id;

    // ❌ Stores full Specialty objects — grows unbounded, duplicates data
    private List<Specialty> specialties;
}
```

**Correct (ID references + transient hydration):**

```java
@Container(containerName = "vets")
public class Vet {

    @Id
    @GeneratedValue
    private String id;

    @PartitionKey
    private String partitionKey = "vet";

    private String firstName;
    private String lastName;

    // ✅ Persisted to Cosmos DB — stores only IDs
    private List<String> specialtyIds = new ArrayList<>();

    // ✅ Transient — NOT stored in Cosmos DB, populated by service layer
    @JsonIgnore
    private List<Specialty> specialties = new ArrayList<>();

    // Both getters needed
    public List<String> getSpecialtyIds() { return specialtyIds; }
    public List<Specialty> getSpecialties() { return specialties; }

    // Count methods should use the transient list when populated,
    // fall back to ID list
    public int getNrOfSpecialties() {
        return specialties.isEmpty() ? specialtyIds.size() : specialties.size();
    }
}
```

**When to use this pattern:**

| Scenario | Approach |
|----------|----------|
| Related data always read together, bounded size | **Embed** (see `model-embed-related`) |
| Related data read independently, unbounded | **ID reference** (this pattern) |
| UI/template needs object access to related data | **ID reference + transient hydration** (this pattern) |
| REST API returns nested objects | **ID reference + transient hydration** (this pattern) |
| Related data rarely accessed after write | **ID reference only** (no transient needed) |

**The transient hydration flow:**

1. **Entity stores** `List<String> specialtyIds` (persisted)
2. **Service layer** reads the entity, then looks up each ID to get full objects
3. **Service populates** `List<Specialty> specialties` (transient)
4. **Controller/template** accesses `vet.getSpecialties()` as if it were a normal object graph

**Important:** `@JsonIgnore` is correct here because transient properties should NOT be stored in Cosmos DB — they are populated on read by the service layer. This is the one legitimate use of `@JsonIgnore` (see `model-json-serialization` for when NOT to use it).

Reference: [Data modeling in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/modeling-data)
