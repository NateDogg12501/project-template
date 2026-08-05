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
**Context:** needed a scaffolding tool for the template (at the time,
flavor-shaped: `core`/`demo`/`personal`).
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
**Amended 2026-08-03:** the decision stands, but "STANDARDS.md still
documents it as planned" no longer does — that description is what kept
sessions treating `personal` as live design input. It was moved here; see
the layering rule below.

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
**Superseded 2026-08-03** by the capability model below. The trigger this
entry named did fire, but the answer turned out not to be template
composition: flavors stopped being file-sets at all, so there is nothing
left for a per-flavor overlay template to own.

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

## 2026-08-03: Composable capabilities replace flavors as the unit of variation
**Context:** the template offered a `flavor` (`core`, `demo`, with `personal`
documented-but-unoffered) *alongside* two booleans, `needs_hosting` and
`needs_datastore`. Those two were doing a different job from `flavor`: each
contributed its own files (`terraform/`, `backend/scripts/`) and its own
conditional sections, and composed freely with everything else. `flavor`
selected a whole file-set. Adding the presets actually wanted next —
`prototype`, `prototype+hosted`, a personal variant — meant a combinatorial
list of file-sets, and every new one multiplied against `needs_hosting` and
`needs_datastore` anyway.
**Decision:** variation is expressed as four independent capabilities — **API**
(`needs_api`), **UI** (`needs_ui`), **HOSTED** (`needs_hosting`), **DATABASE**
(`needs_datastore`) — each a boolean, each owning its own files, its own tests,
and **its own CI job**. The two existing booleans keep their question names and
become two of the four; the new ones are `needs_api` and `needs_ui`, carved out
of what used to be unconditional template content.
**Why the three-part rule (files + tests + CI job) and not just files:** the
template shipped a `frontend/` directory to every project while `ci.yml` had a
`backend` job and a `terraform` job and nothing for the frontend. That wasn't an
oversight anyone would have caught by reading `copier.yml` — nothing forced the
files and the job to travel together, so nothing noticed the job was absent.
Naming the contract is what makes that omission a visible violation instead of
an unremarkable gap. The UI capability now has a `frontend` CI job; it is
deliberately minimal (`node --check` on every shipped script) because
`frontend/` has no test runner yet, and the job is there so the *next* change
adds tests to a job that exists rather than inventing one.
**Why keep the `needs_*` question names rather than renaming to `cap_api` etc.:**
three generated projects carry `.copier-answers.yml` files recording
`needs_hosting`/`needs_datastore`. Renaming would orphan those answers, and
`copier update` would silently fall back to defaults — for `idea-workflow`,
whose `needs_hosting: false` was set by hand precisely to keep `terraform/`
out, that would have reintroduced the directory it was flipped to prevent.
Answer-file continuity is worth more than naming symmetry.
**Why exactly these four:** they are the four things the template already had
files for. API/UI is the FE/BE split STANDARDS.md already required; HOSTED and
DATABASE already existed as booleans. Nothing was invented ahead of a real
example — the same discipline that kept `personal` out of `copier.yml`.
**Consequence:** dependencies between capabilities are now real and have to be
stated: HOSTED requires API (there must be a server to put behind a Function
URL), DATABASE requires HOSTED, and at least one of API/UI must be on.
`copier.yml` enforces these with `when` + `validator`; idea-workflow's
`parsePlan` re-checks them because that path supplies answers from a file
rather than interactively, where a `when:`-skipped question silently resolves
to its default instead of erroring.
**The "at least one of API/UI" rule has one known dissenter,** recorded here
rather than smoothed over: `idea-workflow` is a CI orchestrator with no
backend and no frontend, and hand-deleted both after scaffolding. Under this
model that repo is precisely "API off, UI off" — the combination the validator
rejects. It was left rejected because one project wanting a docs-only skeleton
is one example, and inventing a mode for it is the same mistake as designing
`personal` in the abstract. If a second project wants it, lift the validator,
gate `.github/workflows/ci.yml` on `needs_api or needs_ui or needs_hosting`
(an empty `jobs:` map is not valid workflow YAML), and delete this paragraph.
Adding a fifth capability now means
touching four things (question, gated files, tests, CI job) and bumping the
cross-repo `CopierAnswers` contract — that cost is the point, not a defect.

## 2026-08-03: File gating by rendered path name, not `_tasks` `rm -rf`
**Context:** `terraform/`, `backend/scripts/` and `docs/mock-vs-real.md` were
generated unconditionally and then deleted by `_tasks` entries when the
relevant answer was false. With four capabilities that list grows one `rm` per
gated path, all of them living in `copier.yml`, far from the files they delete.
**Decision:** gate by path name. A directory under `template/` literally named
`{{ 'terraform' if needs_hosting else '' }}` renders to the empty string when
the flag is off, and Copier skips it and its entire subtree. All three `rm`
tasks are gone; `_tasks` is back to git/gh work only.
**Verified against the installed Copier (9.17.0) before committing to it**, on
Windows: an empty-rendered directory skips its whole subtree including nested
children; an empty-rendered file name skips the file even with a `.jinja`
suffix after it; a conditional directory nested inside another conditional
directory works (`backend/scripts/` is gated on HOSTED *inside* a `backend/`
gated on API); and `validator:` fires on `bool` questions under `--defaults
--data`, not only interactively.
**Why this is more than a scaling argument:** the `_tasks` here are all guarded
by `when: "{{ _copier_operation == 'copy' }}"` — they do not run on `copier
update`. So the old mechanism only ever pruned on first generation, and an
update would re-render every pruned file back into a project that had turned
the capability off. Path-name gating applies to both operations, which makes
"flip the flag in `.copier-answers.yml` and run `copier update`" a real way to
turn a capability on or off — the story `CLAUDE.md` now tells generated
projects.
**Why not both mechanisms:** two of them means two places to look when a file
appears where it shouldn't.
**Consequence:** the gate is now readable from a `find template/` listing,
which is also the cost — the paths are long and quote-laden, and on Windows
they eat ~35 characters of the 260-character `MAX_PATH` budget each (hit for
real while probing this from a deep temp directory, not from a repo path).
Nested gates compound that. If a capability ever needs a deeply nested gated
subtree, check the path length before assuming it will render.

## 2026-08-03: `flavor` survives as a preset, not a file-set; `prototype` added
**Context:** with variation moved to capabilities, `flavor` had nothing left to
own. Deleting it entirely was an option — but it is referenced in generated
`README.md`/`CLAUDE.md`, recorded in three shipped `.copier-answers.yml` files,
and named in the cross-repo plan contract, and the useful thing it did (say in
one word what kind of project this is meant to be) survives the change.
**Decision:** `flavor` becomes a **preset** — a named bundle that pre-selects
capability *defaults* and owns no files. Every capability stays individually
overridable afterwards, so a preset can never make a combination unreachable.
Two presets: `core` (API + UI + HOSTED) and `prototype` (API + UI, local-only).
**Why `prototype` now, when `personal` was kept out for being undefined:** the
bar moved. Under the old model a flavor had to justify its own file tree, and
`personal` had none. Under the preset model a flavor has to justify a
defensible set of defaults, and `prototype` does: "running today, not sure I'll
keep it" means no AWS. It is not a speculative option that silently does
nothing — picking it changes what gets generated. The rule that kept `personal`
out is intact; what changed is what the rule is applied to.
**Why keep the name `flavor` rather than rename the question to `preset`:**
purely answer-file and contract continuity — renaming drops the recorded value
from three shipped projects and churns every Jira-comment plan that names it.
STANDARDS.md now defines the word as "preset", which is where a future session
will read it.
**Consequence:** `flavor` is provenance, not behaviour — it records what was
asked for, while the four capability flags record what was built. A future
session that wants a flavor to add a file must add a capability instead. If
that ever stops being true, this entry is the thing to revisit.

## 2026-08-03: `demo` and `personal` removed from STANDARDS.md entirely
**Context:** `demo` was a live flavor with real content (the mock/real toggle
convention, generalized from MokapiExample) and `personal` was documented in
STANDARDS.md as "not yet defined, and not currently selectable" — three
paragraphs, the longest thing in the Flavors section, describing something the
template did not offer. Both descriptions kept being read by later sessions as
current design input, and were acted on as such.
**Decision:** `demo` is gone — from `copier.yml`'s choices, from
`template/docs/mock-vs-real.md.jinja` (deleted), from the flavor-conditional
block in `CLAUDE.md.jinja`, and from STANDARDS.md. `personal`'s rationale moved
out of STANDARDS.md into this file, below. Neither word appears in STANDARDS.md
now.
**Why delete rather than mark deprecated:** a deprecation note in the normative
layer is still a description in the normative layer. The observed failure mode
wasn't someone selecting `demo` by mistake; it was sessions treating its
described conventions as rules to design around. The only reliable fix is for
the normative file not to describe it.
**What was in `demo`, preserved here so it isn't lost:** every external
integration got a Source switch (mock vs real) in the UI and a normalization
layer in the backend, so both paths rendered identically to the frontend —
generalized from MokapiExample after that project existed, not invented ahead
of it. If a future project wants this, it is a *capability* (files + tests +
CI job), not a flavor, and it should be re-derived from whatever the next real
example actually does rather than restored from this paragraph.
**What was in `personal`, preserved here:** nothing, and that was the point.
The reasoning was: don't guess at personal-project conventions ahead of having
a personal project. `demo` was written down *after* MokapiExample existed, by
generalizing the pattern that project actually used. A personal variant should
get the same treatment — build one, notice what makes it different in
practice, then encode that. Under the capability model it would arrive as a
capability or a preset, not as a flavor.
**Consequence:** `copier.yml`'s `flavor` choices are `core` and `prototype`.
idea-workflow's `parsePlan` and architect prompt no longer accept or suggest
`demo`; a v1 plan sitting in an old Jira comment that says `"flavor": "demo"`
is normalized to `core` on read rather than rejected (see that repo's
decisions log).

## 2026-08-03: STANDARDS.md is the normative layer; decisions.md is the provenance layer
**Context:** the `demo`/`personal` problem above is not specific to flavors. It
recurs whenever STANDARDS.md describes something that is removed, planned, or
otherwise not currently true. Every session that reads STANDARDS.md reads it as
instructions, because that is what it is for.
**Decision:** encoded as a rule at the top of STANDARDS.md: **it describes only
what is currently true.** Removed options and speculative ones do not appear
there in any form — not as a deprecation note, not as a "not yet defined"
placeholder. They live here, in `docs/decisions.md`, which is explicitly the
layer allowed to talk about the past and the hypothetical.
**Why not one file with clear "planned"/"removed" headings:** tried, in effect,
by the `personal` section — it was clearly labelled "not yet defined, and not
currently selectable" and was still treated as live design input. Section
headings do not survive the way a document is actually consumed, which is in
fragments, by readers looking for rules.
**Consequence:** STANDARDS.md gets shorter over time rather than longer, and
"why is this gone / why isn't this here" is always answerable — but only from
this file. That makes `docs/decisions.md` load-bearing for comprehension, not
just for provenance: deleting an entry here now destroys the only record. Also,
anything moved out of STANDARDS.md must be moved *into* here in the same
change, not just deleted.

## 2026-08-03: `Plan.version: 2` designed once, covering the feature path too
**Context:** idea-workflow's `orchestrator/src/plan.ts` defines `CopierAnswers`
as an exact mirror of this repo's `copier.yml`. Changing the questions changes
that interface — and it is a versioned contract whose instances live in Jira
comments that can be weeks old, so it needs a version bump rather than a
silent edit. Separately, that repo's own backlog has `request_type: "feature"`
(D4), for which `plan.copier` is meaningless because no project is scaffolded.
Bumping for capabilities now and again for `feature` later would leave three
readable plan shapes.
**Decision:** design v2 once, here, covering both. v2 replaces
`flavor: 'core' | 'demo'` with `flavor: 'core' | 'prototype'`, adds `needs_api`
and `needs_ui`, and makes the plan a discriminated union on `request_type`:
`new_tool` carries `copier`, `feature` carries `target: { repo, base_branch }`.
`parsePlan` keeps reading v1 by normalizing it forward — v1 had no
`needs_api`/`needs_ui` and always generated both, so both default to `true`,
and `flavor: "demo"` maps to `core`. D4 implements the `feature` branch; it
does not get to change the shape again.
**Why normalize v1 forward rather than keep a union over versions:** downstream
(`scaffold.ts`, `phase-b.ts`) should only ever see the current shape. Two
readable input shapes, one working shape.
**Consequence:** the full reasoning and the parser live in idea-workflow's
`orchestrator/src/plan.ts` and its `docs/decisions.md` — this entry exists
because the *cause* was a change here, and a future session changing
`copier.yml` needs to find out from this repo that a cross-repo contract moves
with it.

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
