# Format, identity, and relation conventions

These conventions mirror the Specbook artifact model used in the previous Plugumi Specbook implementation. They are **the starting format for the new rewrite**, not proof that a validator is currently installed. If the new project explicitly adopts a different contract, update this reference and the templates together before writing artifacts.

## Directories and filenames

```
docs/
├── goals/          # type: goal
├── requirements/   # type: requirement
├── architecture/   # type: architecture
├── designs/        # type: design
├── decisions/      # type: decision
├── contracts/      # type: contract
├── verification/   # type: verification
└── guides/         # type: guide
```

Each file is `docs/<folder>/<five-digit-global-ID>-<kebab-case-slug>.md`, e.g. `docs/designs/00007-tool-execution.md`. IDs are **globally unique across all eight directories** and are derived from filenames, not saved inside YAML. When creating a file, scan existing IDs and use max + 1; do not recycle deprecated IDs.

## Frontmatter

```yaml
---
type: design
title: Tool execution
description: What the design governs
status: draft
relations:
  addresses:
    - '00002'
---
```

Required keys: `type`, `title`, `description`, `status`. `status` is `draft | accepted | deprecated`. Optional keys: `tags`, `sources`, `subtype`, `relations`, and `perspective` (**only for design and architecture**). Recommended: quote five-digit IDs to keep leading zeros. The headings in document bodies are suggestions, not schema requirements.

`status: accepted` requires explicit agreement; implementing something or drafting a document does not automatically make it accepted. `deprecated` artifacts remain as history, with replacements linked via `supersedes` on the newer artifact when appropriate.

Do **not** persist `id`, `path`, `slug`, `updated_at`, `incoming`, `children`, or `siblings` in frontmatter. Reverse links are derived. Keep all outgoing links inside `relations`.

## Relations

| Relation | Source types | Target types | Requirement |
|---|---|---|---|
| `parent` | All except `decision` | Same type | Optional; cannot form cycles |
| `supersedes` | All | Same type | Optional; cannot form cycles |
| `depends_on` | All | Any artifact | Optional; cycles are warnings |
| `related_to` | All | Any artifact | Optional; reciprocal display is derived |
| `contributes_to` | `requirement` | `goal` | Optional |
| `addresses` | `design`; `architecture` | `requirement` | **Required nonempty for design**; optional for architecture |
| `applies_to` | `decision` | Any artifact | Optional |
| `verifies` | `verification` | `requirement`, `design`, `architecture`, `contract` | **Required nonempty for verification** |
| `documents` | `guide` | Any artifact | Optional |

Save only outgoing relations, not their reverse. Check target IDs exist and match type requirements. Avoid duplicate targets and self-references. Keep mandatory relations even when revising a draft. For an artifact whose prerequisites are unknown, do not invent an ID: create the prerequisite, or explicitly report that the new artifact cannot yet be valid.

## `sources` and contract files

`sources` are repository-root-relative **existing source paths** (not absolute paths, not arbitrary URLs). Omit until actual implementation exists. `contract` documents may point to OpenAPI, JSON Schema, `.proto`, and other real files in the repository and explain their versioning/semantics; do not pretend these files exist.

## Manual review checklist

1. Every `NNNNN-*.md` has one unique ID across the eight folders.
2. Folder, `type` and filename agree; `title`, `description`, `status` exist.
3. No persisted computed fields; no invented `sources`.
4. All outgoing relation IDs exist, use quoted five-digit strings, and have allowed types.
5. Every design has `addresses` ≥ 1 requirement; every verification has `verifies` ≥ 1 allowed target.
6. No `parent` or `supersedes` cycle; flag `depends_on` cycle.
7. Sections describe one coherent subject and distinguish agreed facts from open questions.
8. Any change in one artifact is reconciled against dependent contracts, designs, tests, and guides.

A **manual review** is not equivalent to a successful `validation/repository` run. Do not claim engine-verified compatibility without running a matching current validator.
