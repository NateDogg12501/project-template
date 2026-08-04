# docs/decisions.md — project-template's own decisions

This is **this repo's** decisions log — not the templated one that gets
copied into every generated project (that's `template/docs/decisions.md.jinja`,
a separate file, empty except for a seed entry when a project is generated).
This one records why *the pipeline itself* looks the way it does. Since this
repo is meant to be the "gold standard" every generated project inherits
from, its own choices deserve the same discipline STANDARDS.md now asks of
generated projects: **every standard or tool this pipeline adopts gets an
entry here explaining why**, not just a mention in README.

Format matches the per-project convention (see STANDARDS.md):

```markdown
## YYYY-MM-DD: <short title>
**Context:** why this needed deciding
**Decision:** what was chosen
**Why not the alternative(s):** ...
**Consequence:** what this commits future work to
```

## 2026-07: Copier over Cookiecutter
**Context:** needed a scaffolding tool for the `core`/`demo`/`personal`
template.
**Decision:** Copier.
**Why not Cookiecutter:** Cookiecutter only scaffolds once — after that,
the generated repo and the template diverge with no way to reconcile them.
Copier tracks the answers it was given (`.copier-answers.yml`, dropped into
every generated repo) and supports `copier update`, which re-applies
template changes as a diff against an already-generated project, respecting
local edits. Given the whole point of this pipeline is that the template
keeps evolving, a tool that can't propagate that evolution defeats the
purpose.
**Consequence:** every generated project carries `.copier-answers.yml` and
is expected to occasionally run `copier update`; the template's `copier.yml`
and `template/` structure are now a real API other repos depend on, not a
one-shot generator you can freely restructure without thinking about
existing consumers.

## 2026-07: STANDARDS.md lives here, not copied into generated projects
**Context:** every generated project needs to know the pipeline's durable
rules (hosting, structure, docs, testing, pre-merge, flavors).
**Decision:** `STANDARDS.md` stays in this repo only; generated projects'
`CLAUDE.md` links to it rather than getting a copy.
**Why not copy it into every project:** a copy drifts the moment this repo's
STANDARDS.md changes — N stale copies vs. one source of truth. `copier
update` only re-applies `template/` (the Jinja-rendered project content),
not this repo's own root files, so a copied STANDARDS.md wouldn't even stay
in sync via the update mechanism anyway.
**Consequence:** generated projects depend on this repo staying reachable
(a broken/renamed link means CLAUDE.md points nowhere) — acceptable since
it's a private repo we control, not a public dependency.

## 2026-07: `personal` flavor removed from `copier.yml` choices until defined
**Context:** `flavor` originally offered `core`/`demo`/`personal`, but
`personal` had no real content — selecting it produced output identical to
`core` except for the recorded flavor name.
**Decision:** removed from the live `choices` list in `copier.yml`;
STANDARDS.md still documents it as planned.
**Why not leave it selectable:** offering a choice that silently does
nothing is misleading — it looks like a real option when it isn't one yet.
**Consequence:** `personal` isn't generatable until someone (a) builds an
actual personal project, (b) generalizes its pattern the same way `demo`
was generalized from MokapiExample, and (c) adds it back to `copier.yml`
with real conditionals — not designed abstractly ahead of a real example.

## 2026-07: Flavor differences via inline `{% if %}` + task-pruned files, not a template chain
**Context:** Copier supports composing multiple templates together (a base
template plus flavor-specific overlay templates applied in sequence) for
projects where flavors diverge heavily. Right now flavor differences here
are inline `{% if flavor == "..." %}` blocks inside shared files
(`CLAUDE.md.jinja`, `README.md.jinja`) plus whole files pruned by `_tasks`
when a flavor doesn't need them (`docs/mock-vs-real.md.jinja`).
**Decision:** keep the single-template, inline-conditional approach for now.
**Why not build the multi-template chain now:** with two real flavors
(`core`, `demo`), the conditionals are small and easy to read in place.
Composing separate templates is real added complexity — you have to reason
about which template "owns" which file, since Copier's own docs warn that
two templates touching the same file just overwrite each other rather than
merging. That complexity isn't earning its keep yet.
**Consequence:** if a third flavor needs to substantially restructure
(not just add a section to) `CLAUDE.md.jinja`/`README.md.jinja`, or the
inline conditionals in those two files become hard to read, that's the
concrete signal to switch to per-flavor template composition — not before.
Revisit this decision then, don't preemptively build the chain.

## 2026-08: Generated projects get a private GitHub repo automatically
**Context:** the `_tasks` pipeline already ran `git init` + first commit for
every generated project, but left creating the actual GitHub remote as a
manual, easy-to-forget step done outside the template — meaning a freshly
scaffolded project could sit uncommitted-to-GitHub with no record that step
was skipped.
**Decision:** added `gh repo create {{ project_slug }} --private --source=.
--remote=origin --push` as a final `_tasks` entry (copy operations only),
right after the first commit. Creates the repo under the developer's
authenticated `gh` account, named after `project_slug`, and pushes the
initial commit in the same step.
**Why not leave it manual:** the whole point of this pipeline is removing
undocumented manual setup steps (see STANDARDS.md's "Structure" section) —
a repo-creation step that lives only in someone's memory is exactly the kind
of drift this template exists to prevent.
**Why `--private` unconditionally:** every project generated so far is
private by default; nothing in `copier.yml` currently distinguishes
public-from-private intent, so hardcoding `--private` matches actual usage.
If a public project is ever needed, that's worth its own question in
`copier.yml`, not a silent default flip.
**Consequence:** `copier copy` now hard-depends on the `gh` CLI being
installed and authenticated (`gh auth login`) — without it, the last task
fails and the local repo is left committed but not pushed/remoted (everything
before that task already succeeded, so this is a safe partial failure, not a
corrupted state). Documented in README's "Generate a new project" section.

## 2026-07: Minimal Express + static frontend, not npm workspaces/TypeScript
**Context:** CalculatorExample uses npm workspaces + TypeScript (engine/
server/web packages) with a real build step; MokapiExample uses a plain
Express backend serving static, unbuilt frontend files.
**Decision:** the `core` skeleton's `backend/`/`frontend/` starter follows
MokapiExample's simpler shape — no build step, no workspaces.
**Why not default to the workspaces/TypeScript shape:** that complexity is
warranted by CalculatorExample's actual needs (a custom typed formula
language, a real UI framework) — forcing it as the *default* starting point
for every new project, including small demos that don't need it, would mean
scaffolding complexity nobody asked for yet. A project that does need it can
add workspaces/TypeScript itself; the template shouldn't presuppose it.
**Consequence:** any project generated from this template starts with zero
build step. If a project's needs grow into something CalculatorExample-shaped,
that's a manual upgrade, not something `copier update` will do for you.

## 2026-08-02: Made the generated hosting path actually deployable
**Context:** `idea-workflow-example-1` hit `could not archive missing
directory: ./../dist-lambda` on its first real `terraform apply`. Tracing it
back showed the template — not that project — was the source, and that it
shipped three separate defects to every `needs_hosting: true` project:
(1) no `build:lambda` script or packaging script existed anywhere, while
`terraform/README.md.jinja` carried a literal `[fill in your build:lambda
command]` placeholder; (2) `backend/src/index.js.jinja` hardcoded
`express.static(path.join(__dirname,'..','..','frontend'))` and never read
`WEB_DIST`, even though `main.tf.jinja` sets `WEB_DIST=/var/task/web`;
(3) the module pin was `v1.0.0`, whose `archive_file` drops `run.sh`'s
executable bit on Windows (fixed upstream in `v1.1.0`).
**Decision:** Added `template/backend/scripts/build-lambda.js` (gated on
`needs_hosting`, removed with `terraform/` by a `_tasks` entry when hosting
is off), wired it up as `build:lambda`, made `index.js.jinja` read `WEB_DIST`
with the relative path as fallback, bumped both module pins to `v1.2.0`, and
replaced the README placeholder with real instructions.
**Why not leave the build step per-project:** the placeholder was a standing
invitation for every project to invent its own packaging, and the one project
that reached deployment simply hit an error instead. A template that
configures `WEB_DIST` in Terraform is already asserting a contract about the
artifact layout — it should ship the code that satisfies it.
**Why (2) was the more dangerous defect:** the missing build script failed
loudly at `terraform apply`. The unread `WEB_DIST` would have failed
*silently* — API healthy, every static file 404, discovered only after the
site was live. CalculatorExample reads `WEB_DIST` (`packages/server/src/
config.ts`); the template took the Terraform half of that pattern and left
the application half behind.
**Consequence:** `terraform apply` for generated projects now requires
`python3` on PATH (inherited from the `v1.1.0` module's zip script).
`build-lambda.js` copies an explicit list of `frontend/` files, so any new
static asset must be added there or it will 404 in production only — called
out in the generated `terraform/README.md`. The script falls back to `npm
install` with a warning when no `package-lock.json` exists yet (a fresh
scaffold has none), so builds are only reproducible once that lock is
committed.

## 2026-08-03: Cost standard becomes "log it and confirm it", enforced by a plan-time gate
**Context:** the Hosting rule was "AWS Always Free services only", with an
aside that anything outside the free tier "is worth a `docs/decisions.md`
entry". Two problems. It was absolute in a way nothing enforced — the only
thing standing between the account and a bill was whoever happened to read
the plan output. And it had no answer for the legitimate case where a project
genuinely needs a paid resource, so the rule's real-world effect was to be
quietly broken rather than consciously departed from. Concretely: nothing
stopped `dynamodb-single-table` from being handed
`billing_mode = "PAY_PER_REQUEST"`, which is not in the free tier at all and
bills from the first request, and `lambda-web-app` left log retention at
`Never Expire` forever.
**Decision:** the rule is now **AWS Always Free unless logged in
`docs/decisions.md` and explicitly confirmed**, and "explicitly confirmed" is
a `cost_acknowledged` boolean (default `false`) plus a `lifecycle`
precondition in any module that provisions billable resources. The
precondition fails the **plan** when the configuration is billable and the
flag is false. Implemented first in `terraform-modules`'
`dynamodb-single-table` (v2.0.0), which is the reference implementation.
**Why not keep "Always Free only":** an absolute rule with no exit is one
people route around silently. Naming the exit and making it cost two
deliberate acts — write the entry, set the flag — gets a decision recorded
instead of a rule quietly ignored.
**Why not a variable `validation` block:** billability is a function of
several inputs together (billing mode *and* capacity summed over the table
and its GSIs), and a `validation` block can only see the one variable it is
attached to.
**Why not a CI check or a cost-estimation tool:** CI runs on a PR; the money
gets spent at `terraform apply`, which is run by hand. A precondition is
attached to the resource itself, so it holds wherever the plan runs — and it
needs no new dependency.
**Consequence:** the flag defaulting to `false` means adding a billable
configuration to an existing project now fails the plan until someone opts
in, which is the intended friction. Every new module that can provision
billable resources has to implement the gate — added to the "Adding a module"
checklist in `terraform-modules`' README. The gate is per-module and cannot
see account-wide usage: DynamoDB's 25 RCU/25 WCU allowance is shared across
every table in every project, so all gates passing means no single resource
knowingly left the free tier, not that the account is still inside it. The
rule gets a second enforcement point ahead of Terraform once Brief D1 lands:
`idea-workflow`'s architect prompt stops at *plan* time when an idea genuinely
cannot fit Always Free, writing a needs-decision file for a human rather than
producing a best-fit plan. Same rule, two stages, deliberately different
artifacts — at architect time no project exists yet, so the needs-decision file
*is* the record; `docs/decisions.md` is where the reasoning lands once there is
a project to put it in. Read "logged in `docs/decisions.md`" as naming the
obligation to write the decision down, not that one filename at every stage.
