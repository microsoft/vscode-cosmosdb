---
title: Annotate entities for Spring Data Cosmos with @Container, @PartitionKey, and String IDs
impact: CRITICAL
impactDescription: prevents startup failures and data access errors in Spring Data Cosmos applications
tags: sdk, java, spring-boot, spring-data-cosmos, annotations, container, partition-key, entity
---

## Annotate Entities for Spring Data Cosmos

Spring Data Cosmos requires specific annotations on entity classes. JPA annotations (`@Entity`, `@Table`, `@Column`, `@JoinColumn`) are not recognized. Every entity must have `@Container`, a `String` ID with `@Id` and `@GeneratedValue`, and a `@PartitionKey` field.

**Incorrect (JPA annotations — not recognized by Cosmos):**

```java
import jakarta.persistence.*;

@Entity
@Table(name = "owners")
public class Owner {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @Column(name = "first_name")
    private String firstName;

    @OneToMany(cascade = CascadeType.ALL, mappedBy = "owner")
    private List<Pet> pets;
}
```

**Correct (Spring Data Cosmos annotations):**

```java
import com.azure.spring.data.cosmos.core.mapping.Container;
import com.azure.spring.data.cosmos.core.mapping.PartitionKey;
import com.azure.spring.data.cosmos.core.mapping.GeneratedValue;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.springframework.data.annotation.Id;

@JsonIgnoreProperties(ignoreUnknown = true)
@Container(containerName = "owners")
public class Owner {

    @Id
    @GeneratedValue
    private String id;

    @PartitionKey
    private String partitionKey;

    private String firstName;
    private List<String> petIds = new ArrayList<>(); // Store IDs, not entity references

    public Owner() {
        this.partitionKey = "owner"; // Set partition key in constructor
    }
}
```

Add `@JsonIgnoreProperties(ignoreUnknown = true)` to every Cosmos entity class so deserialization ignores Cosmos DB system metadata (`_rid`, `_self`, `_etag`, `_ts`, `_lsn`). This reinforces the serialization safety guidance from `model-json-serialization` at the point where entities are usually generated.

**Key annotation mappings:**

| JPA Annotation | Spring Data Cosmos Equivalent | Notes |
|----------------|-------------------------------|-------|
| `@Entity` | `@Container(containerName = "...")` | Container name should be plural |
| `@Table(name = "...")` | `@Container(containerName = "...")` | Same annotation handles both |
| `@Id` + `@GeneratedValue(strategy = ...)` | `@Id` + `@GeneratedValue` | Must use `org.springframework.data.annotation.Id` |
| `@Column` | *(remove)* | All fields are stored automatically |
| `@JoinColumn` | *(remove)* | No joins in document databases |
| `@OneToMany`, `@ManyToOne`, `@ManyToMany` | *(remove)* | Use embedded data or ID references |
| *(none)* | `@PartitionKey` | **Required** — must be added |

**Critical requirements:**

1. **IDs must be `String` type** — Cosmos DB uses string IDs natively. `Integer`/`Long` IDs cause type conversion failures:
   ```java
   // Wrong: Integer IDs don't work with CosmosRepository<Entity, String>
   private Integer id;

   // Correct: Always use String IDs
   @Id
   @GeneratedValue
   private String id;
   ```

2. **Every entity needs a `@PartitionKey`** — without it, queries cannot be routed efficiently:
   ```java
   @PartitionKey
   private String partitionKey;
   ```

3. **The container's partition key path must match the `@PartitionKey` field name** — when creating a container programmatically, the partition key path must be `/<fieldName>` where `fieldName` is the Java field annotated with `@PartitionKey`. A mismatch causes `IllegalArgumentException: partitionKey must not be null` or silent data routing errors at runtime:
   ```java
   // ❌ Wrong: container path "/id" doesn't match @PartitionKey field "playerId"
   @Container(containerName = "players")
   public class Player {
       @Id
       @GeneratedValue
       private String id;

       @PartitionKey
       private String playerId;
   }
   // Container created with: new CosmosContainerProperties("players", "/id")
   // Runtime error: IllegalArgumentException: partitionKey must not be null

   // ✅ Correct: container path matches @PartitionKey field name
   // Container created with: new CosmosContainerProperties("players", "/playerId")
   ```

4. **Remove ALL `jakarta.persistence.*` imports** — they cause compilation errors after removing JPA dependencies

5. **Remove relationship annotations** — `@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@JoinColumn` have no Cosmos equivalent. Use ID references or embedded data instead (see `model-embed-related` and `model-relationship-references` rules).

Reference: [Spring Data Azure Cosmos DB annotations](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-java-spring-data)
