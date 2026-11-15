# Contract — interoperable interface and data format

**Location:** `docs/contracts/`. **Type:** `contract`. **Required relations:** none.

A Contract states the **observable obligations** between independently implemented parties (e.g., Core↔Plugin, Client↔App, SDK↔Panel). It is not an implementation tutorial.

## Recommended content

- **Parties, version, and scope:** who implements which side; compatibility expectations.
- **Operations/messages:** request/response or event shape, fields and value semantics.
- **Errors and edge cases:** validation, cancellation, timeout, ordering, delivery/retry guarantees.
- **Identity and security:** caller identity, authorization scope, trust boundaries.
- **Conformance rules:** what independent implementations must pass.
- **Schema/source references:** actual OpenAPI/JSON Schema/`.proto` paths when they exist; explicitly note when planned only.

Use `related_to`, `depends_on` and (when replacing a contract) `supersedes`. If an actual schema file is the machine-readable source of truth, reference it, avoid diverging copies, and define exactly which document owns which rule.

## Review

Do not infer HTTP/gRPC/WebSocket choices from the old code; contracts are rewritten under current decisions. Do not call a proposed message format accepted without explicit agreement.
