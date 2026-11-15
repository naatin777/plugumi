# Decision — explicit choice and rationale

**Location:** `docs/decisions/`. **Type:** `decision`. **Required relations:** none. **`parent` is forbidden.**

Write a Decision when a consequential choice is made (or proposed) between real alternatives. It should explain **why**, including tradeoffs, and make later reconsideration possible.

## Recommended content

- **Context and forces:** what prompted the decision.
- **Decision:** exact selected option, with `draft` until explicitly approved.
- **Alternatives considered:** realistic competitors, not straw men.
- **Rationale and tradeoffs:** benefits, costs, rejected reasons.
- **Consequences:** migration or future restrictions, risks, trigger for revisiting.

Use `applies_to` to point to the relevant Requirement, Design, Architecture, or Contract. Use `supersedes` for a newer Decision replacing a Decision of the same type, without cycles. Deprecated decisions remain readable; do not delete history as a side effect of a rewrite.

## Review

Do not treat old accepted ADRs as automatically binding in a brand-new Plugumi. Reevaluate them and record newly accepted decisions under `docs/decisions/`. Avoid copying decision reasoning into multiple designs.
