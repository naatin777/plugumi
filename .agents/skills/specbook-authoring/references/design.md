# Design — one concrete solution

**Location:** `docs/designs/`. **Type:** `design`. **Required relation:** `addresses` must point to **at least one existing Requirement**.

Describe how the system will satisfy one or more requirements. A Design is narrower than Architecture and can specify state machines, algorithms, concurrency, failure behavior, and responsibilities. Avoid turning it into a historical decision log.

## Recommended content

- **Requirements addressed:** why this design exists and links to requirement IDs.
- **Model and invariants:** entities, ownership, lifecycle, state transitions.
- **Behavior:** normal and negative paths, ordering, cancellation, retries, idempotency.
- **Boundaries:** API/Contract references, authorization, and validation responsibility.
- **Alternatives / consequences:** concise; use a Decision artifact if a substantial choice is accepted.
- **Unresolved questions and verification implications.**

Example frontmatter relation:

```yaml
relations:
  addresses:
    - '00002'
```

Replace the example ID with a **real** ID; do not create a design with an invented target. `perspective` may be used for current/proposed interpretation if explicitly useful; status remains the authoritative acceptance marker.

## Review

Distinguish durable semantic decisions from temporary code organization. Use existing Contracts as sources of interface truth; don't duplicate their schemas inline.
