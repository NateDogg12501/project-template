# project-template

Scaffolds new small full-stack projects: Docker-Composeable locally,
Lambda-deployable on AWS Always Free, with a CLAUDE.md/README/decisions-log
skeleton pre-filled from the start. See [STANDARDS.md](STANDARDS.md) for
the rules this template encodes and what each `flavor` adds.

## What each tool is doing here

- **[Copier](https://copier.readthedocs.io/)** — renders this repo's
  `template/` into a new project directory, and can later re-apply template
  changes into a project it already generated (`copier update`). Why Copier
  specifically: [docs/decisions.md](docs/decisions.md).
- **[terraform-modules](https://github.com/NateDogg12501/terraform-modules)**
  — the actual AWS resources (Lambda, DynamoDB) a hosted project deploys.
  This repo just wires a generated project's `terraform/` to reference it;
  see that repo's own README for what it does and why.

## Install Copier

```bash
pipx install copier   # or: pip install --user copier
```

Free, open source (MIT), fully local — no account or service required.

## Generate a new project

```bash
copier copy gh:NateDogg12501/project-template ../my-new-project
```

`gh:` is Copier's shorthand for a GitHub repo — this pulls straight from
the pushed [NateDogg12501/project-template](https://github.com/NateDogg12501/project-template)
remote (a **remote** is just a saved reference to another copy of a repo
elsewhere — in this case, GitHub, as opposed to the copy on your own disk).
That matters here because it means anyone with access to this repo can
generate a project without a local checkout of `project-template` sitting
around — Copier fetches it itself. (If you *do* have a local checkout you'd
rather use instead — e.g. testing an uncommitted template change — point at
the local path instead: `copier copy . ../my-new-project`, run from inside
this repo. The difference is only where Copier reads the template from;
the questions asked and the output are identical either way.)

You'll be asked for `project_name`, `description`, `flavor` (`core`/`demo`
— see STANDARDS.md's Flavors section for why `personal` isn't offered yet),
and whether it needs hosting/a datastore. The generated repo is `git
init`'d and given a first commit automatically.

## Pull template updates into an already-generated project

```bash
cd my-existing-project
copier update
```

Copier tracks the answers you gave in `.copier-answers.yml` (dropped into
every generated repo) and re-applies template changes as a diff, respecting
whatever you've since changed by hand.

## Repo layout

- `copier.yml` — the questionnaire + task hooks (git init/commit, flavor
  file pruning). Not copied into generated projects.
- `STANDARDS.md` — the durable rules, source of truth, linked (not copied)
  from every generated project's `CLAUDE.md`.
- `template/` — everything that *is* copied, Jinja2-rendered
  (`_subdirectory: template` in `copier.yml`). `.jinja`-suffixed files are
  rendered; everything else is copied verbatim.

## Adding or changing a flavor

See STANDARDS.md's "Flavors" section for the two places a flavor has to be
defined (the `copier.yml` question, and real conditionals in `template/`) —
a flavor that's only a description in `copier.yml` does nothing. Concretely:

1. Add the flavor to `flavor`'s `choices` in `copier.yml`.
2. Give it real content in `template/` — either inline
   `{% if flavor == "yours" %}...{% endif %}` blocks in shared files
   (`CLAUDE.md.jinja`, `README.md.jinja`), and/or whole files that only
   belong to that flavor, pruned for everyone else via a `_tasks` entry
   (see `docs/mock-vs-real.md.jinja` + its `rm -f` task as the pattern).
3. **A flavor can also ask its own questions**, not just branch on content —
   any question in `copier.yml` accepts a `when` condition, the same way
   `needs_datastore` only asks `when: "{{ needs_hosting }}"`. A
   `demo`-only question would look like:
   ```yaml
   mock_target:
     type: str
     help: "Which external dependency does this demo mock?"
     when: "{{ flavor == 'demo' }}"
   ```
4. Log *why* the flavor exists and what it's for in `docs/decisions.md`
   (this repo's, not the generated-project one) — see STANDARDS.md's "How
   standards get added."

**On whether this scales as flavors grow**: with more than two or three
flavors, inline `{% if %}` blocks scattered across shared files would get
hard to read, and Copier's own docs acknowledge this — the documented
answer at that point is composing multiple templates together (a base
template plus a flavor-specific overlay, applied in sequence) rather than
one template with ever-more conditionals. `docs/decisions.md` has the full
reasoning for staying with the simpler inline approach for now — the short
version: two flavors don't justify that complexity yet, and the concrete
trigger for revisiting it is a flavor that needs to *restructure* shared
files rather than just add a section to them.
