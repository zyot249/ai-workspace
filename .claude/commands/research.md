---
description: Document code as it exists today (facts only, file:line refs) and save a dated research doc before a spec or plan
argument-hint: <factual question, e.g. "how does scene.ts apply shared uniforms today">
---

<!--
Adapted from humanlayer/humanlayer .claude/commands/research_codebase_nt.md
(commit 99abe673498cf8bdcd5f989aebe9406a27185b3b).
Copyright (c) 2024, humanlayer Authors. Licensed under the Apache License, Version 2.0:
http://www.apache.org/licenses/LICENSE-2.0
Modified 2026-10-09: removed Linear and thoughts/ references, replaced custom agents
with built-in Explore and general-purpose agents, changed the output path to
docs/superpowers/research/, replaced hack/spec_metadata.sh with git/date commands,
removed the model pin, made GitHub permalinks optional, and added hand-off to the
superpowers brainstorming and writing-plans skills.
-->

# Research

Document and explain the code as it exists today, then save the result as a dated research doc. The doc is a factual map that a later spec or plan builds on.

## Your only job: document what IS, not what SHOULD BE

- Do not suggest improvements, refactors, optimizations, or architectural changes.
- Do not perform root-cause analysis or critique the implementation.
- Do not propose future work.
- Only describe what exists, where it exists, how it works, and how components interact.
- Apply these rules to yourself and to every subagent you start.

If the user explicitly asks for evaluation, answer that part separately in chat, not in the research doc.

## Input

The research question is: $ARGUMENTS

If `$ARGUMENTS` is empty, reply with this line and wait:

```
What should I document? Ask a factual question about the current code, for example "how does scene.ts apply shared uniforms today".
```

The question must ask how the code works today. If it states a feature goal instead ("add staggered windows"), rewrite it as one or more factual questions about the code that goal touches ("how are window cells lit in facade-material.ts today"). Show the rewritten questions to the user before you start. Keeping the goal out of the research keeps the findings neutral.

## Steps

1. **Read named files first.** If the user names files (specs, plans, source files), read each one in full in the main context, without offset or limit, before you start any subagent.

2. **Split the question.** Break it into independent research areas: components, data flows, entry points, tests. Track the areas with your task-list tool.

3. **Start subagents in parallel** with the Agent tool, in one message:
   - **Locate:** `Explore` agents find where the relevant files, symbols, and tests live.
   - **Explain:** `general-purpose` agents read the located files and describe how the code works, step by step.
   - **Patterns:** a `general-purpose` agent finds existing examples of the same pattern elsewhere in the repo, without judging them.

   End every subagent prompt with this line:

   > Document only. No recommendations, critique, or proposed changes. Return `path:line` references for every claim.

   Use web research only if the user asks for it. Ask those agents to return links, and include the links in the doc.

4. **Wait and synthesize.** Wait for every subagent to finish. Treat the live code as the source of truth; if a subagent's claim looks wrong, open the file and check it yourself. Connect findings across components. Every claim in the doc needs a `path:line` or `path:start-end` reference.

5. **Collect metadata** with Bash:

   ```bash
   date '+%Y-%m-%dT%H:%M:%S%z'
   git rev-parse HEAD
   git branch --show-current
   basename "$(git rev-parse --show-toplevel)"
   git status --short
   ```

   If the working tree has uncommitted changes in files you documented, say so in the Summary. The commit hash alone does not describe that code.

6. **Write the doc** to `"$(git rev-parse --show-toplevel)/docs/superpowers/research/YYYY-MM-DD-<topic>-research.md"`, where `<topic>` is a short kebab-case name. Resolve the repo root this way even when the session runs in a subdirectory or a worktree. Never write placeholder values. Use this structure:

   ```markdown
   ---
   date: <ISO date-time with offset>
   git_commit: <full hash>
   branch: <branch>
   repository: <repo name>
   topic: "<research question>"
   tags: [research, <component names>]
   status: complete
   last_updated: <YYYY-MM-DD>
   ---

   # Research: <topic>

   ## Research question
   <the question, plus any rewritten factual questions>

   ## Summary
   <what exists, answering the question directly>

   ## Detailed findings

   ### <Component or area>
   - <what exists> (`path/to/file.ts:123`)
   - <how it connects to other components>

   ## Code references
   - `path/to/file.ts:123` – <what is there>
   - `path/to/other.ts:45-67` – <what the block does>

   ## Architecture
   <patterns and conventions as they exist>

   ## Related specs and plans
   <links to docs/superpowers/specs/ and plans/ files that describe this code; list any statement in them that the code no longer matches, quoting the statement and the reference that contradicts it>

   ## Open questions
   <areas the research could not settle>
   ```

   GitHub permalinks are optional. Add them only if the commit is pushed (`git branch -r --contains HEAD` prints a branch). Otherwise keep plain `path:line` references.

7. **Commit the doc** on its own. Use a pathspec commit so files that are already staged stay out of it:

   ```bash
   git add -- "<doc path>"
   git commit -m "docs: research <topic>" -- "<doc path>"
   ```

8. **Report back.** Give the user a short summary, the doc path, the key file references, and any stale spec or plan statements you found. Ask whether they have follow-up questions.

## Follow-up questions

Append follow-ups to the same doc:

- Add a section `## Follow-up research <ISO date-time>`.
- Update `last_updated` and add `last_updated_note: "<what was added>"` to the frontmatter.
- Start new subagents as needed, under the same rules.
- Commit with the same pathspec form and the message `docs: update research <topic>`.

## How the doc is used next

- **New feature or change:** run the `superpowers:brainstorming` skill and cite the doc in the spec's current-state section.
- **Existing spec:** run the `superpowers:writing-plans` skill and cite the doc in the plan header next to the spec.
- **Before you execute an older plan:** compare the plan's assumptions about the current code with the doc's findings, and fix the plan before you execute it.

## Rules

- Always run fresh research. An older research doc can guide where you look, but it is never evidence of the current code.
- Keep the main context for synthesis. Let subagents do the broad file reading.
- Follow the steps in order. Read named files before step 3, wait for every subagent before step 4, and collect metadata before step 6.
