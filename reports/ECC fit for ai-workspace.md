# Keep a pruned ECC subset, skip the plugin

Do not install the `ecc@ecc` plugin. Keep a small, hand-pruned subset of the ECC files that already sit in the project's `.claude/` directory. The project is a solo, static Nuxt 4 site with 7 components, 2 pages and 6 pure-logic test files. ECC ships **68 agents, 293 skills, 94 command shims** and a hook graph ([ECC README](https://raw.githubusercontent.com/affaan-m/ECC/main/README.md)). Almost all of that has no use here. The project already holds a copy of 27 agents, 9 commands, 27 ECC-derived skills and 37 rule files, and every agent and rule file is byte-identical to upstream (local audit of `.claude/` against `~/.claude/plugins/marketplaces/ecc`). Roughly 60 percent of this copy is inert: Java, Spring, JPA, Postgres, Redis, Docker, API and dashboard material. The pieces worth keeping are narrow: `vue-reviewer`, `typescript-reviewer`, `build-error-resolver`, the `nuxt4-patterns` skill, the `/vue-review` command and about nine path-scoped rule files. Superpowers, claude-mem, the built-in `/code-review` and the Vercel plugin already cover planning, TDD, review and performance. The main risks are double loading if the plugin is later enabled, an always-on `rules/common/` set that changes agent behavior, and hooks with side effects. No source measures ECC's token cost, so all token figures here are estimates.

## The project needs four ECC items, and the rest duplicates tools it already has

The workspace is small. Its `package.json` lists Nuxt, Vue, Three.js, `@nuxt/content`, Tailwind and Vitest. It has no eslint, prettier, Playwright or `@nuxt/ui`. It deploys as a static site with no server routes (local files: `repos/portfolio/package.json`, `nuxt.config.ts`, `vercel.json`). ECC's value for such a project is limited to framework-specific review and a few Nuxt rules.

Four items have no equivalent among the tools the user already runs. These are `vue-reviewer` (Composition API and Nuxt), `typescript-reviewer`, `build-error-resolver` for `vue-tsc` failures, and `nuxt4-patterns`, which covers hydration safety and matches the recent hydration and server-render commits (`83a0b07`, `a73bdc8`). Everything else overlaps. The `planner`, `tdd-guide` and `/plan` items duplicate superpowers `brainstorming`, `writing-plans` and `test-driven-development`, plus claude-mem `make-plan` and the built-in Plan agent. `code-simplifier` duplicates `/simplify`. `performance-optimizer` duplicates `vercel:performance-optimizer`. `codebase-onboarding` and `strategic-compact` duplicate claude-mem and remember. `e2e-runner` prefers Vercel Agent Browser, which is not installed, and Playwright is not a dependency. `docs-lookup` needs Context7 tools that are not configured for this project (local audit).

ECC's own documentation points the same way. The README says rules are "always-loaded context, so begin with `common` and one pack for the stack you actually use" and recommends a selective install when context footprint matters ([ECC README](https://raw.githubusercontent.com/affaan-m/ECC/main/README.md)). Anthropic's documentation also favors a small always-on set and on-demand mechanisms for situational content ([Costs](https://code.claude.com/docs/en/costs), [Memory](https://code.claude.com/docs/en/memory)). One empirical study found that repository context files gave no significant gain or reduced task success, and raised inference cost by over 20 percent. That study covered Python tasks and AGENTS.md-style files, not ECC, so it supports trimming but does not test ECC ([arXiv 2602.11988](https://arxiv.org/pdf/2602.11988)).

## The keep and drop list

The table below consolidates the local audit. File names are exact. Sizes are bytes on disk.

| Type | Keep | Edit before keeping | Drop |
|---|---|---|---|
| Rules | `nuxt/patterns.md`, `nuxt/coding-style.md`, `vue/coding-style.md`, `vue/patterns.md`, `vue/security.md`, `typescript/coding-style.md`, `web/design-quality.md`, `web/performance.md` | `common/coding-style.md` (exempt Three.js render loops from "never mutate"), `common/git-workflow.md` (recent commits use plain imperative sentences, not `type:` prefixes), `common/security.md` (remove rate-limit and CSRF lines) | All 5 files in `java/`; `common/agents.md`, `development-workflow.md`, `testing.md`, `code-review.md`, `performance.md`, `hooks.md`, `patterns.md`; `hooks.md` and `testing.md` in `nuxt/`, `vue/`, `typescript/`, `web/`; the duplicate `.agents/rules/` |
| Agents | `vue-reviewer`, `typescript-reviewer`, `build-error-resolver` | Optional: `code-reviewer` (its description says "MUST BE USED for all code changes", which triggers it on every edit), `silent-failure-hunter` (WebGL context-loss paths) | planner, architect, code-architect, tdd-guide, harness-optimizer, loop-operator, agent-evaluator, conversation-analyzer, pr-test-analyzer, comment-analyzer, type-design-analyzer, database-reviewer, java-reviewer, java-build-resolver, docs-lookup, e2e-runner, performance-optimizer, code-simplifier, code-explorer, doc-updater |
| Commands | `vue-review` | None | `plan`, `test-coverage`, and the four hookify commands unless you want guardrail rules; `update-docs` and `security-scan` are marginal |
| ECC skills | `nuxt4-patterns` | Optional: `design-system` | api-design, backend-patterns, hexagonal-architecture, dashboard-builder, docker-patterns, security-bounty-hunter, postgres-patterns, redis-patterns, jpa-patterns, java-coding-standards, springboot-patterns, springboot-security, springboot-tdd, springboot-verification, tdd-workflow, codebase-onboarding, strategic-compact, coding-standards, e2e-testing |
| Non-ECC skills | The 10 `threejs-*` skills | Review `nuxt-ui` (`@nuxt/ui` is not a dependency, though the MCP tools exist) and `webgpu-threejs-tsl` (the project uses WebGL) | None |

Eight skills sit in a "maybe" group: security-review, security-scan, vite-patterns, error-handling, architecture-decision-records, hookify-rules, plus the optional ones above. Drop them by default. Add one back when a task needs it. The audit's target footprint is about 9 rule files, 3 to 5 agents, 1 command and 1 ECC skill.

The `common/` rules deserve the hardest cut. Five of them push heavy ceremony. `testing.md` demands 80 percent coverage and mandatory TDD, but the project has no coverage tooling. `development-workflow.md` requires `gh search` before any implementation and then planner, tdd-guide and code-reviewer agents. `agents.md` references `ecc:`-prefixed agents (`ecc:planner`, `ecc:rust-reviewer`) that do not exist locally and tells Claude to launch agents without being asked. These files change session behavior, not only token count, because they spawn subagents (local audit). Subagent use draws extra tokens ([Costs](https://code.claude.com/docs/en/costs)).

## Pruning commands

All project files in `.claude/` are untracked in git, so a deletion cannot be undone with git. Back up first. Because the copies are byte-identical to upstream, you can restore any of them from the local clone at `~/.claude/plugins/marketplaces/ecc`. The commands below are derived from the audit's lists and have not been run.

```bash
cd /Users/nguyenducdung/Desktop/Zyot/ai-workspace
cp -R .claude /tmp/claude-backup-$(date +%Y%m%d)   # or commit first

# Rules
rm -r .claude/rules/java .agents/rules
cd .claude/rules/common && rm agents.md development-workflow.md testing.md \
  code-review.md performance.md hooks.md patterns.md && cd -
rm .claude/rules/{nuxt,vue,typescript,web}/{hooks,testing}.md

# Agents (keep vue-reviewer, typescript-reviewer, build-error-resolver)
cd .claude/agents
rm planner.md architect.md code-architect.md tdd-guide.md harness-optimizer.md \
  loop-operator.md agent-evaluator.md conversation-analyzer.md pr-test-analyzer.md \
  comment-analyzer.md type-design-analyzer.md database-reviewer.md java-reviewer.md \
  java-build-resolver.md docs-lookup.md e2e-runner.md performance-optimizer.md \
  code-simplifier.md code-explorer.md doc-updater.md
cd -

# Commands (keep vue-review)
cd .claude/commands && rm plan.md test-coverage.md hookify*.md && cd -

# Skills
cd .claude/skills
rm -r api-design backend-patterns hexagonal-architecture dashboard-builder \
  docker-patterns security-bounty-hunter postgres-patterns redis-patterns \
  jpa-patterns java-coding-standards springboot-patterns springboot-security \
  springboot-tdd springboot-verification tdd-workflow codebase-onboarding \
  strategic-compact coding-standards e2e-testing
cd -
```

Verify the `common/` and `web/` file names against the directory before running `rm`, because the notes list `web/` as having 7 files but name only some. Then run `/context`, `/doctor` and `/skill-doctor` to read real numbers ([Skills](https://code.claude.com/docs/en/skills)).

If you later want a clean ECC-managed install instead of hand pruning, the upstream installer supports named skills (`./install.sh --target claude --skills tdd-workflow,security-review`), a `--dry-run --json` preview and `--no-hooks` ([ECC README](https://raw.githubusercontent.com/affaan-m/ECC/main/README.md)). The installer has no Nuxt-only profile. Even `--profile minimal` pulls in the `workflow-quality` module, which holds about 40 skill paths including tdd-workflow, e2e-testing and strategic-compact ([install-modules.json](https://github.com/affaan-m/ECC/blob/main/manifests/install-modules.json)). Selecting `lang:typescript` pulls the whole `framework-language` module ([install-components.json](https://github.com/affaan-m/ECC/blob/main/manifests/install-components.json)). Manual `cp -r` of single rule and skill directories gives the tightest control. Copy whole rule directories, not their contents, so the relative `../common/` references keep working.

## Four caveats decide how far to trust this plan

**Double loading.** The `ecc@ecc` plugin is not installed or enabled today. A marketplace entry and a 64 MB cache from 2026-10-07 exist, but `installed_plugins.json` has no entry (local audit). If you enable the plugin while keeping the project copies, you get the agents, commands and skills twice: unprefixed from the project and `ecc:`-prefixed from the plugin. Rules would not duplicate, because plugins cannot ship rules. ECC's README says "Do not stack install methods" and lists "Claude Code plugin + full Claude manual install" as something to avoid ([ECC README](https://raw.githubusercontent.com/affaan-m/ECC/main/README.md)). Pick one path. The plugin route is all-or-nothing for skills, agents and commands, and it adds metadata for 68 agents and 293 skills to every session. That is the larger surface, and it is the reason this report recommends against it. If you enable it anyway, delete the project copies first and set `hook_profile` to `minimal` or `hooks_enabled` to `false` at project scope.

**Always-on rule cost.** Rules without `paths` frontmatter load at launch with the same priority as `.claude/CLAUDE.md` ([Memory](https://code.claude.com/docs/en/memory)). Ten `common/` files plus `rules/README.md` fall in this class: about 24 KB, or roughly 6k tokens by the bytes-divided-by-four estimate. The two audits measure the `common/` set slightly differently (18.4 KB without the README, 24 KB with it), so treat the figure as approximate. Path-scoped rules cost nothing until Claude touches a matching file. Skill and agent bodies load only on use. Their descriptions stay in context: about 2.5k tokens for 39 skills and 1.3k for 27 agents. The project `.claude/` totals about 10k tokens always-on, near 5 percent of a 200k window. This static cost is modest. A second cost is that skill descriptions share a listing budget of 1 percent of the context window with plugin skills, and overflow silently drops descriptions of the least-used skills ([Skills](https://code.claude.com/docs/en/skills)). The session already lists well over 100 skills from plugins. Whether the listing overflows here is unknown.

**Hook side effects.** The plugin enables hooks by default at the `standard` profile ([plugin.json](https://raw.githubusercontent.com/affaan-m/ECC/main/.claude-plugin/plugin.json)). They span 24 matcher entries. Several run on every tool call or every response: an observer for continuous learning, two PostToolUse dispatchers, and seven Stop hooks, including a batch format and `tsc` check with a 300 s timeout. `gateguard-fact-force` blocks the first Edit or Write on each file until the agent states facts, and `config-protection` blocks edits to linter and formatter configs. The `session:start` hook injects up to 8,000 characters of context plus learned instincts. Other hooks write `~/.claude/metrics/costs.jsonl` and send desktop notifications ([hooks.metadata.json](https://raw.githubusercontent.com/affaan-m/ECC/main/hooks/hooks.metadata.json), [cost-tracker.js](https://raw.githubusercontent.com/affaan-m/ECC/main/scripts/hooks/cost-tracker.js)). The audit's grep of eight hook scripts found no outbound network code, but it did not cover the other roughly 50 scripts. The user already runs an `rtk` PreToolUse hook on Bash and a herdr SessionStart hook, and ECC's Bash dispatcher would add a second layer. No one tested the interaction with rtk or claude-mem. ECC's README says hooks should be treated as executable configuration. Hook-related flaws have been reported in Claude Code itself, so review any hook script before enabling it ([PromptArmor](https://promptarmor.substack.com/p/hijacking-claude-code-via-injected)). Hooks are not part of the recommended subset, so the project can skip them.

**Unmeasured numbers.** No source, official or third-party, measures ECC's token overhead, and no benchmark compares full against partial installs. Every token figure for the local setup is a bytes-divided-by-four estimate. Nobody ran `/context`. The context window size (200k or 1M) is unconfirmed. ECC's own claims (a window shrinking to about 70k with too many MCP tools, a 60 percent cost cut from Sonnet) are repo assertions without measurement ([ECC README](https://raw.githubusercontent.com/affaan-m/ECC/main/README.md)). Which of the 39 skills and 27 agents the user actually invoked is unknown. A third-party measurement puts bare Claude Code at about 33k tokens before the first prompt ([bestagent.dev](https://bestagent.dev/claude-code-token-overhead-2026/)). That is a single-machine, secondary figure. It shows that the base overhead is already larger than the 10k from this project's ECC copy.

## Repo health and upgrade policy

ECC is popular and active: **about 275k stars, 41k forks**, MIT license, last push 2026-10-05, and releases every few weeks ([GitHub repo API](https://api.github.com/repos/affaan-m/ECC)). Popularity is not evidence of quality, and the notes did not check for star inflation. Churn is high. Surfaces were renamed several times in 2026, the hook loading path has a history of fix and revert cycles, and open issues include a report that the installer overwrites same-name files without backup ([issue #3450](https://github.com/affaan-m/ECC/issues/3450)), unverified in code, and dated advice in `rules/common/performance.md` ([issue #3422](https://github.com/affaan-m/ECC/issues/3422)). I found no independent security audit and no complaint threads about token bloat. Because the project already holds frozen copies, the practical policy is simple. Treat the pruned files as your own. Do not auto-update them. Diff against upstream by hand before you pull any change.

## Conclusion

The question is not whether ECC is good. It is whether a static portfolio needs a 293-skill catalog, and it does not. The decisive finding is that the work of "applying ECC" is already done: the project holds an unpruned copy, and the useful action is deletion. That cut removes about 20 agents, 19 skills, 5 commands and 20-plus rule files, and it changes behavior more than it changes token count, because the dropped `common/` rules are the ones that mandate planner, tdd-guide and 80 percent coverage workflows that conflict with superpowers and with the project's actual commit and test practice.

Two checks remain before you can call the result verified. Run `/context` and `/skill-doctor` after pruning to replace the estimates with measurements, and confirm the skill listing no longer overflows its budget. If you later want ECC's hooks for formatting or console-log checks, add them one by one by ID under the `minimal` profile, after reading the scripts, instead of enabling the plugin.
