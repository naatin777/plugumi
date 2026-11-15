# Verification — evidence and acceptance plan

**Location:** `docs/verification/`. **Type:** `verification`. **Required relation:** `verifies` must include **at least one existing Requirement, Design, Architecture, or Contract**.

A Verification artifact specifies how to determine whether an invariant, requirement, architecture, or protocol is met. It may record actual results, but plans and outcomes must be distinguished.

## Recommended content

- **Targets:** linked artifact IDs, scope, risks covered.
- **Environment / prerequisites:** runtime versions, dependencies, fixtures, credentials or isolation (without exposing secrets).
- **Test scenarios:** steps, expected outputs, negative/boundary cases.
- **Evidence:** commands, traces, screenshots, logs, dates **only after execution**.
- **Outcome:** planned / passed / failed / blocked, with limitations and reproduction details; do not silently infer success.

Example relation:

```yaml
relations:
  verifies:
    - '00002'
```

Replace example IDs with real targets of the allowed types. `status: accepted` on the document is **not** equivalent to all tests having passed. Use separate explicit result descriptions.

## Review

Verify the assertions relevant to new contracts and failure paths, not merely regressions of the old implementation. Never invent a test execution or coverage result.
