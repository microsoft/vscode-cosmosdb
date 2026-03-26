---
title: Use a service layer to hydrate document references before rendering
impact: HIGH
impactDescription: bridges document storage with frameworks expecting object graphs, prevents empty/null relationship data
tags: pattern, service-layer, relationships, hydration, template, controller
---

## Use a Service Layer to Hydrate Document References

When using ID-based references between Cosmos DB documents (see `model-relationship-references`), create a service layer that populates transient relationship properties before returning entities to controllers, templates, or API responses. Never return repository results directly to the presentation layer without hydrating relationships.

**Incorrect (controller accesses repository directly — empty relationships):**

```java
@Controller
public class VetController {

    @Autowired
    private VetRepository vetRepository;

    @GetMapping("/vets")
    public String listVets(Model model) {
        // ❌ Returns vets with specialtyIds populated but specialties list empty
        List<Vet> vets = StreamSupport
            .stream(vetRepository.findAll().spliterator(), false)
            .collect(Collectors.toList());
        model.addAttribute("vets", vets);
        return "vets/vetList";
        // Template calls vet.getSpecialties() → empty list!
    }
}
```

**Correct (service layer hydrates relationships):**

```java
@Service
public class VetService {

    private final VetRepository vetRepository;
    private final SpecialtyRepository specialtyRepository;

    public VetService(VetRepository vetRepository,
                      SpecialtyRepository specialtyRepository) {
        this.vetRepository = vetRepository;
        this.specialtyRepository = specialtyRepository;
    }

    public List<Vet> findAll() {
        List<Vet> vets = StreamSupport
            .stream(vetRepository.findAll().spliterator(), false)
            .collect(Collectors.toList());
        vets.forEach(this::populateRelationships);
        return vets;
    }

    public Optional<Vet> findById(String id) {
        return vetRepository.findById(id)
            .map(vet -> {
                populateRelationships(vet);
                return vet;
            });
    }

    private void populateRelationships(Vet vet) {
        if (vet.getSpecialtyIds() != null && !vet.getSpecialtyIds().isEmpty()) {
            List<Specialty> specialties = vet.getSpecialtyIds()
                .stream()
                .map(specialtyRepository::findById)
                .filter(Optional::isPresent)
                .map(Optional::get)
                .collect(Collectors.toList());
            vet.setSpecialties(specialties);
        }
    }
}
```

**Controller uses the service:**

```java
@Controller
public class VetController {

    @Autowired
    private VetService vetService;  // ✅ Service, not repository

    @GetMapping("/vets")
    public String listVets(Model model) {
        List<Vet> vets = vetService.findAll();
        model.addAttribute("vets", vets);  // ✅ Relationships are populated
        return "vets/vetList";
    }
}
```

**When this pattern is required:**

- **Template engines** (Thymeleaf, JSP, Freemarker) that access `entity.relatedObjects`
- **REST APIs** that return nested JSON with related objects
- **Any presentation layer** that expects an object graph from the persistence layer

**Without this pattern** you will see:
- Empty lists where related objects should appear
- `Property or field 'specialties' cannot be found` errors in Thymeleaf
- `EL1008E` Spring Expression Language errors
- Null/empty data in API responses where relationships should appear

**Key rules:**

1. **Every controller method that returns entities for rendering must use the service layer** — never call repositories directly
2. **Populate ALL transient properties** used by templates or API serializers
3. **Service methods returning collections** must hydrate each entity in the list
4. **Service methods returning single entities** must hydrate before returning

**Performance consideration:** This pattern causes N+1 queries (one per reference ID). For large collections, consider batch lookups:

```java
// Batch lookup instead of N individual findById calls
private void populateRelationships(Vet vet) {
    if (vet.getSpecialtyIds() != null && !vet.getSpecialtyIds().isEmpty()) {
        // Use a single query with IN clause
        List<Specialty> specialties = specialtyRepository
            .findAllById(vet.getSpecialtyIds());
        vet.setSpecialties(specialties);
    }
}
```

For truly high-volume scenarios, consider denormalizing the data instead (see `model-denormalize-reads`) or using Change Feed to maintain materialized views (see `pattern-change-feed-materialized-views`).

Reference: [Data modeling in Azure Cosmos DB](https://learn.microsoft.com/azure/cosmos-db/nosql/modeling-data)
