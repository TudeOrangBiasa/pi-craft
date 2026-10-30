# Issue tracker: GitHub issues

Tickets for this repo live as GitHub issues on `TudeOrangBiasa/pi-craft`. Never use local markdown in `.scratch/` for tickets (`.scratch/` holds `whips` run logs only).

## Create / read / list / comment / label via `gh`

- Create: `gh issue create --title "<title>" --body "<body>"` (add `--label <name>` as needed).
- Read: `gh issue view <N> --json title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,labels`.
- Comment: `gh issue comment <N> --body "<text>"`.
- Label: `gh issue edit <N> --add-label <name>` / `--remove-label <name>`.

## When a skill says "publish to the issue tracker"

Open a new GitHub issue with `gh issue create`. Put the spec in the issue body, not in a separate file.

## When a skill says "fetch the relevant ticket"

Read the issue with `gh issue view <N>`. The user will normally pass the issue number directly.

## Triage state

Triage state is recorded as labels on the issue (see `triage-labels.md` for the role-to-label mapping).

## Wayfinding operations

Used by `/wayfinder`. The **map** is a parent tracking issue; each **child** ticket is a GitHub sub-issue of it.

- **Map**: a tracking issue whose body holds the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a sub-issue of the map, with the question in its body.
- **Blocking**: native blocked-by dependencies between issues. A ticket is unblocked when every issue it is blocked by is closed.
- **Frontier**: among the map's open, unblocked sub-issues, first by number wins.
- **Claim**: comment on the issue that work has started before any work.
- **Resolve**: comment the answer on the issue, close it, then append a context pointer to the map's Decisions-so-far.
