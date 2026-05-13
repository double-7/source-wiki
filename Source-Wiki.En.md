# Source Wiki

A pattern for building structured code knowledge bases using LLMs.

This is an idea file. Copy it to your LLM Agent (Claude Code, Codex, Cursor, etc.) and let it build out the specifics with you. Its goal is to communicate the core pattern — your agent will instantiate a version that fits your project.

## The core idea

Most code comprehension tools work like search: you ask a question, the tool retrieves relevant files, and you piece together the answer yourself. IDE search, grep, even AI chat-over-code — all retrieval. The knowledge is re-derived on every question. Nothing accumulates.

The idea here is different. The LLM incrementally builds and maintains a **structured wiki** that sits between you and the source code. Not a flat collection of summaries — a layered, interlinked knowledge base with typed pages, explicit relationships, and accumulated design decisions. When source code changes, the LLM detects the change, traces its impact across the wiki, and updates affected pages. When you ask a question, the LLM queries the wiki first, falls back to source code only when needed.

Code is different from general knowledge in three ways that make this pattern especially powerful:

- **Structure is discoverable.** Exports, imports, types, tests — the code reveals its own architecture. The LLM reads signatures and relationships, not just text.
- **Truth is verifiable.** Source code is always authoritative. When the wiki contradicts the code, the code wins. This makes errors detectable and correctable.
- **Change is trackable.** Git gives precise change detection — the LLM knows exactly what changed and can trace ripple effects through the wiki.

The wiki is a **compiled view** of the codebase. You read the wiki instead of navigating code. The LLM writes and maintains it.

## The knowledge model

Pages are organized in a four-level hierarchy. Each level describes a different granularity, from concrete to abstract:

```
architecture  ← system-level patterns induced from lower layers
    ↑
flow          ← how capabilities collaborate to achieve a business goal
    ↑
module        ← implementation-level grouping (technical, not just business)
    ↑
feature       ← smallest capability unit with a clear purpose
```

Each page type lives in its own directory (`features/`, `modules/`, `flows/`, `architectures/`). The type is determined by location, not metadata.

**Features** map to source files. A feature page records which source files implement it, what it does, and what design constraints it follows.

**Modules** group related features. A module is a many-to-many combination — features can belong to multiple modules. Modules are not limited to business domains; they can be infrastructure, cross-cutting concerns, or shared utilities.

**Flows** describe how features and modules collaborate. A flow captures a business process: which capabilities participate, in what order, and why.

**Architecture** pages are induced from the lower layers — system-level patterns, API documentation, deployment topology, coding conventions. They don't repeat feature or module details; they synthesize.

Every page has YAML frontmatter with structured metadata: title, timestamps, tags, relationships (cross-references as `[[type/page-name]]` wikilinks), guidelines, and issues. This frontmatter is machine-readable — the LLM can query it programmatically, which enables structured navigation without full-text search.

## Operations

**Init.** Full analysis from scratch. The LLM scans source code structure (directories, exports, types, test names — signatures only, not implementations), proposes module boundaries, and asks you to confirm. Then it processes each module: reads relevant source, creates feature and module pages with proper metadata. After all modules are done, it infers cross-module flows and architecture pages — again with your confirmation. The result is a complete wiki skeleton. The goal is ~70% accuracy — structure correct, details can be wrong. You fix the details; the LLM fixes the structure.

**Ingest.** Incremental sync after source code changes. The LLM uses `git diff` to detect exactly which files changed, queries the wiki to find affected pages (features whose `source` field includes the changed file), traces indirect impacts (modules containing those features, flows involving those modules), and updates each page. New files may trigger new feature pages; deleted files may obsolete features. Every change is logged. This is fast and precise — no re-scanning the entire codebase.

**Lint.** Periodic health check across four dimensions:
- *Freshness*: do the source file paths in feature pages still exist?
- *Coverage*: are there orphan pages? Unlinked concepts? Source files not covered by any feature?
- *Integrity*: is every page's frontmatter complete and well-formed?
- *Consistency*: do pages agree with each other? Does the wiki agree with the source code?

Lint is read-only — it reports findings and suggests fixes, but only applies safe, mechanical fixes automatically. Content changes require your confirmation. Structural changes are just reported for you to decide.

**Query.** Ask questions against the wiki. The LLM searches relevant pages, reads them, and synthesizes an answer. If the wiki is insufficient, it follows `source` references back to the actual code. The key insight: **good answers can become new wiki pages.** A cross-module analysis, a discovered pattern, an architectural insight — these are valuable and shouldn't disappear into chat history. The LLM suggests filing them; you approve.

## Guidelines

This is the feature that makes the wiki compound over time.

Guidelines are short, one-line design decisions extracted from source code and stored in page frontmatter. Examples: "All entities have createdAt/updatedAt fields", "Authentication uses OAuth2 with token rotation", "Event-driven communication between order and inventory modules".

They serve as **guardrails**. When the LLM modifies any wiki page, it reads that page's guidelines first and follows them. This means:

- During **init**, guidelines are extracted from code patterns and user confirmation.
- During **ingest**, code changes that reveal new design decisions produce new guidelines; changes that invalidate old ones trigger updates.
- During **lint**, recurring issues across pages are recognized as missing guidelines and suggested for addition.

Guidelines create a feedback loop. The wiki gets better at representing the project's actual architecture because every operation both consumes and produces them. Over time, the guidelines become the closest thing the project has to an explicitly stated architecture decision record — except they're distributed across the pages where they matter, not locked in a separate document nobody reads.

## Index and log

Two special files help navigate the wiki:

**index.md** is a content catalog — every page listed with a link and one-line summary. Organized by type. Updated after every operation. The LLM reads it first to find relevant pages before drilling in. Works well at moderate scale (hundreds of pages).

**log.md** is an append-only timeline of what happened and when — inits, ingests, lint passes. Each entry starts with a parseable date prefix. The log also serves as a git diff anchor: the LLM finds the last log entry's commit hash to determine what changed since the last sync.

## Why this works

The tedious part of understanding a codebase is not the reading — it's the bookkeeping. Maintaining cross-references, keeping descriptions current, noticing when a change in one module affects documentation in three others. Code wikis die for the same reason general wikis die: maintenance burden grows faster than value.

Source code wikis have an advantage over general knowledge wikis: the source of truth is machine-readable and version-controlled. The LLM can verify claims against code, detect exactly what changed, and trace impact through structured metadata. It can touch 15 pages in one pass and be confident about which ones need updating and which don't.

The human's job: review module boundaries, approve flows and guidelines, fix details the LLM got wrong, and think about what it all means. The LLM's job: everything else.

The design prioritizes three things, in order:
- **Structural correctness over content accuracy.** A wiki with the right modules and features but imperfect descriptions is far more useful than one with perfect descriptions but missing modules. Details are easy for humans to fix; structure is not.
- **Correctability over self-consistency.** The wiki should be easy for humans to scan, locate, and modify. Don't optimize for the LLM's convenience — optimize for the human reviewer.
- **Incremental improvement over one-shot perfection.** Init gives you a skeleton. Ingest keeps it current. Lint finds problems. Query fills gaps. Each cycle makes the wiki better.

## Note

This document describes the pattern, not a specific implementation. The exact page types, frontmatter fields, query tools, and operation details will depend on your codebase, your LLM, and your preferences. The knowledge model (feature/module/flow/architecture) is a reasonable default for most projects, but you might need different layers — microservices might want service and endpoint layers; monorepos might want package and workspace layers. The four operations (init/ingest/lint/query) cover the lifecycle, but you might add operations like migrate (for schema evolution) or export (for generating API docs). The right way to use this is to share it with your LLM agent and build the specifics together.
