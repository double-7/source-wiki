export const meta = {
  name: 'iterative-quality-loop',
  description: '4-step iterative loop: Adversarial Verify → First-Principles Refactor → Property-Based Verify → Loop until clean',
  phases: [
    { title: 'Adversarial Verify', detail: '3 parallel agents: schema-skill, code-schema, design-impl' },
    { title: 'Refactor', detail: 'fix confirmed issues + git commit' },
    { title: 'Property Verify', detail: 'verify fixes and check for regressions' },
  ]
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique ID like R1-F1, R1-F2' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          description: { type: 'string' },
          evidence: { type: 'string' },
          fixSuggestion: { type: 'string' }
        },
        required: ['id', 'severity', 'file', 'description', 'fixSuggestion']
      }
    },
    summary: { type: 'string' }
  },
  required: ['findings', 'summary']
}

const FIX_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    fixesApplied: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          findingId: { type: 'string' },
          filesChanged: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' }
        },
        required: ['findingId', 'filesChanged', 'description']
      }
    },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          findingId: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['findingId', 'reason']
      }
    },
    summary: { type: 'string' }
  },
  required: ['fixesApplied', 'skipped', 'summary']
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    newIssues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string' }
        }
      }
    },
    summary: { type: 'string' }
  },
  required: ['passed', 'newIssues', 'summary']
}

const MAX_ROUNDS = 3
let round = 0
let totalFixed = 0

while (round < MAX_ROUNDS) {
  round++
  log(`=== Round ${round}/${MAX_ROUNDS} ===`)

  // ════════════════════════════════════════════
  // PHASE 1: ADVERSARIAL VERIFY (3 parallel)
  // ════════════════════════════════════════════
  phase(`R${round} Adversarial Verify`)

  const verifyPrompts = [
    {
      name: 'schema-skill',
      prompt: `You are an adversarial reviewer for the "source-wiki" Claude Code plugin. Your SOLE JOB is to find REAL, ACTIONABLE problems. No sugar-coating.

PROJECT CONTEXT:
- schemas/wiki-schema.md defines the WHAT (knowledge model, page specs, shared rules, frontmatter fields, link formats)
- skills/init/SKILL.md, skills/ingest/SKILL.md, skills/lint/SKILL.md, skills/query/SKILL.md define the HOW (execution flows, state files, commands)
- templates/*.md define 8 page templates (index, overview, module, feature, flow, api, conventions, deployment)
- docs/design.local.md records WHY (decisions, architecture rationale)

YOUR DIMENSION: Schema-Skill-Template Consistency

Read ALL these files and check for:

1. FIELD MISMATCHES: Compare wiki-schema.md §2.3 (common fields) and §2.5 (type-specific fields) against:
   - What each SKILL.md says it reads/writes in frontmatter
   - What templates have in their frontmatter stubs
   - Are there fields in templates that wiki-schema doesn't define? Or required fields missing from templates?

2. FLOW-RULE CONFLICTS: Do SKILL.md execution steps violate wiki-schema.md rules?
   - Does any SKILL.md allow creating pages without required frontmatter?
   - Does any SKILL.md skip the modification protocol (§3.4)?
   - Does any SKILL.md violate the fix boundary rules (§3.5)?

3. CROSS-SKILL AGREEMENT: Do the 4 SKILL.md files agree on:
   - Frontmatter field names and formats (e.g., ISO 8601, [[dir/name]] links)?
   - Log format (§3.6)?
   - Temporary file patterns (wiki.*.json)?
   - State management (create → use → delete lifecycle)?

4. TEMPLATE COMPLETENESS: Does each template have EXACTLY the fields wiki-schema.md requires for its page type? No extra fields, no missing fields?

5. INTERNAL CONSISTENCY within each SKILL.md: Are there self-contradictory instructions? Steps that can't execute as written?

For each finding, output: id (R${round}-F1, R${round}-F2...), severity (critical/high/medium/low), file, description, evidence (exact quote), fixSuggestion.
Only report issues that would cause INCORRECT BEHAVIOR when the plugin runs. Style preferences are not findings.`
    },
    {
      name: 'code-schema',
      prompt: `You are an adversarial reviewer for the "source-wiki" Claude Code plugin. Your SOLE JOB is to find REAL, ACTIONABLE problems.

PROJECT CONTEXT:
- schemas/wiki-schema.md defines validation rules, field formats, page types
- hooks/wiki-hook.js enforces frontmatter and temp-file validation
- scripts/query-wiki.js provides structured frontmatter queries
- The 4 SKILL.md files invoke query-wiki.js with specific flags and patterns

YOUR DIMENSION: Code-Schema Alignment

Read ALL these files and check for:

1. HOOK VALIDATION GAPS: Compare wiki-hook.js validation against wiki-schema.md definitions:
   - Does the hook validate EVERY field that wiki-schema.md marks as required?
   - Does the hook miss any format constraint? (e.g., ISO 8601 seconds precision, [[dir/name]] link format)
   - Does the hook over-validate? (rejecting valid content)
   - Does the hook correctly distinguish required vs optional fields for each page type?

2. QUERY SCRIPT GAPS: For each query-wiki.js invocation found in any SKILL.md:
   - Does the invocation use flags that actually exist in query-wiki.js?
   - Does the invocation match the documented behavior?
   - Are there SKILL.md query patterns that query-wiki.js can't support?

3. EDGE CASES in code:
   - What happens when wiki-hook.js encounters non-standard YAML? (multiline values, nested objects, quoted strings)
   - What happens when query-wiki.js encounters pages with no frontmatter? With corrupt YAML?
   - Does wiki-hook.js handle Windows paths correctly? (backslash vs forward slash)

4. TEMP FILE SCHEMA ALIGNMENT: Each SKILL.md defines its own wiki.*.json schema inline. Does wiki-hook.js validate these schemas correctly? Compare hook's validateInit/validateIngest/validateLint against the schemas defined in each SKILL.md.

For each finding, output: id, severity, file, description, evidence, fixSuggestion.
Only report issues that would cause INCORRECT BEHAVIOR. Theoretical concerns without concrete impact are not findings.`
    },
    {
      name: 'design-impl',
      prompt: `You are an adversarial reviewer for the "source-wiki" Claude Code plugin. Your SOLE JOB is to find REAL, ACTIONABLE problems.

PROJECT CONTEXT:
- docs/design.local.md records 34 key decisions (§8), core principles (§1.2), architecture (§7), and component responsibilities
- The implementation spans: schemas/, skills/, hooks/, scripts/, templates/, .claude-plugin/plugin.json

YOUR DIMENSION: Design-Implementation Alignment

Read design.local.md FULLY, then check ALL implementation files for:

1. UNREALIZED DECISIONS: For each decision in §8 (there are 34), verify it is actually implemented:
   - Decision #1 (no wiki.json, temp files + page-as-truth) → implemented?
   - Decision #4 (no type field in frontmatter) → do templates still have type fields?
   - Decision #11 (3 recovery options) → do all SKILL.md files offer exactly 3 options?
   - Decision #19 (schemas inline in SKILL.md) → are temp file schemas in SKILL.md, not in wiki-schema.md?
   - Decision #34 (unified diff strategy) → does ingest use git diff <hash> correctly?
   Check EVERY decision, not just the examples above.

2. PRINCIPLE VIOLATIONS: The 4 principles from §1.2:
   - "页面即真相" (page as truth): Any SKILL.md step that creates derived state not recoverable from pages?
   - "结构 > 完美" (structure > perfection): Any SKILL.md that tries to achieve 100% accuracy at the cost of structure?
   - "可校正 > 自洽" (correctable > self-consistent): Any SKILL.md that auto-resolves conflicts instead of flagging them?
   - "确定性 > 推理" (deterministic > reasoning): Any place where hook/script does reasoning instead of fixed rules?

3. ARCHITECTURE DRIFT: Compare design.local.md §7.2 (component responsibilities) with actual files:
   - Does wiki-schema.md contain HOW content that should be in SKILL.md?
   - Does any SKILL.md contain WHAT content that should be in wiki-schema.md?
   - Are there undocumented files or components?

4. MISSING PRODUCT FEATURES: design.local.md §2 defines 4 commands with specific capabilities:
   - init: 3 modes (覆盖/参考/重定向 ingest) — all 3 implemented?
   - ingest: intent parameters, --auto mode, guideline extraction — all implemented?
   - lint: 4 dimensions, guideline extraction, instruct mode — all implemented?
   - query: structured search, contradiction detection, sedimentation control — all implemented?

For each finding, output: id, severity, file, description, evidence (quote the design doc AND show the implementation gap), fixSuggestion.
Only report gaps that affect plugin correctness or usability. Cosmetic differences are not findings.`
    }
  ]

  const vResults = await parallel(verifyPrompts.map(d => () =>
    agent(d.prompt, {
      label: `verify:${d.name}`,
      phase: `R${round} Adversarial Verify`,
      schema: FINDINGS_SCHEMA
    })
  ))

  const allFindings = vResults.filter(Boolean).flatMap(r => r.findings || [])
  if (allFindings.length === 0) {
    log(`Round ${round}: Zero findings. Codebase is CLEAN.`)
    break
  }

  // Deduplicate findings by description similarity
  const seen = new Set()
  const unique = allFindings.filter(f => {
    const key = `${f.file}:${f.description.slice(0, 80)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const actionable = unique.filter(f => f.severity !== 'low')
  log(`Round ${round}: ${unique.length} unique findings (${actionable.length} actionable, ${unique.length - actionable.length} low-priority)`)

  // Log finding summaries
  for (const f of unique) {
    log(`  [${f.severity}] ${f.file}: ${f.description.slice(0, 100)}`)
  }

  // ════════════════════════════════════════════
  // PHASE 2: FIRST-PRINCIPLES REFACTOR
  // ════════════════════════════════════════════
  phase(`R${round} Refactor`)

  // Group actionable findings by file for efficient fixing
  const byFile = {}
  for (const f of actionable) {
    const key = f.file
    if (!byFile[key]) byFile[key] = []
    byFile[key].push(f)
  }

  // Create fix groups (max 3 parallel agents)
  const fixGroups = []
  const fileGroups = Object.entries(byFile)
  for (let i = 0; i < fileGroups.length; i += 3) {
    fixGroups.push(fileGroups.slice(i, i + 3).flatMap(([_, fs]) => fs))
  }

  let allFixResults = []
  for (const group of fixGroups) {
    // Split group into individual fix tasks
    const fixTasks = group.map(f => () =>
      agent(`You are fixing issue ${f.id} in the source-wiki Claude Code plugin.

ISSUE: ${f.description}
SEVERITY: ${f.severity}
FILE: ${f.file}
EVIDENCE: ${f.evidence || 'See description'}
SUGGESTED FIX: ${f.fixSuggestion}

FIRST-PRINCIPLES APPROACH:
1. Ask: "What is the fundamental purpose of this code/rule?" Strip away historical accumulation.
2. Based on the CURRENT constraints (wiki-schema.md rules, design.local.md decisions), derive the MINIMAL correct implementation.
3. Do NOT add features, abstractions, or error handling beyond what's needed.
4. Use Edit tool for existing files (not Write). Make the smallest possible change.

STEPS:
1. Read the affected file to understand current state
2. Read schemas/wiki-schema.md if the issue involves schema rules
3. Read docs/design.local.md if the issue involves design decisions
4. Read any other files that need to change for consistency
5. Apply the minimal fix
6. Verify no other files break by reading related files after your change

Return what you fixed and what you skipped.`,
        {
          label: `fix:${f.id}`,
          phase: `R${round} Refactor`,
          schema: FIX_RESULT_SCHEMA
        }
      )
    )

    // Run up to 3 fixes in parallel
    const results = await parallel(fixTasks)
    allFixResults.push(...results.filter(Boolean))
  }

  const allFixesApplied = allFixResults.flatMap(r => r.fixesApplied || [])
  const allSkipped = allFixResults.flatMap(r => r.skipped || [])
  const changedFiles = [...new Set(allFixesApplied.flatMap(f => f.filesChanged || []))]

  totalFixed += allFixesApplied.length
  log(`Round ${round} fixes: ${allFixesApplied.length} applied, ${allSkipped.length} skipped, ${changedFiles.length} files changed`)

  for (const s of allSkipped) {
    log(`  SKIPPED ${s.findingId}: ${s.reason}`)
  }

  // Git commit after refactoring
  if (changedFiles.length > 0) {
    await agent(
      `Run these git commands in order:
1. git add -A
2. git commit with message: "refactor: round ${round} adversarial review - ${allFixesApplied.length} issues fixed"
IMPORTANT: Do NOT add any Co-Authored-By line to the commit message.
After committing, run git status to verify clean working tree.`,
      { label: `commit:r${round}-refactor`, phase: `R${round} Refactor` }
    )
    log(`Round ${round}: Refactoring committed`)
  }

  // ════════════════════════════════════════════
  // PHASE 3: PROPERTY-BASED VERIFICATION
  // ════════════════════════════════════════════
  phase(`R${round} Property Verify`)

  const verifyDimensions = [
    {
      name: 'schema-skill',
      prompt: `Property-based verification of the source-wiki plugin after refactoring.

DIMENSION: Schema-Skill-Template Consistency

Verify these PROPERTIES hold after the recent changes:

P1 (Template Completeness): For each page type in wiki-schema.md §2.5, the corresponding template in templates/ has EXACTLY the required frontmatter fields — no missing, no extra.

P2 (Hook-Schema Parity): Every required field in wiki-schema.md §2.3-2.5 has a corresponding validation in wiki-hook.js FM_REQUIRED or validation logic.

P3 (Query Coverage): Every query-wiki.js invocation pattern found in SKILL.md files is supported by the actual query-wiki.js implementation.

P4 (Cross-Skill Consistency): The 4 SKILL.md files agree on: frontmatter field names, timestamp format, link format, log entry format, temp file naming.

P5 (Flow Correctness): Each SKILL.md execution flow is internally consistent — no step references a field or file that doesn't exist in its own schema.

Read all relevant files and check each property. Report ONLY actual violations, not theoretical concerns.`
    },
    {
      name: 'code-schema',
      prompt: `Property-based verification of the source-wiki plugin after refactoring.

DIMENSION: Code-Schema Alignment

Verify these PROPERTIES hold:

P1 (Hook Validates All Required): wiki-hook.js FM_REQUIRED for each page type matches wiki-schema.md §2.5 exactly (no missing fields, no extra required fields).

P2 (Hook Format Validators): wiki-hook.js regex/format checks match wiki-schema.md format specifications (ISO 8601, [[dir/name]] links, array types).

P3 (Query Script Contract): query-wiki.js --type, --field, --contains, --equals, --not-empty, --dump all work as documented. Each SKILL.md invocation is valid.

P4 (Temp File Validation): wiki-hook.js validateInit/validateIngest/validateLint schemas match the inline schemas in the corresponding SKILL.md files.

P5 (Edge Case Handling): Code handles: empty wiki dir, pages without frontmatter, Windows paths, BOM-prefixed files.

Read all code files and verify each property. Report ONLY actual violations.`
    },
    {
      name: 'design-impl',
      prompt: `Property-based verification of the source-wiki plugin after refactoring.

DIMENSION: Design-Implementation Alignment

Verify these PROPERTIES hold:

P1 (Decision Realization): Every decision in design.local.md §8 (#1 through #34) has a corresponding implementation. No decision is stated but unimplemented.

P2 (Principle Adherence): The 4 principles from §1.2 are consistently applied — no SKILL.md violates any principle.

P3 (Architecture Match): The actual file structure matches design.local.md §7.3. Component responsibilities match §7.2.

P4 (Product Completeness): All features described in §2 (4 commands) are fully implemented in their respective SKILL.md files.

P5 (No Undocumented Features): No implementation file contains features not described in design.local.md or wiki-schema.md.

Read design.local.md and all implementation files. For each property, verify it holds or report the specific violation. Report ONLY actual gaps.`
    }
  ]

  const pResults = await parallel(verifyDimensions.map(d => () =>
    agent(d.prompt, {
      label: `pverify:${d.name}`,
      phase: `R${round} Property Verify`,
      schema: VERIFY_SCHEMA
    })
  ))

  const newIssues = pResults.filter(Boolean).flatMap(r => r.newIssues || [])
  const allPassed = pResults.filter(Boolean).every(r => r.passed)

  log(`Round ${round} verification: ${allPassed ? 'ALL PASSED' : 'ISSUES FOUND'} (${newIssues.length} new issues)`)

  if (allPassed) {
    log(`Round ${round}: All properties verified. Codebase is CLEAN.`)
    break
  }

  if (newIssues.length > 0) {
    log(`Round ${round}: ${newIssues.length} issues remain for next round:`)
    for (const i of newIssues) {
      log(`  [${i.severity}] ${i.file || 'unknown'}: ${i.description.slice(0, 100)}`)
    }
  }

  if (round === MAX_ROUNDS) {
    log(`Max rounds (${MAX_ROUNDS}) reached. ${newIssues.length} issues remain for manual review.`)
  }
}

log(`Workflow complete: ${round} rounds, ${totalFixed} total fixes applied.`)
