# Requirement — externally observable need

**Location:** `docs/requirements/`. **Type:** `requirement`. **Required relations:** none.

Define **what must be satisfied**, not the code structure that happens to satisfy it. Prefer one coherent, testable capability per document. Do not split artificial one-sentence micro-requirements or bundle unrelated demands.

## Recommended content

- **Context / actor:** who needs this and under what conditions.
- **Normative behavior:** precise MUST / MUST NOT / SHOULD where helpful.
- **Acceptance criteria:** concrete, falsifiable observations, including error and denial cases.
- **Constraints / non-goals:** reliability, portability, trust boundaries, or intentionally excluded behavior.
- **Open questions:** unresolved policies and tradeoffs.

`contributes_to: ['00001']` may link a requirement to a Goal; it is optional in the prior Specbook format. Use `depends_on` for prerequisite requirements and `parent` for actual same-type hierarchy, not as a substitute for `contributes_to`.

## Review

Do not require a specific framework, transport, or package structure unless it is itself a product requirement. Do not mark requirements `accepted` by assumption. A design may later `address` this requirement.
