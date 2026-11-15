# Architecture — system-wide structure

**Location:** `docs/architecture/`. **Type:** `architecture`. **Required relations:** none.

Use Architecture for boundaries crossing multiple features: component ownership, trust boundaries, deployment topology, process lifetimes, and high-level data/control flow. Keep detailed endpoint schemas and method behavior in Contracts/Designs.

## Recommended content

- **Context and scope:** system being described and affected actors.
- **Components / ownership:** responsibilities; what each component deliberately does not own.
- **Dependency directions:** which parts may call or depend on others.
- **Runtime/deployment topology:** nodes, processes, ownership, lifecycle, and failures.
- **Critical flows:** message and security boundaries, ideally with simple diagrams.
- **Assumptions / unresolved questions:** unknowns especially relevant to a rewrite.

May declare `addresses` to applicable Requirements; unlike Design, this is not mandatory in the previous Specbook schema. `perspective` is allowed on Architecture and Design only. Keep one canonical architecture per scope and link related sub-architectures rather than duplicating.

## Review

Avoid imposing the *old* Plugumi process layout on a new architecture. Separate observed behavior from a proposed model. Do not hardcode Plugin domain logic into an AI-independent Core just for convenience unless newly decided.
