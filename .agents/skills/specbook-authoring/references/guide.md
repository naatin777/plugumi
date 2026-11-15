# Guide — repeatable operating/development instructions

**Location:** `docs/guides/`. **Type:** `guide`. **Required relations:** none.

Use a Guide for the **how-to** that a contributor, operator, or Plugin author follows. Unlike a Design, it should be directly executable and grounded in implemented behavior.

## Recommended content

- **Audience and prerequisites:** supported environments, versions, permissions.
- **Steps and commands:** complete invocations, expected responses, cleanup.
- **Troubleshooting:** common failure cases, diagnostics, recovery.
- **Boundaries:** what is not yet supported; behavior conditional on platform.
- **Canonical links:** reference Contracts, Designs, and Requirements instead of copying them.

Use `documents` to link any artifacts whose implementation/usage the guide explains. `sources` only for actual repository files. For a fresh rewrite with no implementation yet, keep instructions clearly proposed or delay creating them.

## Review

Do not present old Plugumi commands, paths or setup as currently working. Distinguish examples from verified copy/paste commands.
