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

## The flagship loop

**`kids-ledger` is the flagship project.** New patterns get trialled there
before being promoted into the template. Its `docs/decisions.md` is therefore
evidence, not just history — the place where an idea proved itself before
becoming a standard.

The upward path for a pattern to become a standard is a four-step loop:

1. **Trial it in `kids-ledger`.** Log it in *that project's* `docs/decisions.md`,
   with why. This is the evidence layer.
2. **Ask whether it generalizes.** Some things are project-specific and should
   stay. This step is the one that gets skipped, and skipping it is how a
   template accretes one project's accidents.
3. **If it generalizes, change `project-template` or `terraform-modules`**,
   citing the `kids-ledger` entry as evidence. A standards change gets a
   `STANDARDS.md` entry here and a `docs/decisions.md` entry in that repo —
   the discipline that already exists; this just names where the evidence
   comes from.
4. **`copier update` other projects when they're ready.** Nothing moves on its
   own — same philosophy as the module tag pins.

**Where multi-repo design documents live:** `project-template/docs/`, because
this repo is already the root of cross-project truth. Large design documents
that span multiple repos — like the CD pipeline requirements — belong here, not
scattered across individual repos. See [`docs/cd-pipeline.md`](docs/cd-pipeline.md)
as the worked example.

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
  resources of its own. Today that is `lambda-web-app` and
  `dynamodb-single-table` — `s3-bucket` is used too, but no longer by a
  generated project's own `terraform/`: it's what creates the shared state
  bucket in the account-level bootstrap that lives outside this template.
  Something the modules do not cover is a change to *that* repo — a new
  module, or a new variable on an existing one, released under a tag — not a
  resource block here. See its README for the gotchas already solved there
  (Function URL permissions, provider version, GSI key_schema bug) and its
  CHANGELOG for what a tag bump pulls in.
- **One project pins one tag across its whole config.** Every module `source`
  ends in the same `?ref=vX.Y.Z`, so upgrading is a single decision with a
  single changelog to read rather than a per-module archaeology exercise.
- **State lives in S3, in one bucket shared across every project.** Not a
  bucket per project — one bucket, created once in an account-level
  bootstrap outside this template, holding every project's state keyed
  `<project_slug>/<environment>/terraform.tfstate`. `terraform/backend.tf` is
  a partial `s3` backend: bucket and region are literals (backend blocks
  cannot interpolate), and `key` is omitted from the file entirely and
  supplied per apply — `terraform init
  -backend-config="key=<project_slug>/<environment>/terraform.tfstate"` — since
  it is the one thing that legitimately varies from one apply to the next.
  `use_lockfile = true` is S3-native locking, per key, so concurrent applies
  across projects and environments don't contend — no DynamoDB lock table,
  which is why generated configs require Terraform >= 1.10.
- **Isolation moved from bucket topology to IAM.** One shared bucket means a
  misconfigured policy could, in principle, let one project read or write
  another's state. The boundary is meant to be a prefix-scoped deploy role
  per project — `s3:*Object` on `arn:aws:s3:::<bucket>/<project_slug>/*` and
  nothing wider, created per project during AWS provisioning — not a bucket
  per project. "Every project shares one bucket" reads as a downgrade until
  you know the isolation moved one layer down rather than disappearing. A
  project that hasn't been through that provisioning yet has no such role,
  and correspondingly no deploy credentials at all — see
  [`docs/cd-pipeline.md`](docs/cd-pipeline.md) B3.

### Authentication: one credential, account-wide

- **A hosted project authenticates against `/shared/auth_username` and
  `/shared/auth_password_hash`, and creates no credential of its own.** They are
  account-wide SSM parameters, written once by the account bootstrap and
  consumed by every project. `aws-account`'s `docs/decisions.md` #7 records the
  trade-off that makes them acceptable — one compromise reaches every project,
  and no project can be revoked individually — and that trade was accepted on
  the understanding that there is exactly **one** credential to reason about.
- **A project that generates its own password silently voids that reasoning.**
  It adds a secret nobody rotates, a login that behaves unlike every other
  project's, and a second place to look when someone cannot get in. The failure
  is invisible from inside the project: it works, its tests pass, its deploy is
  green, and the divergence shows up only by listing the account's SSM
  parameters side by side — or by a human trying the shared password and being
  refused.
- The password lives as a **bcrypt hash**, never plaintext, and the username is
  a real field. **A project presenting a password-only form is not using this
  credential**, whatever it calls the parameter it reads.
- `terraform/main.tf` wires both into the Lambda as `AUTH_USERNAME` and
  `AUTH_PASSWORD_HASH`. The *only* secret a generated project owns is
  `/<project_slug>/<environment>/session_secret`, and it signs sessions rather
  than granting access — it is not an alternative to the above.

### Deploying is composed stages, and the workflow holds none of the logic

A hosted project deploys through `.github/workflows/deploy.yml`, which is
dispatched (never `on: push`) with an `environment` input and does nothing but
sequence composite actions from `.github/actions/`. Anything longer than a few
lines of shell belongs in a stage.

- **No AWS keys, anywhere.** The workflow assumes a per-environment role over
  OIDC. The role ARNs are repository *variables*, and a missing one fails the
  run rather than falling back to the other environment's role.
- **`terraform apply` applies a saved plan file**, never a bare `apply`, so
  what executes is what was planned and printed.
- **A deploy that applied cleanly and serves 502 is a failed deploy.** The
  `smoke-test` stage is what makes that true; without it a ticket reaches
  review pointing at a broken URL, which looks exactly like success. Its poll
  is bounded — Actions minutes are capped and nothing may idle.
- **Every run uploads a `deploy-result` artifact** holding
  `{ environment, url, sha, status }`, on the failure path as well as the
  success path. It is read outside the repository by the orchestrator, so it is
  an interface: add fields, don't rename them. Each project's
  `docs/deploy.md` is the copy of the contract that travels with it.
- **The account-wide cost gate runs before every apply.** `cost_acknowledged`
  in `terraform-modules` sees one module's own numbers; `capacity-gate` sums
  provisioned DynamoDB capacity across the whole account and region, which is
  the only thing that can catch five projects each passing at 6 units of a
  shared 25. It fails closed: an API call it cannot make is a failed deploy,
  never an empty account.
- **Production data reaches a lower environment only through a sanitizer the
  project itself writes.** The template cannot know which attributes are
  personal data, so the `seed` stage copies nothing at all until that file
  exists, and says so loudly rather than failing the deploy. A seed step that
  silently copies real data is worse than no seed step.

### Enforcement: pinned module sources

The `terraform: derives from terraform-modules` CI check in every generated
project fails when a `source =` in
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

**Environments multiply this.** Every hosted project now provisions its
resources once per environment — `staging` and `production` both apply the
same modules — so the account-wide total this gate structurally cannot see
grows with every environment a project has, not just with every project.
`cost_acknowledged` still only answers "is this one resource, in this one
apply, inside the free tier" — it was never going to answer "is the account,"
and environments are exactly what makes that gap bigger. Closing it is a
deploy-pipeline concern, not a Terraform one — see
[`docs/cd-pipeline.md`](docs/cd-pipeline.md)'s A1 and D14 for the account
capacity gate that's designed to cover it.

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

## Environments

Every hosted project has an ordered list of environments it deploys through —
`staging` then `production`, today. `variable "environment"` in
`terraform/variables.tf` is validated against that list and has no default:
an apply that doesn't say which environment it targets fails immediately
instead of picking one silently. It's composed into every resource name and
SSM path at the root config —
```hcl
locals {
  name_prefix = "${project_slug}-${var.environment}"
}
```
not passed down into `terraform-modules`. The modules take `app_name` /
`table_name` as plain strings, so per-environment naming is the root
config's job, not a module's — no `terraform-modules` change is needed to
add or rename an environment.

**Nothing may assume exactly two.** The list is ordered — each environment
promotes to the next — but code that works today with `staging` and
`production` must keep working if a third name is inserted; a third
environment is a list entry, not a redesign.

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

| Capability | Question | Means | Pipeline stages |
|---|---|---|---|
| API | `needs_api` | An Express backend in `backend/`, run by docker compose. | — |
| UI | `needs_ui` | Static files in `frontend/`. | — |
| HOSTED | `needs_hosting` | Deployed to AWS Lambda on Always Free, via `terraform/`. | `capacity-gate`, `ensure-secrets`, `terraform-apply`, `smoke-test` |
| DATABASE | `needs_datastore` | DynamoDB — the shared `dynamodb-single-table` Terraform module when deployed, `dynamodb-local` via docker compose when run locally, both behind the one client module in `backend/src/`. | `seed` |

### The contract: a capability owns its files, its tests, its CI checks, and its pipeline stages

All four travel together. A capability is not finished — is not *a
capability* — until all four exist (a capability that deploys nothing has no
stages, which is a real answer, not a missing one). Concretely, to add one:

1. **Files.** Everything it contributes, gated by *path name*: a directory
   or file under `template/` literally named
   `{{ 'terraform' if needs_hosting else '' }}` renders to the empty string
   when the flag is off, and Copier skips it and everything beneath it. Put
   the gate in the path, not in a task list, so the gate is visible from the
   content. Sections *inside* a shared file (`README.md.jinja`,
   `CLAUDE.md.jinja`, `ci.yml.jinja`) stay inline `{% if %}` blocks.
2. **Tests.** Its own, testing its own files. Not folded into another
   capability's suite.
3. **CI checks.** Its own steps in the one `checks` job in
   `template/.github/workflows/ci.yml.jinja`, gated on the same flag and
   clearly named (`"terraform: validate"`, `"datastore: npm run
   test:integration"`, ...) so a red run still says which capability broke.
   Every capability's steps share that one job rather than each getting its
   own — GitHub bills per job rounded up to the minute, and a project with
   several capabilities was paying a full billed minute per capability for
   work that individually took seconds. Each check-running step after the
   checkout carries `if: ${{ '{{' }} !cancelled() }}` so one capability's
   failure doesn't stop the rest from running and reporting — the same "see
   every broken capability at once" visibility separate jobs gave for free.
   See docs/decisions.md for the trade-off this makes and why it was taken.
4. **Its pipeline stages**, if deploying the project needs it to do something.
   A stage is a composite action in
   `template/.github/{{ 'actions' if needs_hosting else '' }}/<stage>/`, called
   from `deploy.yml` in a step gated on the same flag. It takes everything it
   needs as inputs — a stage that reads a repository variable or a project
   name directly is one that cannot be run on its own, and being separately
   runnable is the whole reason these are actions rather than one script.
   Stages carry their own tests under item 2, which is what makes a *check*
   like `capacity-gate` provable: a gate whose failing path has never been
   exercised is a gate that has only ever been observed to pass.

Not every step belongs to a capability, though — `ci.yml.jinja`'s `checks` job
also has **unconditional steps owned by the template itself**, for files every
project gets whatever its capabilities are. `claude-md` (which fails the build
while `CLAUDE.md` still holds skeleton placeholders) is the one that exists
today, and runs first, right after checkout. An unconditional step needs that
justification: it is for content that renders unconditionally, and there is
genuinely no flag to gate it on. "I couldn't decide which capability owns it"
is not that justification.

**Why the four-part rule and not just "files":** the template shipped a
`frontend/` for months that no CI check ever touched, because nothing forced
the files and the check to arrive together. Files are the part you notice
missing; the CI check is the part you don't. Stages are the same shape of
mistake one layer out — a capability that provisions something and contributes
nothing to the deploy is one whose infrastructure only exists on the laptop of
whoever last ran `terraform apply` by hand.

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

## Template ownership

A fix to this template reaches a generated project only if something carries
it there. For a long time nothing did. P12 fixed a bug in `ci.yml.jinja` that
broke CI on every hosted project from the moment it finished AWS provisioning;
the fix merged here and reached nothing, and `restock-list` had to be patched
by hand. The propagation mechanism is `copier update`, and this section is the
contract it operates under.

### Know first: `scripts/template-doctor.js`

```
node scripts/template-doctor.js [--org <org>] [--verbose] [--json]
```

Reports, for every repo in the projects org that carries a
`.copier-answers.yml`, which template ref it was generated from and how far
behind it is — and, more usefully, **how many of the commits it is missing
touch files it does not own**. A project forty commits behind on nothing but
this repo's own `STANDARDS.md` needs no action; a project two commits behind
on `.github/workflows/` is the P12 case. It exits non-zero when anything is
behind, so it can be a check that fails rather than a report nobody reads.

It only reads. Run it against live projects freely.

### The three buckets

`copier update` re-applies template changes as a diff, so whether it is safe
depends entirely on whether a human has since edited the file it is patching.
Every path in a generated project is therefore owned by exactly one side. The
executable copy of this table is `scripts/ownership.js`; the two are meant to
be read together, and neither is allowed to drift from the other.

| Bucket | Paths | On conflict |
|---|---|---|
| **template-owned** | `.github/workflows/`, `.github/actions/`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/claude-review.yml.example`, `docs/deploy.md` | Template wins. Overwrite. |
| **project-owned** | `backend/`, `frontend/`, `CLAUDE.md`, `README.md`, `docs/decisions.md` | Never touched. A conflict here is a bug in the template. |
| **shared** | `terraform/`, `docker-compose.yml`, `.env.example`, `.gitignore`, `scripts/` | Neither side wins. Markers are left in the PR for a human. |
| **copier's own** | `.copier-answers.yml` | Rewritten by `copier update` itself. Never hand-edit it — it is the record of what the project *was generated as*, and editing it makes that record a lie. |

**Template-owned is pipeline infrastructure**, not application code. The
builder is not expected to edit it, and a project carrying a stale copy is
exactly the P12 failure. Overwriting is the point.

**Project-owned is the application.** The template seeded it once and has no
further claim. If an update ever wants to change a file here, the template is
reaching somewhere it should not.

**Shared is the bucket that had to exist.** `terraform/main.tf` forced it: the
template lays down the Lambda, the function URL and the table, and then the
project legitimately adds resources to that same file. `restock-list` had
uncommented `SESSION_SECRET` there — overwriting would have silently
un-configured the secret its login signs sessions with. Neither "overwrite"
nor "never touch" is correct, so these are always surfaced for review and
never resolved automatically.

Two consequences follow, and both are load-bearing:

- **A propagation change is always a pull request, never a push to `main`.**
  `main` is what production deploys. Overwriting a template-owned file is
  safe *as a proposal a human reads*, not as an unattended write — a builder
  may have had a project-specific reason for their edit, and the diff is the
  only place that gets noticed.
- **Propagation PRs are not auto-merged.** The whole value is the human
  looking at the diff.

### Conflicts are normal, and the interesting ones are informative

When `restock-list` was updated from `df803a8` to `bb6b730`, exactly one file
conflicted: `.github/workflows/ci.yml`. Its plan step had been hand-patched in
the project with the same fix that later landed here as `48d53e0` — the same
change, arrived at independently, twice. That is what a healthy conflict looks
like, and it is an argument for propagating sooner rather than later: the
hand-patch existed only because nothing carried the fix.

### `copier update` must run with LF line endings

Non-negotiable on Windows, and the reason the mechanism is specified to run on
a Linux runner. With Git's `core.autocrlf=true` (the default from the Git for
Windows installer) the working tree is CRLF while the committed blobs are LF,
so every line of every builder-touched file differs from Copier's freshly
rendered LF output. The result is not a subtle mismerge — it is a **whole-file
conflict**. Updating `restock-list` that way produced a single conflict hunk
spanning all 495 lines of `ci.yml`; the same update with `core.autocrlf=false`
produced one 40-line hunk in the one step that had actually been edited.

A second, quieter effect: Copier's internal clone of this template also
inherits the machine's `autocrlf`, so *static* (non-`.jinja`) files arrive
CRLF while Jinja-rendered ones arrive LF. That marks ~20 untouched files as
modified with zero content change, which is enough to make a propagation diff
unreadable. Changes that are line-endings-only are discarded, never committed.
