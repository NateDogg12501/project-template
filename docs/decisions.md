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
out in the generated `terraform/README.md`. **Superseded 2026-08-04:** that
allowlist is a denylist now; see the entry at the bottom of this file. The
rest of this entry stands. The script falls back to `npm
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
**Amended 2026-08-04:** that next change happened, and the bet paid — adding
vitest to UI was an edit to an existing job rather than an argument about
whether the frontend deserved one.
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

## 2026-08-04: Every capability ships a real test suite, its own `vitest.config.js`, and a committed lock file
**Context:** the capability contract above says a capability owns its files,
its tests, and its CI job — but neither shipping capability actually had tests.
`backend/package.json` carried `"test": "echo \"no tests yet\" && exit 0"` and
the `backend` CI job ran `npm test --if-present`, so the API job was green by
construction. The `frontend` job was `node --check`, chosen honestly at the
time because `frontend/` had no runner at all. Separately,
`idea-workflow-example-1` hit a **silent** vitest failure: with no
`vitest.config.js` in the package, vitest searched upward, found a config
belonging to an unrelated parent directory, and reported "No test files found"
while exiting 0.
**Decision:** API ships a supertest suite against `/api/health` and the static
mount; UI ships a jsdom suite driving the real `frontend/index.html`. Each
package gets its own `vitest.config.js` — including `frontend/`, which is now
an npm package rather than three loose files. CI runs plain `npm test` in both,
not `--if-present`. And `_tasks` runs `npm install` in each generated package
*before* the first commit, so `package-lock.json` is in it.
**Why real assertions rather than a placeholder test:** a placeholder proves
nothing about the part that actually costs time later — config discovery,
supertest setup, import paths, which DOM globals exist. Those are wrong or
right on day one and stay that way; the second person to write a test in a
generated project should be adding a case to a working harness, not debugging
one. The suites are small but every assertion is load-bearing: the backend's
`WEB_DIST` test is the exact failure that reached production in
`idea-workflow-example-1`, and the frontend's tests parse the real shipped
`index.html` so renaming `#status` fails in CI rather than in a browser.
**Why ship `vitest.config.js` when its contents are near-default:** because the
failure it prevents is silent. A missing config does not error; it produces a
green run that tested nothing, which is strictly worse than a red one. Both
files carry a comment saying so, since "this file is basically empty" is
exactly the reasoning that would delete them. (The upward search itself is a
vitest behaviour we are only working around here — fixing the root cause,
i.e. not leaving stray configs above generated projects, is separate.)
**Why `npm install` moved into `_tasks`:** both npm CI jobs use `npm ci`, which
fails outright without a lock file, and a scaffolded project should be able to
run its own tests before anyone reads the README. That does put build work in
`_tasks`, which the path-name-gating entry above had reduced to git/gh work —
the distinction that matters there is that tasks must not *prune* files, since
tasks don't run on `copier update`. Installing does not prune, and a project
being updated already has its lock files.
**Why the frontend stayed a classic `<script>` rather than becoming an ES
module:** modules would have made the test's import path prettier, but
`file://` refuses module imports, and a UI-only project's README tells you to
open `frontend/index.html` in a browser. `app.js` hangs its functions off
`window` instead, which works unchanged in the browser and under vitest's
jsdom environment (where `window` is the module global). The template's
zero-build-step commitment is what makes this the cheap option; a project that
grows a bundler should revisit it.
**Consequence:** `copier copy` now needs `npm` and network access before its
first commit, alongside the existing `gh` dependency — a failure there leaves
the project generated but uncommitted, before any remote is touched. Generated
`backend/` gained a `.dockerignore`, because `Dockerfile`'s `COPY . .` would
otherwise copy the host's dev-dependency `node_modules` over the production
install it just did. And `frontend/` now contains files that must not be
deployed, which is what forced the next entry.

## 2026-08-04: `build-lambda.js` excludes a fixed set from `frontend/` instead of listing what to include
**Context:** the script copied `['index.html', 'app.js', 'styles.css']` by
name. Adding a static asset and forgetting to add it to that list produces a
file that works locally — where it is served straight off disk — and 404s only
in production. The hazard was documented in two places (the generated
`terraform/README.md` had an "Adding static assets" section about it, and so
did this log). Needing two warnings for one list is a statement about the
design, not about the documentation.
**Decision:** copy `frontend/` wholesale minus a known set — `node_modules`,
`package.json`, `package-lock.json`, `test`, `vitest.config.js` — matched
against top-level entries only.
**Why this fails the safe way:** the allowlist's failure mode is a missing
asset discovered in production; the denylist's is an extra file in the bundle,
discovered by looking. More importantly the two lists grow differently: an
allowlist grows with every asset a project adds, forever, in every project,
while the exclusions are the frontend package's own tooling — a fixed set that
changes only when the *template* changes.
**Why top-level only:** the excluded names are things that live directly in
`frontend/`. Matching them at any depth would mean a project's `img/test/`
directory of fixtures-shaped assets silently doesn't deploy, which is the
allowlist's failure mode wearing a different hat.
**Consequence:** anything left in `frontend/` gets published — a scratch file,
a stray export, an API key someone parked there. That is the trade being made:
visible clutter over invisible absence. If the frontend ever grows a build
step, the right move is not to extend this list but to copy the build output
directory instead, at which point the question disappears.

## 2026-08-04: CI fails a generated project whose `CLAUDE.md` still has skeleton placeholders
**Written after the fact.** The gate shipped in `b0f63d5` (PR #5) without an
entry here, which the "How standards get added" rule requires; this
reconstructs the reasoning from that commit and PR rather than from the session
that made the call, so treat the *why nots* below as re-derived rather than
recorded.
**Context:** `template/CLAUDE.md.jinja` ships seven bracketed prompts —
`[Expand: what stack...]`, `[Things that must stay true...]`, and so on — that
a project is supposed to replace with real content. Nothing checked. A project
could therefore reach production with the skeleton intact, which is worse than
having no `CLAUDE.md`: an empty file tells you nothing, while a file full of
instructions addressed to whoever scaffolded the project reads, to a later
session, like a description of the project itself.
**Decision:** an unconditional `claude-md` job in the generated
`.github/workflows/ci.yml` greps `CLAUDE.md` for the skeleton's literal
bracketed phrases and fails the build if any survive.
**Why unconditional rather than owned by a capability:** every other job in
that workflow is gated on a capability flag, per the contract above.
`CLAUDE.md.jinja` renders for every project regardless of which capabilities
are on, so there is no flag to gate this on — the job belongs to the template
itself. That makes it the second documented exception to "a capability owns its
CI job" (the first being DATABASE riding HOSTED's `terraform` job), and worth
naming as one so a future reader doesn't take it as precedent for ungated jobs
generally.
**Why matching literal skeleton phrases rather than any `[...]`:** a general
bracket match would fire on every markdown link and every array literal in a
fenced block, which is most of a filled-in `CLAUDE.md`. The cost is coupling:
the grep pattern in `ci.yml.jinja` and the placeholder wording in
`CLAUDE.md.jinja` are one thing split across two files, and changing a
placeholder's opening words without changing the pattern silently disables the
check for that section. This was hit immediately — the very next change
replaced the `[What's tested...]` placeholder in Testing conventions with real
content plus an `[Expand: ...]` prompt, which happens to still match. It
matched by luck, not by design.
**What it does not catch:** deleting a section outright instead of filling it
in, and filling a section with text that is technically not the placeholder but
says nothing. It checks that the skeleton was *touched*, not that what replaced
it is true — which is the honest limit of any grep-shaped gate on prose.
**Consequence:** a generated project's CI is red from its first push until
someone fills the file in. That is the intended pressure, and it is why the job
has to stay ungated: the moment it is conditional on something, the condition
becomes the way out of it.

## 2026-08-05: "Prompts are product, not config" promoted into STANDARDS.md
**Context:** `idea-workflow`'s CLAUDE.md carried this as a local architecture
invariant. It is the sharpest framing anywhere in the pipeline for a problem
that is not specific to that repo — and STANDARDS.md, which is where rules
every project inherits live, said nothing about prompts at all. As more
projects lean on agent-facing files, the rule was in the one place least likely
to be read by whoever needs it next.
**Decision:** Promoted it to a subsection under Documentation, keeping
`idea-workflow`'s wording as the anchor and adding the distinction that makes
the rule non-obvious: the three documents above it (`README.md`, `CLAUDE.md`,
`docs/decisions.md`) are read *opportunistically*, by an agent that happens to
be in the repo, while a prompt is injected *deterministically*, every run.
Same file format, entirely different blast radius — which is why one gets PR
review and the others get a standing instruction.
**Why the `assumptions` example specifically:** an abstract rule about prompt
discipline is easy to nod at and ignore. That line is a case where deleting one
sentence leaves every mechanical signal green — `parsePlan` still validates
since `assumptions` is optional, tests pass, a plan still posts and still
builds — while silently disabling the Spec Review gate, since a human cannot
catch a guess the architect stopped reporting. It makes "fails plausibly"
concrete instead of theoretical.
**Why not also demand prompt evals:** the honest state is that judging a prompt
means a human reading output from tickets whose good result they already know.
Writing "add evals" into a standard nobody is resourced to satisfy produces a
rule that gets skipped, which devalues the rest of the file. The standard asks
for what is actually done today: PR review, no mid-run edits, and a decisions
entry when the agent's purpose changes. `orchestrator/test/architect-prompt.test.ts`
is cited as the counterpart that *can* be automated — it pins the untrusted-data
fence's position, the tag vocabulary matching what the code exports, and plan
version consistency. Structure, not quality; the standard says so explicitly so
nobody mistakes a green suite for a good prompt.
**Consequence:** any future repo in this pipeline that ships agent-facing
prompt files inherits this rule, and STANDARDS.md now has an opinion about a
fourth documentation layer it previously did not name.

## 2026-08-08: Generated projects keep Terraform state in S3, bootstrapped by a separate root config
**Context:** generated `terraform/` had no backend block at all — implicit local
state, in one person's working copy. No locking, no history, and one lost or
clobbered file between the project and a Lambda, a Function URL, a log group and
(with DATABASE) a table that Terraform can then neither see nor destroy. The
piece that was missing was a bucket to put state in that didn't violate the
Always Free standard; `terraform-modules` v2.1.0 added `s3-bucket`, and S3's
Free Tier stopped expiring after 12 months in mid-2024 (5GB storage, 20,000 GET,
2,000 PUT per month, perpetual), which is what makes a state bucket free at all.
**Decision:** `terraform/backend.tf` holds a `backend "s3"` block (`key =
"terraform.tfstate"`, `encrypt = true`, `use_lockfile = true`). The bucket it
points at is created by `terraform/bootstrap/`, a separate root config with
local state whose entire content is a `module "tf_state"` call to `s3-bucket` at
its defaults. `required_version` goes `>= 1.5` → `>= 1.10`. Two new
HOSTED-gated `copier.yml` questions supply the two values a backend block
cannot compute: `state_bucket_name` (default `{{ project_slug }}-tfstate`) and
`aws_region`.
**Why a separate bootstrap config, not one config doing both:** the
chicken-and-egg has exactly one other answer — apply the bucket with local
state, then `terraform init -migrate-state` the same config onto the backend it
just created. That works once, per environment, if done in the right order, and
leaves the config *containing its own state bucket*: `terraform destroy` then
tries to delete the bucket holding the state of the destroy. A directory nobody
has to touch again beats a ritual nobody performs twice.
**Why `use_lockfile` and not a DynamoDB lock table:** the lock table is a second
always-free resource, a second thing to name, and a second thing to forget at
teardown — and it would spend 5/5 of the 25 RCU/WCU allowance that is shared
per account+region across every project. `dynamodb_table` on the S3 backend is
deprecated in favour of native locking anyway. The cost is the `>= 1.10` floor,
which CI does not feel (`setup-terraform` installs latest) and which only shows
up on a contributor's laptop.
**Why the same two values are literals in two files:** backend blocks cannot
interpolate — not `var.`, not locals, not `${}`. Copier is the only layer that
can put one answer in two places, which is exactly what a template is for. The
alternative, a partial backend plus a gitignored `-backend-config` file, moves
the values out of version control to avoid duplicating them.
**Why bumping `lambda-web-app` and `dynamodb-single-table` v1.2.0 → v2.1.0
needs no `terraform import`:** the single-tag rule below drags them along, since
`s3-bucket` only exists at v2.1.0. v2.0.0 is breaking *only* for an environment
already deployed on v1.x, where Lambda auto-created the CloudWatch log group the
module now declares and the first apply hits `ResourceAlreadyExistsException`. A
freshly generated project has applied nothing, so there is no group to adopt.
v2.0.0 adds no required variables: `retention_in_days` defaults to 14, and
`dynamodb-single-table`'s new `cost_acknowledged` defaults to false with a
precondition the template's configuration (PROVISIONED, 5/5, no GSIs) never
trips. Incidentally this makes STANDARDS.md's claim about `lambda-web-app`
setting a 14-day retention default true of what the template actually pins,
which at v1.2.0 it was not.
**Why bootstrap's state stays local and gitignored:** committing state to git
for the sake of one bucket teaches the habit for the case where state does hold
secrets, and puts a lineage/serial JSON blob in the merge path.
`.gitignore`'s patterns are unanchored, so `terraform/bootstrap/terraform.tfstate`
was already ignored before this change; what was *not* ignored, and now is, is
`errored.tfstate` — the full state Terraform dumps beside the config when a
*remote* push fails, which only became possible with a remote backend.
**Consequence:** a hosted project's first deploy is two applies, in order.
`terraform init` in `terraform/` fails with `NoSuchBucket` until bootstrap has
run — recoverable, nothing half-done. Teardown is now asymmetric and order
matters: destroy `terraform/` first, and the state bucket deliberately survives
`terraform destroy` (`force_destroy = false` plus versioning, so emptying it is
an affirmative act). Destroying that bucket while `terraform/`'s state is in it
strands everything the state described, and nothing fails loudly when you do.
Losing bootstrap's local state breaks nothing deployed, but re-applying it fails
`BucketAlreadyOwnedByYou`; recovery is importing the module's eight resources
(`module.tf_state.aws_s3_bucket.this`, `_versioning`,
`_server_side_encryption_configuration`, `_ownership_controls`,
`_public_access_block`, `_lifecycle_configuration.this[0]` — `count`-gated —
and `_policy.require_tls`), all keyed on the bucket name; or leaving the bucket
unmanaged, which costs nothing until you need to change it. Every hosted project
now has two `.terraform/` trees and downloads the AWS provider twice. `terraform
validate` locally needs `-backend=false`, since a plain `init` now contacts S3.
State history is bounded at 90 days by the module's noncurrent-version expiry —
recovery from a bad apply last week, not an audit trail from last year. And a
project generated before this change needs a bootstrap apply plus `init
-migrate-state`. Its `copier update` is otherwise clean — verified end to end
against a tagged pre-change template — with one exception, which is the one that
matters: a project that hand-edited `terraform/variables.tf`'s region gets a
merge conflict there, because this change adds a comment to that file. The
conflict lands exactly where the trap is, since such a project also has
`aws_region` recomputed to `us-east-1` in `.copier-answers.yml` (a `when`-skipped
question resolves to its default but records nothing), and would otherwise end up
with resources in one region and state in another. Set that key in the answers
file before updating.

## 2026-08-08: All Terraform in a generated project derives from terraform-modules, checked in CI
**Context:** STANDARDS.md already asked for the shared modules "rather than
hand-writing Lambda/DynamoDB resources again" — a preference, in prose,
unenforced, and scoped to the two resource kinds that happened to exist when it
was written. The state bucket was the first real test of it, and it is precisely
the case where hand-writing is easier: eight resources, one of them an IAM
policy document, versus a change in another repo plus a tag release. A rule that
loses that trade every time it is tested is not a rule.
**Decision:** generalise the bullet to all Terraform — a root config wires
pinned modules together and does not declare AWS resources of its own — add the
rule that one project pins one tag across its whole config, and enforce the
mechanical half in the generated `terraform` CI job: a `source =` in any `*.tf`
that is not a tag-pinned `terraform-modules` reference fails the build.
**Why not ban `resource "aws_…"` outright:** `aws_iam_role_policy.app_table_access`
exists on purpose. The modules deliberately leave cross-module IAM to the
caller, because the module owning the role cannot know what will sit beside it
and the module owning the table cannot attach to a role it does not own.
Banning resource blocks therefore means an allowlist of permitted types, per
project, that someone maintains and that gets widened under deadline pressure.
Sources are the half with one right answer, so that is the half automated, and
the carve-out is named in STANDARDS.md rather than pretended away. The
allowlist check stays available if a project actually drifts.
**Why the check fails when it finds no pinned source:** the two worst
regressions in this pipeline were both green checks that verified nothing — a
vitest run reporting "No test files found" and exiting 0, and `npm test
--if-present` on a package with no test script. A grep-shaped gate degrades the
same way, silently, on any rename or path change. Requiring at least one match
is safe because every hosted project has `module "app"` and `module "tf_state"`.
**Why provider sources are allowlisted by shape rather than by position:** a
registry module source is `NAMESPACE/NAME/PROVIDER`; a provider shorthand is
`NAMESPACE/NAME`. Two segments can only be a provider, so the pattern needs no
notion of which block a line sits inside — and a genuine registry module source
still fails, which is the intent.
**Consequence:** adding an AWS resource to a generated project now starts in
another repo and ends in a tag release. That is deliberately more expensive than
writing a resource block, and it is the point: the resource ends up somewhere
the next project inherits it, with the gotcha already solved. The check hardcodes
`terraform-modules`' clone URL and its `?ref=vX.Y.Z` shape — which
idea-workflow's module preflight also parses — so renaming or moving that repo
breaks the CI of every generated project at once. And it is a format check: it
cannot tell that a pinned module is the *right* module, and it cannot see a
hand-written resource at all.

## 2026-08-09: kids-ledger named as the flagship project
**Context:** Four repos work as one system (terraform-modules, project-template,
idea-workflow, kids-ledger), with patterns tested in one project and then
promoted into the template for all to inherit. Nothing in the pipeline currently
says which project is the trial ground, so a future session has no way to know
that kids-ledger's decisions log carries more weight than any other project's.
**Decision:** name kids-ledger as the flagship explicitly in STANDARDS.md's new
"The flagship loop" section. New patterns get trialled there first; its
`docs/decisions.md` is the evidence layer for a standard.
**Why not leave it implicit:** explicit naming prevents sessions from treating
every project's decisions log equally and accidentally promoting one project's
specific needs into a template rule. The discipline of "trial in kids-ledger
first, then ask if it generalizes" is only effective if sessions know which
project is the trial ground.
**Why not spread trial projects across multiple repos:** concentrating the
trial work in one place keeps the feedback loop tight and makes pattern-spotting
easier. Adding a second trial project later, if needed, is a separate decision.
**Consequence:** kids-ledger's `docs/decisions.md` becomes a loaded document —
entries there are read as proposals to the standard, not just as project history.
Future work wiring kids-ledger's decisions into the promotion loop will
reference this entry as the decision to name it so.

## 2026-08-09: Cross-repo design documents live in project-template/docs/
**Context:** The four-repo CD pipeline required a design document that spans
all four projects and belongs to none of them individually. Having no single home
for such documents meant it either lived in a scratchpad directory (undiscoverable
by future sessions) or got duplicated across repos (creating maintenance drift).
**Decision:** `project-template/docs/` is the home for multi-repo design
documents. project-template is already the root of cross-project truth
(STANDARDS.md lives here; all projects link to it), so extending it to hold
cross-repo architectural documents is a natural fit.
**Why not a separate docs repo:** an extra repo adds a burden on every PR
that affects multiple repos — coordinating changes across four+ repos plus
a docs repo, rather than keeping docs and changes in the same place. It also
makes the relationship between a decision and the docs that record it less
obvious to someone reading the code later.
**Why not scatter cross-repo docs in the individual repos:** a document that
spans four repos has four equally-plausible homes, so sessions would have to
search all of them to be sure it exists. One canonical home is discoverable.
**Consequence:** changes to cross-repo design documents land in project-template
PRs, so STANDARDS.md and `docs/decisions.md` updates travel with them. Each
repo's CLAUDE.md points to this repo's STANDARDS.md (already the case); a future
repo that needs to reference the CD pipeline will link to
`project-template/docs/cd-pipeline.md` from its own CLAUDE.md or README.

## 2026-08-09: DynamoDB Local for the DATABASE capability's local parity; DATABASE earns its own CI job
**Context:** a generated DATABASE project had no way to run `docker compose up`
against anything but real AWS DynamoDB — `backend/` had no client-construction
code at all, so nothing exercised a read/write path without live AWS
credentials, which made a fresh clone unrunnable and gave CI nothing to test
data-shaped behaviour against. LocalStack was the obvious first candidate —
it's what most projects reach for — but its OSS repo was archived on
2026-03-23 and Community Edition ended: every image now sits behind mandatory
auth, with core services behind a paid plan. LocalStack ran DynamoDB Local
underneath for DynamoDB anyway, so going straight to `amazon/dynamodb-local` —
AWS's own image, free forever, no account, no auth token, no license, no
commercial-use restriction — is strictly less machinery for the same result.
**Decision:** added `dynamodb-local` to `docker-compose.yml` (gated on
`needs_datastore`, healthchecked, `backend` depending on it with
`condition: service_healthy` so a cold `compose up` can't race it); a single
client-construction module, `backend/src/dynamodb.js`, that reads
`AWS_ENDPOINT_URL_DYNAMODB` and is the only file in `backend/src/` allowed to
construct a DynamoDB client; and a small init step,
`backend/src/init-table.js`, that recreates the same key schema
`terraform/main.tf`'s `module "table"` declares, run from `src/index.js` only
when `AWS_ENDPOINT_URL_DYNAMODB` is set — never against real AWS, which
Terraform already owns. `dynamodb-local` runs `-inMemory`, so every
`compose up` is a clean slate and there is no volume to gitignore or seed.
DATABASE also gets its own `datastore` CI job, which brings the stack up and
runs a real integration suite (`backend/test/integration/`, its own
`vitest.integration.config.js`, kept out of plain `npm test` via
`vitest.config.js`'s `exclude`) — it used to ride HOSTED's `terraform` job
because Terraform blocks were the only thing it contributed; now it
contributes runnable code and earns the job the capability contract asks for.
It still doesn't get its *own* Terraform validation — the `terraform` job
keeps checking DATABASE's blocks, same as it checks HOSTED's, because both
live in the one directory that job validates wholesale.
**Why not LocalStack:** covered above — for this use case it is now a worse,
extra-auth version of the thing it wraps, not a reason to add a second layer
over the same DynamoDB Local binary.
**Why the endpoint switch and not a repository/adapter abstraction:** a
hand-written data-access layer means local and deployed exercise different
code, and that is exactly where the bugs that matter hide. One env var read in
one file keeps the code path byte-identical either way — see STANDARDS.md's
"Structure".
**Why the healthcheck doesn't use `curl -f`:** verified against the real
`amazon/dynamodb-local:latest` image before writing it (Amazon Linux 2023
base; `curl` is present at `/usr/bin/curl`). A bare `GET /` returns HTTP 400 —
the image only implements the DynamoDB POST API — and `curl -f` treats any
4xx as a failure, so a `curl -f`-based healthcheck would never pass even
though the server is up. `curl -s -o /dev/null http://localhost:8000/`
without `-f` just confirms the port answers, which is all the healthcheck
needs to know.
**Consequence:** `backend/package.json` gains `@aws-sdk/client-dynamodb` and
`@aws-sdk/lib-dynamodb`; `AWS_ENDPOINT_URL_DYNAMODB` and `DYNAMODB_PORT` join
`.env.example` (the latter picked up automatically by
`scripts/setup-worktree-env.js`'s `*_PORT` scan, so concurrent worktrees don't
collide on the published port). `ci.yml.jinja`'s `terraform` job comment no
longer claims DATABASE rides it for everything, since that stopped being
true. A generated project's local table schema (`init-table.js`) and its
Terraform schema (`terraform/main.tf`) are now two definitions of the same
thing that must be changed together — named explicitly in the generated
`CLAUDE.md` rather than hidden, because nothing here keeps them in sync
automatically.

## 2026-08-10: Environment-parameterized Terraform; one shared state bucket replaces per-project bootstrap
**Context:** P03 of the four-repo CD pipeline (`docs/cd-pipeline.md` B1/B2).
Generated `terraform/` had no concept of an environment — resource names were
single literals — and each project created its own state bucket via
`terraform/bootstrap/`, a directory whose only job was that bucket. The
pipeline design settled on two environments per project (`staging`,
`production`) and one shared state bucket for the whole account, created once
in an account-level bootstrap outside this template (P02) rather than per
project.
**Decision:** added `variable "environment"` (`staging` | `production`, no
default, validated) to `terraform/variables.tf`, composed at the root config
into a `locals.name_prefix` used for `module.app`'s `app_name`,
`module.table`'s `table_name`, and the IAM policy name — not passed into
`terraform-modules`, which keeps taking plain strings. `terraform/backend.tf`
became a partial `s3` backend: bucket (`natedogg12501-workflow-tfstate`,
created by P02) and region are literals, `key` is omitted and supplied at
`terraform init -backend-config="key=<project_slug>/<environment>/terraform.tfstate"`.
Removed `state_bucket_name` and its validator from `copier.yml`, and deleted
`terraform/bootstrap/` entirely — every README/CLAUDE.md reference to it
rewritten to describe the shared bucket and IAM-prefix isolation instead. The
`terraform` CI job gained a per-environment `terraform plan` step on pull
requests, assuming `vars.AWS_ROLE_STAGING` via OIDC.
**Why the exact bucket name is a literal here rather than a Copier answer:**
one bucket, named once, ever — the global-namespace uniqueness problem
`state_bucket_name`'s validator existed to catch is solved a single time, by
whoever runs the account bootstrap, not by every project's `copier.yml`
answer. See P02's handback for the bucket name and the account's
provisioner-role/boundary/OIDC-provider ARNs, which P09 (per-project AWS
provisioning) consumes.
**Why `backend.tf`'s `region` is also a hardcoded literal (`us-east-1`)
instead of rendering the project's own `aws_region` answer:** caught during
review — the initial version reused `{{ aws_region }}` for both the backend's
region and the project's own resource region, which was correct before this
change (the project's own bootstrap created its bucket in that same region)
but became a bug once the bucket moved to a fixed, externally-managed
location. A project that picks a non-default `aws_region` for its Lambda
would otherwise render a backend block pointing at the wrong region for the
shared bucket, and `terraform init` would fail to find it.
`copier.yml`'s `aws_region` question and its help text were updated to make
clear it no longer has anything to do with the state bucket.
**Why the `terraform` CI job also gained a Lambda build step:** caught during
review — the new per-environment `terraform plan` step needs `dist-lambda/`
to exist, since `lambda-web-app`'s `lifecycle.precondition` on
`terraform_data.lambda_zip` fails during `plan`, not only `apply`, when
`source_dir` is empty. Added `actions/setup-node@v4` + `npm ci` + `npm run
build:lambda` (working directory `backend/`) before the plan loop, gated the
same as the AWS steps so it only runs when a plan will actually happen.
**Why the staging role plans every environment in CI, not each environment
its own role:** production's OIDC trust policy (P09) pins
`ref:refs/heads/main`, which no pull-request branch can ever satisfy — a
production role literally cannot be assumed from a PR. Using staging's
broader-trust role to plan against production's backend key is the only way
a PR gets a real plan for both environments; it is not a permissions
shortcut, it is the only role a PR is ever able to hold.
**Why `variable "environment"` has no default:** the whole point of
separating `staging` and `production` is that an apply says which one it's
targeting. A default would mean an apply that forgot `-var="environment=..."`
silently lands somewhere instead of failing immediately — the same reasoning
`cost_acknowledged` uses for defaulting to `false`, applied to a different
hazard.
**Consequence:** a project generated before this change has no `environment`
variable, a `state_bucket_name` answer in its `.copier-answers.yml` that no
longer maps to anything in the template, and a `terraform/bootstrap/`
directory `copier update` will not remove on its own (path-name gating
prunes files that would otherwise render, not files a project already has on
disk from a prior render — removing an existing directory is a manual step
or a `_tasks` entry with `_copier_operation == 'update'`, neither added here
since no project has gone through this update yet). Migrating an existing
project — moving its state into the shared bucket, retiring its own bucket,
threading `environment` through already-applied resource names without
recreating them — is real work belonging to whichever phase migrates that
project (`kids-ledger`'s is P10), not something this change does implicitly.
The exact `terraform init -backend-config` invocation a deploy job must use:
`terraform init -backend-config="key=<project_slug>/<environment>/terraform.tfstate"`.
