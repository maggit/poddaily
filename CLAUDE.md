# poddaily

Self-hosted, Slack-native daily standup bot + internal admin platform. Open-source
replacement for hosted SaaS standup tools, designed to run on internal infrastructure with
no per-seat cost.

See the canonical context in [`ContextDB/`](ContextDB/) — start at
[`ContextDB/00_index/project-map.md`](ContextDB/00_index/project-map.md).

## ContextDB — Project context repository

This project uses a `ContextDB/` directory (managed by ContextLoom) as a local context
repository. It is the **canonical place** for all long-lived project context.

### Folder Taxonomy

```
ContextDB/
├─ README.md          ← ContextDB overview (do not modify)
├─ 00_index/          ← Entry points, overviews, maps
├─ 01_specs/          ← Requirements, PRDs, feature specs
├─ 02_architecture/   ← System design, data flow, components
├─ 03_decisions/      ← Architecture Decision Records (ADRs), tradeoffs
├─ 04_knowledge/      ← Reusable concepts & explanations
├─ 05_prompts/        ← Reusable LLM prompts & system instructions
├─ 06_agents/         ← Agent roles, rules, memory
├─ 07_diagrams/       ← Mermaid diagrams (one per file)
├─ 08_logs/           ← Append-only logs, session summaries, changelogs
├─ 99_scratch/        ← Drafts, temporary thinking, WIP notes
└─ todos/             ← TODO lists and task tracking
```

### Routing — where to put things

| User says | Target folder |
|---|---|
| "save/update the PRD", "write a spec", "document requirements" | `01_specs/` |
| "document the architecture", "explain how X works" | `02_architecture/` |
| "record this decision", "why did we choose X", "create an ADR" | `03_decisions/` |
| "save this knowledge", "document this pattern" | `04_knowledge/` |
| "create a diagram", "draw this flow" | `07_diagrams/` |
| "save a summary", "log this session", "update context" | `08_logs/` |
| "jot this down", "scratch notes", "draft" | `99_scratch/` |
| "create a todo", "track these tasks" | `todos/` |
| "update the index", "add an overview" | `00_index/` |

### Conventions
- Plain Markdown only (`.md`), with a `# Title` heading in every file.
- Use relative links to reference other files.
- Prefer small, composable files. Append rather than overwrite. Do not delete without permission.
- Date-prefix files when chronology matters: `2026-06-14-decision.md`.

## Current state

Phase 1 Core is **specced, not yet implemented**. The repo currently contains only
`ContextDB/` docs. Implementation begins from
[`ContextDB/01_specs/phase-1-core-spec.md`](ContextDB/01_specs/phase-1-core-spec.md).
