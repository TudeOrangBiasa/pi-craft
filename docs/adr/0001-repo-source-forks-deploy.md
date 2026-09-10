# ADR-0001: Repo Is Source of Truth, Forks Are Deploy Targets

Status: accepted

## Context

Pi loads live config from `~/.pi/agent/` (extensions, forks, settings, prompt). That directory is machine-local, unversioned, and drifts the moment anyone hand-edits it. We needed a shareable source others can install.

## Decision

All code lives in `craft-harness/` (`extensions/`, `agents/`, `guidance/`, `prompt/`). Nothing is authored in `~/.pi/agent/`. `installer/install.ts` copies repo → live home and merges settings. After any repo edit, deploy by copy and verify with `cmp`.

## Consequences

- Live home is always reproducible from the repo; hand-edits there are forbidden and get overwritten.
- Every change costs a deploy step — accepted as the price of a single source of truth.
