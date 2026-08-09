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
- **All Terraform in a generated project derives from
  [`terraform-modules`](../terraform-modules).** A root config wires pinned
  modules together and passes values between them; it does not declare AWS
  resources of its own. Today that is `lambda-web-app`,
  `dynamodb-single-table` and `s3-bucket`. Something the modules do not cover
  is a change to *that* repo — a new module, or a new variable on an existing
  one, released under a tag — not a resource block here. See its README for
  the gotchas already solved there (Function URL permissions, provider
  version, GSI key_schema bug) and its CHANGELOG for what a tag bump pulls in.
- **One project pins one tag across its whole config.** Every module `source`
  ends in the same `?ref=vX.Y.Z`, so upgrading is a single decision with a
  single changelog to read rather than a per-module archaeology exercise.
- **State lives in S3, not on a laptop.** `terraform/bootstrap/` is a separate
  root config, with local state, whose only job is creating the state bucket
  with `s3-bucket`; `terraform/` then uses that bucket as an `s3` backend with
  `use_lockfile = true` — S3-native locking, no DynamoDB lock table — which is
  why generated configs require Terraform >= 1.10. Local state means no
  locking, no history, and one lost file between a project and infrastructure
  Terraform can no longer see or destroy.

### Enforcement: pinned module sources

The `terraform` CI job in every generated project fails when a `source =` in
any `*.tf` is not
`git::https://github.com/NateDogg12501/terraform-modules.git//modules/<name>?ref=vX.Y.Z`.
An unpinned `?ref=main`, a missing `?ref=`, a registry source and a local path
all fail. Provider `source` shorthands are excluded by shape, not by position:
a registry *module* source is `NAMESPACE/NAME/PROVIDER`, so two segments
(`hashicorp/aws`) can only be a provider. **The check also fails when it finds
no pinned source at all** — a grep that matches nothing is otherwise green, and
the two worst regressions this pipeline has had were both checks that passed
having verified nothing.

**Cross-module IAM is the one hand-written resource this rule expects, and it
is not an exception being smuggled in.** `lambda-web-app` exposes
`lambda_role_name` precisely so the caller can attach policies: the module that
owns the role cannot know what will sit beside it, and the module that owns the
table cannot attach to a role it does not own. So
`aws_iam_role_policy.app_table_access` in a DATABASE project's `main.tf` is the
intended shape. The rule is about resources a module *could* own; glue between
two modules is not one.

The honest limit: this reads module *sources*, not resource blocks. It cannot
tell that glue from a hand-written Lambda, and it cannot tell that a pinned
module is the *right* module. It catches the mechanical half — an unpinned or
off-repo source — and a reviewer catches the rest.

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
  steps. For the DATABASE capability that now includes a working datastore:
  `dynamodb-local` comes up healthy before the API container starts, seeded
  with the same table schema Terraform declares, with no AWS credentials
  required. A UI-only project has no server to compose, and says so in its
  README instead.
- **The datastore endpoint is configuration, not an abstraction layer.** One
  module in `backend/src/` constructs the DynamoDB client, reading the
  endpoint from `AWS_ENDPOINT_URL_DYNAMODB` — set, it points at
  `dynamodb-local`; unset, the AWS SDK resolves the real regional DynamoDB
  endpoint, which is what a deployed Lambda does by never setting it. No
  other file in a generated project constructs a DynamoDB client. The reason
  it is one environment-variable switch and not a hand-written
  repository/adapter layer: local and deployed then run the exact same code
  path end to end, so a bug can't hide in a difference between them — a
  hand-rolled abstraction is exactly what would introduce one.

## Documentation

- `README.md`: what it is, how to run it locally, how (and whether) it's
  deployed.
- `CLAUDE.md`: filled in from this template's skeleton — What this is /
  Commands / Architecture invariants / Testing conventions / Gotchas /
  Things intentionally left simple / Extending this.
- `docs/decisions.md`: one entry per hard-to-reverse decision, logged when
  it's made, not reconstructed later. Every generated `CLAUDE.md` includes
  a standing instruction to do this proactively each session.

### Prompts are product, not config

A file whose contents *become* an agent's instructions — `idea-workflow`'s
`orchestrator/prompts/*.md` today, anything like it later — is a **product
surface**. Treat a change to one the way you'd treat a change to a feature,
not the way you'd treat bumping a timeout.

The difference is what a mistake does. Get config wrong and it breaks where
you can see it: a bad port refuses connections, a bad path throws `ENOENT`.
Get a prompt wrong and everything still runs. Tests pass, CI is green, output
arrives well-formatted and confident. It is simply worse, and nothing says so.

(This is also what separates prompts from the three documents above. Those are
read *opportunistically*, by an agent that happens to be working in the repo.
A prompt is injected *every single time*, deterministically. Same file format,
completely different blast radius.)

Concretely — `architect.md` currently contains this line:

> `assumptions` — everything you decided that the ticket did not say. This is
> the most valuable field you write; it is where a human catches you being
> wrong while it is still cheap. An empty list on a vague ticket is a mistake.

Delete that sentence and nothing fails. `parsePlan` still validates
(`assumptions` is optional, defaulting to `[]`), every test still passes, a
plan still reaches Jira and still builds. What is gone is the architect
telling you what it guessed — so Spec Review, whose whole job is catching a
wrong guess while it is still cheap, quietly stops being able to. No error, no
alert; just worse builds a month later with no traceable cause.

So:

- **Change them in a PR, reviewed like code** — never edited in place mid-run.
- **Never "just tweak it" to rescue one bad build.** That is a product release
  with a sample size of one.
- **Judge them by running them**, against tickets whose good output you
  already know. There is no unit test for a prompt; the assertion is a human
  reading results. (Tests can still pin the mechanical parts — that a required
  section exists, that the untrusted-data fence is last — and
  `orchestrator/test/architect-prompt.test.ts` does exactly that. Those guard
  structure, not quality.)
- **Log the reasoning in `docs/decisions.md`** when a change alters what the
  agent is *for*. With prompts the wording is the whole artifact, so why it is
  worded that way is the only thing a future reader has to go on.

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
| DATABASE | `needs_datastore` | DynamoDB — the shared `dynamodb-single-table` Terraform module when deployed, `dynamodb-local` via docker compose when run locally, both behind the one client module in `backend/src/`. |

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

Not every job belongs to a capability, though — `ci.yml.jinja` also has
**ungated jobs owned by the template itself**, for files every project gets
whatever its capabilities are. `claude-md` (which fails the build while
`CLAUDE.md` still holds skeleton placeholders) is the one that exists today.
An ungated job needs that justification: it is for content that renders
unconditionally, and there is genuinely no flag to gate it on. "I couldn't
decide which capability owns it" is not that justification.

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
