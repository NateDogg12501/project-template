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
