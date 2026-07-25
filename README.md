# project-template

A [Copier](https://copier.readthedocs.io/) template for spinning up new
small full-stack projects: Docker-Composeable locally, Lambda-deployable on
AWS Always Free via [`terraform-modules`](../terraform-modules), with a
CLAUDE.md/README/decisions-log skeleton pre-filled from the start. See
[STANDARDS.md](STANDARDS.md) for the rules this template encodes and what
each `flavor` adds.

## Install Copier

```bash
pipx install copier   # or: pip install --user copier
```

Free, open source (MIT), fully local — no account or service required.

## Generate a new project

```bash
copier copy . ../my-new-project
# or, once this repo has a remote:
copier copy gh:<you>/project-template ../my-new-project
```

You'll be asked for `project_name`, `description`, `flavor`
(`core`/`demo`/`personal`), and whether it needs hosting/a datastore. The
generated repo is `git init`'d and given a first commit automatically.

## Pull template updates into an already-generated project

```bash
cd my-existing-project
copier update
```

Copier tracks the answers you gave in `.copier-answers.yml` (dropped into
every generated repo) and re-applies template changes as a diff, respecting
whatever you've since changed by hand. This is the feature that makes this
worth using over Cookiecutter — templates here are meant to evolve.

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
a flavor that's only a description in `copier.yml` does nothing.
