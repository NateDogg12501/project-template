# STANDARDS.md

The durable rules for every project generated from this template. Lives
here, not copied into each project, so it stays one source of truth —
every generated `CLAUDE.md` links back to this file instead of duplicating
it. Update it here; existing projects pick up the *spirit* of a change
manually (this file isn't re-applied by `copier update` — only the
templated files under `template/` are).

## Hosting

- AWS Always Free services only. If a design needs something outside the
  free tier, that's worth a `docs/decisions.md` entry in that project, not
  a silent default.
- DynamoDB's always-free allowance (25 RCU/25 WCU/25GB) is shared per AWS
  account+region **across all tables in all projects** — keep that in mind
  before a new project's datastore need pushes the account over it.
- Use the shared modules in [`terraform-modules`](../terraform-modules)
  (`lambda-web-app`, `dynamodb-single-table`) rather than hand-writing
  Lambda/DynamoDB resources again — see that repo's README for the
  gotchas already solved there (Function URL permissions, provider version,
  GSI key_schema bug).

## Structure

- Clean FE/BE separation — `backend/` and `frontend/` are independently
  runnable and testable; no backend logic imported into frontend code or
  vice versa.
- `docker compose up -d --build` is always the one true "run this locally"
  command — no undocumented manual setup steps.

## Documentation

- `README.md`: what it is, how to run it locally, how (and whether) it's
  deployed.
- `CLAUDE.md`: filled in from this template's skeleton — What this is /
  Commands / Architecture invariants / Testing conventions / Gotchas /
  Things intentionally left simple / Extending this.
- `docs/decisions.md`: one entry per hard-to-reverse decision, logged when
  it's made, not reconstructed later. Every generated `CLAUDE.md` includes
  a standing instruction to do this proactively each session.

## Testing (once adopted per-project)

- One test runner across the stack (vitest, matching CalculatorExample) —
  not jest-here-vitest-there.
- The server re-validates whatever the client already validated — server
  is the trust boundary, client-side checks are convenience only.

## Pre-merge

- `.github/PULL_REQUEST_TEMPLATE.md` (the Definition of Done checklist) is
  in every generated repo already.
- `/code-review` and `/security-review` are the standard manual gate before
  opening a PR, until/unless a project wires the automated
  `anthropics/claude-code-action` / `claude-code-security-review` GitHub
  Actions instead (see the `.github/claude-review.yml.example` stub in each
  generated repo).

## Flavors

Flavors are defined in two places, together — never just one:
1. The `flavor` question in this repo's `copier.yml`.
2. Actual conditionals in `template/` content (`{% if flavor == "..." %}`
   blocks, and/or whole files removed by `_tasks` for flavors that don't
   need them).

### `core`
Everything above. Nothing else. Used for anything that isn't explicitly a
demo or a personal project.

### `demo`
Adds the mock/real toggle convention (see `docs/mock-vs-real.md` in a
generated `demo`-flavor project) — the point of a demo project is
contrasting a mocked dependency against the real thing, MokapiExample-style,
not just building the thing. Concretely: every external integration gets a
Source switch in the UI and a normalization layer in the backend so both
paths render identically to the frontend.

### `personal`
**Not yet defined.** A placeholder in `copier.yml` today (choosing it
changes nothing beyond the flavor name recorded in `CLAUDE.md`). Fill this
in once there's a real personal project to generalize from, the same way
`demo` was generalized from MokapiExample rather than designed in the
abstract — don't guess at "personal project conventions" ahead of having
one.
