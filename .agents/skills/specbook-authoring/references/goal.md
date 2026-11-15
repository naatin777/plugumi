# Goal — product outcomes

**Location:** `docs/goals/`. **Type:** `goal`. **Required relations:** none.

Create a Goal when articulating a durable outcome or product-level success criterion. Do not use it as a list of implementation features or a roadmap of tasks.

## Recommended content

- **Outcome:** who benefits, what changes, and why it matters.
- **Scope:** what is inside/outside the outcome.
- **Success signals:** observable criteria; numbers only when known or explicitly chosen as targets.
- **Constraints / non-goals:** what the team intentionally does not pursue.
- **Open questions:** uncertainties without presenting them as settled.

Use `requirement.relations.contributes_to` to point from requirements to a Goal. A Goal does not store a generated list of children. Optional `parent` can link a subordinate Goal to another Goal.

## Review

Reject vague slogans with no observable outcome; avoid declaring success based solely on finishing an implementation. For a product rewrite, start here only if the product outcome is actually unclear or changing.
