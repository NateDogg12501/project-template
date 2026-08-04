# STANDARDS.md

The durable rules for every project generated from this template. Lives
here, not copied into each project, so it stays one source of truth —
every generated `CLAUDE.md` links back to this file instead of duplicating
it. Update it here; existing projects pick up the *spirit* of a change
manually (this file isn't re-applied by `copier update` — only the
templated files under `template/` are).

## How standards get added

Every standard or tool this pipeline adopts — not just the ones already
below — gets an entry in [`docs/decisions.md`](docs/decisions.md) **in this
repo**, explaining what was chosen, why, and why not the alternative. That's
separate from the *generated-project* decisions log downstream projects get
(`template/docs/decisions.md.jinja`) — this repo, being the thing every
project inherits from, holds itself to the same discipline it asks of them.
See `docs/decisions.md` for the reasoning behind Copier, this file's own
existence as a separate un-templated file, and the flavor choices below.

## Hosting

- **AWS Always Free unless logged in `docs/decisions.md` and explicitly
  confirmed.** Both halves are required. A `docs/decisions.md` entry without
  the confirmation is a note nobody acted on; a confirmation without the entry
  is a charge nobody can explain in three months.
- DynamoDB's always-free allowance (25 RCU/25 WCU/25GB) is shared per AWS
  account+region **across all tables in all projects** — keep that in mind
  before a new project's datastore need pushes the account over it. Note the
  allowance covers *provisioned* capacity only: `PAY_PER_REQUEST` (on-demand)
  is billable from the first request, at any volume.
- Anything with unbounded growth gets an explicit bound, even when it starts
  free. CloudWatch log groups are the standing example: left alone, Lambda
  auto-creates one with retention `Never Expire`, and the 5GB free tier is
  where billing *starts*, not a cap. `lambda-web-app` sets a 14-day default
  for exactly this reason.
- Use the shared modules in [`terraform-modules`](../terraform-modules)
  (`lambda-web-app`, `dynamodb-single-table`) rather than hand-writing
  Lambda/DynamoDB resources again — see that repo's README for the
  gotchas already solved there (Function URL permissions, provider version,
  GSI key_schema bug).

### Enforcement: `cost_acknowledged`

The rule above is enforced in code, not by remembering it. **Any module that
provisions billable resources takes a `cost_acknowledged` boolean (defaulting
to `false`) and a `lifecycle` precondition that fails the plan when the
configuration is billable and the flag is false.** You cannot accidentally
apply a paid resource — only deliberately.

```hcl
lifecycle {
  precondition {
    condition     = local.within_always_free || var.cost_acknowledged
    error_message = "<what is billable here, and what the free allowance is>"
  }
}
```

Four things make this work, and each is load-bearing:

- **A precondition, not a variable `validation`.** Whether a configuration is
  billable is usually a function of several inputs together (billing mode
  *and* summed capacity, say), which no single-variable validation can see.
- **It fails the plan, not the apply.** The failure lands before anything is
  created, so there is no half-provisioned state to clean up.
- **It defaults to `false`.** The safe path is the one you get by not thinking
  about it; spending takes an affirmative act.
- **The message names the cost.** "Billable" on its own sends someone to the
  AWS pricing page; naming the resource and the allowance it exceeds lets them
  decide on the spot.

`dynamodb-single-table` in [`terraform-modules`](../terraform-modules) is the
reference implementation. Setting the flag satisfies the mechanism but not the
standard — the `docs/decisions.md` entry is the other half, and no precondition
can check that you wrote it.

The gate is per-module, which bounds what it can promise: a module sees its own
numbers, not the account's. Every gate passing means no single resource
knowingly left the free tier — not that the account is still inside it, since
allowances like DynamoDB's are account-wide.

**Where the decision gets recorded depends on the stage.** This rule is enforced
at two points, and "logged in `docs/decisions.md`" names the obligation to write
the decision down — not that one filename everywhere:

| Stage | Gate | Record |
|---|---|---|
| Idea → plan (`idea-workflow`'s architect, pending Brief D1) | An idea that genuinely cannot fit Always Free stops, rather than being best-fitted into a plan that quietly spends | needs-decision file, for a human to answer |
| Plan → apply (Terraform) | `cost_acknowledged` precondition fails the plan | that project's `docs/decisions.md` |

The architect gate fires before a project exists, so it has no
`docs/decisions.md` to write into — the needs-decision file *is* the record at
that stage. Both refuse to proceed silently; both hand the call to a human.

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
**Not yet defined, and not currently selectable** — removed from
`copier.yml`'s `flavor` choices (see `docs/decisions.md`) rather than left
as an option that silently does nothing.

What "don't guess at personal project conventions ahead of having one"
means concretely: `demo` wasn't designed by imagining what a demo project
might need in the abstract — it was written down *after* MokapiExample
already existed, by generalizing the pattern that project actually used
(mock/real toggle, normalization layer). `personal` should get the same
treatment: build a real personal project first, notice what makes it
different from `core` or `demo` in practice, then write *that* down here
and add it back to `copier.yml` — not invent plausible-sounding rules now
that might not match whatever a real personal project turns out to need.
