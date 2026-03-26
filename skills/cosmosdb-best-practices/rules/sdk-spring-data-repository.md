---
title: Use CosmosRepository correctly and handle Iterable return types
impact: HIGH
impactDescription: prevents ClassCastException and query failures in Spring Data Cosmos repositories
tags: sdk, java, spring-data-cosmos, repository, iterable, pagination, query-methods
---

## Use CosmosRepository Correctly

`CosmosRepository` differs from `JpaRepository` in return types, pagination support, and query method conventions. Common pitfalls include casting `Iterable` to `List` directly and using JPA-style pagination.

**Incorrect (JPA repository patterns that fail with Cosmos):**

```java
// JpaRepository extends PagingAndSortingRepository — Cosmos does not
public interface OwnerRepository extends JpaRepository<Owner, Integer> {
    Page<Owner> findByLastNameStartingWith(String lastName, Pageable pageable);
    List<PetType> findPetTypes();
}
```

**Correct (CosmosRepository patterns):**

```java
import com.azure.spring.data.cosmos.repository.CosmosRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface OwnerRepository extends CosmosRepository<Owner, String> {
    List<Owner> findByLastNameStartingWith(String lastName); // No Pageable
    List<PetType> findAllByOrderByName(); // Renamed, no pagination
}
```

**Critical: Iterable-to-List conversion**

Cosmos repositories return `Iterable`, not `List`. Direct casting causes `ClassCastException`:

```java
// WRONG — ClassCastException: BlockingIterable cannot be cast to java.util.List
default List<Entity> findAllSorted() {
    return (List<Entity>) this.findAll();
}

// CORRECT — Use StreamSupport to convert
import java.util.stream.StreamSupport;
import java.util.stream.Collectors;

default List<Entity> findAllSorted() {
    return StreamSupport.stream(this.findAll().spliterator(), false)
            .collect(Collectors.toList());
}
```

**Query method conversion patterns:**

| JPA Pattern | CosmosRepository Pattern | Notes |
|-------------|-------------------------|-------|
| `Page<E> findByX(String x, Pageable p)` | `List<E> findByX(String x)` | Remove pagination parameter |
| `findPetTypes()` | `findAllByOrderByName()` | Use Spring Data naming conventions |
| `@Query("SELECT p FROM Pet p WHERE ...")` | `@Query("SELECT * FROM c WHERE ...")` | Use Cosmos SQL syntax |
| `findById(Integer id)` | `findById(String id)` | IDs are always `String` |
| `extends JpaRepository<E, Integer>` | `extends CosmosRepository<E, String>` | Entity type + String ID |

**Custom query annotations:**

```java
// JPA JPQL — does not work with Cosmos
@Query("SELECT p FROM Pet p WHERE p.owner.id = :ownerId")
List<Pet> findByOwnerId(@Param("ownerId") Integer ownerId);

// Cosmos SQL — correct syntax
@Query("SELECT * FROM c WHERE c.ownerId = @ownerId")
List<Pet> findByOwnerId(@Param("ownerId") String ownerId);
```

**Method signature conflicts after ID type changes:**

When converting IDs from `Integer` to `String`, methods that previously had different signatures may conflict:

```java
// CONFLICT: Both methods now have same signature (String parameter)
Pet getPet(String name);    // by name
Pet getPet(String id);      // by ID — same signature!

// SOLUTION: Rename to be explicit
Pet getPetByName(String name);
Pet getPetById(String id);
```

**Update all callers** — controllers, tests, formatters, and other services must reference the renamed methods.

Reference: [Spring Data Azure Cosmos DB repository](https://learn.microsoft.com/azure/cosmos-db/nosql/how-to-java-spring-data#define-a-repository)
