# CODING_STANDARDS.md

Authoritative coding rules for this repo. Agents read this before writing code.

## 1. Toolchain

- Runtime **Bun**, language **TypeScript** (`strict`, ESM `"type": "module"`).
- Lint **oxlint**, format **oxfmt**. Pinned configs live in-repo; CI enforces both.
- Run checks before long tests: `oxlint` → `oxfmt --check` → `bun test`. Shorten the failure loop.

## 2. Tests

- Tests live beside the extension: `src/<extension-name>/tests/<file>.test.ts` (`bun test` discovers recursively from root).
- One test file per unit under test (`predictor.test.ts`, `extension.test.ts`); handler wiring gets its own `extension.test.ts` with a fake `pi` object.
- Failing behaviour first: reproduce (red), fix, keep as regression only if a plausible bug would fail it. No plumbing/mirror assertions.

## 3. Monadic style (simple, readable)

- Model fallible operations as values, not control flow: `Result<T, E>` / `Option<T`. **Never throw across a module boundary** — return the error as data.
- No `null`/`undefined` leaks: absent values are `Option`, decided at the boundary (parse/validate once, then total functions inside).
- Prefer flat chains (`map`/`flatMap`/`andThen`) over nested `if`/`try`. One level of branching per function; extract the rest.
- Small pure functions, explicit return types on every export. Name the effect, not the mechanism (`loadSession` over `getData`).
- Parse and validate at boundaries (CLI args, file reads, tool inputs); internal flow uses typed contracts.

## 4. Extension design rules

- **Smallest surface first**: CLI → script → skill → slash command → agent tool → extension integration. A permanent tool must earn its per-turn model cost through repeated natural use. Rare workflows stay commands/scripts.
- **User surface ≠ agent surface**: users get commands/UI; agents get tools/CLIs. Don't mirror them by default.
- **Narrow prompt metadata**: `promptSnippet` one capability fragment, no cosmetic punctuation; `promptGuidelines` only non-obvious selection/sequencing/safety, name the tool in every line. Never repeat schema facts.
- **Return the correct state**: throw when execution fails (never error-shaped success); partial mutation fails the call while stating what succeeded, what failed, and what to reread; `content` carries the next continuation facts (path, handle, state); `details` never hides recovery info.
- **Schemas**: `typebox` 1.x. No obsolete aliases in the schema; `prepareArguments()` normalisation only with live model-call justification.
- **Test in isolation** before touching the live setup (disposable `PI_CODING_AGENT_DIR`); measure first-turn overhead with/without, same model and prompt. Optimise task success before token count.
