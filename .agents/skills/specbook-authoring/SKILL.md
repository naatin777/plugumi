---
name: specbook-authoring
description: Create, edit, organize, and manually review Plugumi's Specbook-style Markdown/YAML documents under docs/goals, requirements, architecture, designs, decisions, contracts, verification, and guides. Use for design planning, feature requirements, protocol decisions, documentation refactoring, or checking relations and frontmatter. Do not use the old Plugumi implementation as a default specification.
---

# Specbook authoring (manual workflow)

Manage the new Plugumi's design documents as **Markdown + YAML frontmatter**, without requiring a running Specbook Plugin. The documents are the source of truth; a future Specbook implementation may read them.

## First: determine the artifact type

Consult the relevant reference for the user's task. Read only the relevant type's reference plus [conventions](references/conventions.md); load additional types when creating cross-document relations.

| Type | Directory | Question answered | Reference |
|---|---|---|---|
| `goal` | `docs/goals/` | Why does the product exist, and what outcome matters? | [goal](references/goal.md) |
| `requirement` | `docs/requirements/` | What must be true? | [requirement](references/requirement.md) |
| `architecture` | `docs/architecture/` | What are the system-wide boundaries and relationships? | [architecture](references/architecture.md) |
| `design` | `docs/designs/` | How will a specific requirement be satisfied? | [design](references/design.md) |
| `decision` | `docs/decisions/` | Which choice was made, and why? | [decision](references/decision.md) |
| `contract` | `docs/contracts/` | What externally observable interface or format is agreed? | [contract](references/contract.md) |
| `verification` | `docs/verification/` | How can conformance be checked? | [verification](references/verification.md) |
| `guide` | `docs/guides/` | How does someone use or develop the system? | [guide](references/guide.md) |

Do not confuse `docs/designs/` (plural, artifact type) with the legacy `docs/design/` directory. Do not create legacy `docs/adr/` as the current decision directory.

## Workflow

1. **Establish context.** Inspect the current repository and existing `docs/` files first. Distinguish accepted requirements/decisions from drafts and deprecated documents. A former Plugumi repository, prior PoC, and historic discussions are inputs for consideration—not binding specifications for this rewrite.
2. **Choose a type and scope.** Select one primary artifact per distinct concern. Prefer small, independently reviewable requirements and designs; do not split merely to increase document count.
3. **Find relationships before writing.** Search for target IDs and the current source of truth. A design must address an existing requirement; a verification must verify an existing supported target. Create those prerequisites first if necessary. Never invent relation IDs.
4. **Allocate file name.** Scan all eight type folders for `NNNNN-*.md`, choose the next globally unique five-digit ID (max + 1), and use a stable kebab-case slug. ID is derived from the filename, not YAML. Never renumber old IDs just to tidy them.
5. **Create or update.** Start from `templates/<type>.md` and replace placeholders. Retain only meaningful sections. Fill `type`, `title`, `description`, `status`, and any relations needed by the type. Use `draft` unless an explicit acceptance decision exists. Edit the existing artifact rather than creating a second source of truth.
6. **Manually review.** Check the filename/folder/type match; IDs, target types and cycles; required fields; references and `sources`; semantic accuracy; and whether related documents need updates. See [conventions](references/conventions.md).
7. **Report what changed.** List created/modified paths, affected relations, unresolved questions, and any checks **not** run. Do not claim validation by the Specbook Plugin if it wasn't run.

## Do not do these things

- Do not automatically port old documents, old API contracts, or old package boundaries.
- Do not treat an unaccepted proposal or a deprecated artifact as the current contract.
- Do not invent implementation status, measurements, acceptance, source files, relation IDs, or validation results.
- Do not copy incoming/children/siblings/`id`/`updated_at` into YAML; incoming links are derived from outgoing relations.
- Do not create a second document repeating an existing canonical decision, contract, or rule; link to its ID instead.
- Do not create a fake source file just to make `sources` nonempty; omit `sources` until source exists.
- Do not require the Specbook Plugin or custom scripts for ordinary editing. This is a manual-first skill.

## Cross-type authoring sequence

For a new capability, the common sequence is:

`goal` (if product outcome is new) → `requirement` → `architecture` (if system boundaries change) → `decision` (when a significant choice is made) → `design` → `contract` (when an interface must be specified) → `verification` → `guide` (when usage/development instructions are needed).

This is **guidance, not a mandatory full set** for every change. A decision may precede a design, and an interface can be modeled as a contract without inventing a separate design document. Prefer correctness over completing the tree.
