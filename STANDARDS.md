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
existence as a separate un-templated file, and the capability model below.

**This file describes only what is currently true.** Options that were
removed, and options that are merely planned, do not belong here in any
form — not as a "deprecated" note, not as a "not yet defined" placeholder.
They live in `docs/decisions.md`, which is the provenance layer and is
allowed to talk about the past and the hypothetical. The reason is not
tidiness: this file is the normative input every future session reads, and
anything described here gets treated as live design input whether or not it
still exists. If you need to know why something is gone, `docs/decisions.md`
will tell you.

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
| Idea → plan (`idea-workflow`'s architect) | An idea that genuinely cannot fit Always Free stops, rather than being best-fitted into a plan that quietly spends | needs-decision file, for a human to answer |
| Plan → apply (Terraform) | `cost_acknowledged` precondition fails the plan | that project's `docs/decisions.md` |

The architect gate fires before a project exists, so it has no
`docs/decisions.md` to write into — the needs-decision file *is* the record at
that stage. Both refuse to proceed silently; both hand the call to a human.

## Structure

- Clean FE/BE separation — `backend/` and `frontend/` are independently
  runnable and testable; no backend logic imported into frontend code or
  vice versa.
- `docker compose up -d --build` is the one true "run this locally" command
  for any project with the API capability — no undocumented manual setup
  steps. A UI-only project has no server to compose, and says so in its
  README instead.

## Documentation

- `README.md`: what it is, how to run it locally, how (and whether) it's
  deployed.
- `CLAUDE.md`: filled in from this template's skeleton — What this is /
  Commands / Architecture invariants / Testing conventions / Gotchas /
  Things intentionally left simple / Extending this.
- `docs/decisions.md`: one entry per hard-to-reverse decision, logged when
  it's made, not reconstructed later. Every generated `CLAUDE.md` includes
  a standing instruction to do this proactively each session.

## Testing

- One test runner across the stack (vitest, matching CalculatorExample) —
  not jest-here-vitest-there.
- **Every package with tests ships its own `vitest.config.js`**, even when
  its contents are barely more than the defaults. Without one, vitest
  searches upward and an unrelated parent config wins: the run reports "No
  test files found" and exits 0, so CI passes having tested nothing.
- A generated project's packages come with a passing suite and a committed
  `package-lock.json` — `npm test` works in a fresh scaffold before anything
  is set up by hand. CI runs `npm test`, not `npm test --if-present`: a
  package with no test script is a defect to catch, not to skip.
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

## Capabilities

A project is not a *kind*; it is a *set of capabilities*. Each one is a
single boolean in `copier.yml`, independently on or off:

| Capability | Question | Means |
|---|---|---|
| API | `needs_api` | An Express backend in `backend/`, run by docker compose. |
| UI | `needs_ui` | Static files in `frontend/`. |
| HOSTED | `needs_hosting` | Deployed to AWS Lambda on Always Free, via `terraform/`. |
| DATABASE | `needs_datastore` | DynamoDB, via the shared `dynamodb-single-table` module. |

### The contract: a capability owns its files, its tests, and its CI job

All three travel together. A capability is not finished — is not *a
capability* — until all three exist. Concretely, to add one:

1. **Files.** Everything it contributes, gated by *path name*: a directory
   or file under `template/` literally named
   `{{ 'terraform' if needs_hosting else '' }}` renders to the empty string
   when the flag is off, and Copier skips it and everything beneath it. Put
   the gate in the path, not in a task list, so the gate is visible from the
   content. Sections *inside* a shared file (`README.md.jinja`,
   `CLAUDE.md.jinja`, `ci.yml.jinja`) stay inline `{% if %}` blocks.
2. **Tests.** Its own, testing its own files. Not folded into another
   capability's suite.
3. **A CI job.** Its own job in `template/.github/workflows/ci.yml.jinja`,
   gated on the same flag.

The one allowed exception is a capability that cannot exist alone: DATABASE
requires HOSTED, contributes only blocks inside `terraform/`, and is
therefore covered by HOSTED's `terraform` job. A capability riding another's
job must say so where the job is defined.

**Why the three-part rule and not just "files":** the template shipped a
`frontend/` for months that no CI job ever touched, because nothing forced
the files and the job to arrive together. Files are the part you notice
missing; the CI job is the part you don't.

### Dependencies between capabilities

- HOSTED requires API — the hosted path deploys a Node handler behind a
  Lambda Function URL, so there must be a server to deploy.
- DATABASE requires HOSTED — it is provisioned by `terraform/`.
- At least one of API or UI must be on. Both off generates docs and nothing
  else, and `copier.yml`'s validator rejects it.

These are enforced in `copier.yml` (`when` + `validator`) and re-checked in
idea-workflow's `parsePlan`, since that path supplies answers from a file
rather than interactively.

## Presets

A preset is a named bundle that **pre-selects capability defaults and
nothing else**. It owns no files. Picking one still leaves every capability
individually overridable, so a preset can never be the reason some
combination is unreachable. The `flavor` question holds the preset; it is
recorded in `.copier-answers.yml`, `README.md` and `CLAUDE.md` as provenance
— "what was asked for" — while the capability flags are "what was built".

- `core` — API + UI + HOSTED. The default.
- `prototype` — API + UI, local-only. For something you want running today
  and are not sure you will keep.

Adding a preset is a defaults-only change to `copier.yml` plus a line here
and an entry in `docs/decisions.md`. If a proposed preset needs files of its
own, it isn't a preset — it's a capability, and belongs in the table above.
