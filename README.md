# project-template

Scaffolds new small full-stack projects: Docker-Composeable locally,
Lambda-deployable on AWS Always Free, with a CLAUDE.md/README/decisions-log
skeleton pre-filled from the start. You pick a set of **capabilities** (API,
UI, HOSTED, DATABASE) rather than a project type; see
[STANDARDS.md](STANDARDS.md) for what each one brings and the rule that
holds them together.

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

You'll be asked for `project_name`, `description`, a preset (`flavor`:
`core` or `prototype`), and then one question per capability — API, UI,
HOSTED, DATABASE. The preset only moves those four defaults; you can
override any of them. The generated repo is `git
init`'d, has `npm install` run in each of its packages so the lock files land
in the first commit, is committed, and is pushed to a new **private** GitHub
repo (named after `project_slug`) under your authenticated `gh` account —
automatically. Requires `npm` and the [GitHub CLI](https://cli.github.com/)
(`gh`), authenticated (`gh auth login`), before you run `copier copy`. The
result is a project whose `npm test` passes immediately, with no setup step
between generating it and running it.

## Pull template updates into an already-generated project

```bash
cd my-existing-project
copier update
```

Copier tracks the answers you gave in `.copier-answers.yml` (dropped into
every generated repo) and re-applies template changes as a diff, respecting
whatever you've since changed by hand.

## Repo layout

- `copier.yml` — the questionnaire + task hooks (git init/commit, `gh repo
  create`). Not copied into generated projects.
- `STANDARDS.md` — the durable rules, source of truth, linked (not copied)
  from every generated project's `CLAUDE.md`.
- `docs/` — cross-repo design documents and the template's own decisions log.
  [`cd-pipeline.md`](docs/cd-pipeline.md) is the requirements and phasing
  guide for the continuous deployment pipeline spanning four repos.
- `template/` — everything that *is* copied, Jinja2-rendered
  (`_subdirectory: template` in `copier.yml`). `.jinja`-suffixed files are
  rendered; everything else is copied verbatim. **Directory and file names
  are rendered too**, which is how capabilities gate whole subtrees — see
  below.

## Adding a capability

STANDARDS.md's "Capabilities" section has the contract: a capability owns
its files, its tests, *and* its CI job, and none of the three is optional.
Mechanically:

1. Add a `needs_<thing>` bool question to `copier.yml`. If it depends on
   another capability, express that with `when:` plus a `default:` that
   repeats the condition (see `needs_hosting`), and add a `validator:` for
   anything `when:` can't express.
2. Put its files under `template/` inside a path whose **name** is the gate:
   ```
   template/{{ 'terraform' if needs_hosting else '' }}/main.tf.jinja
   ```
   Copier renders path names, and a name that renders to the empty string is
   skipped along with everything under it. This works on `copier update` as
   well as `copier copy` — the `rm -rf` `_tasks` it replaced only ran on the
   first copy, so an update would resurrect files a project had turned off.
   Verified against Copier 9.17.0; see `docs/decisions.md`.
3. Sections *inside* files everyone gets (`README.md.jinja`,
   `CLAUDE.md.jinja`, `.github/workflows/ci.yml.jinja`) stay inline
   `{% if needs_thing %}` blocks — a whole-file gate would mean two copies
   of a mostly identical file.
4. Give it its own tests, inside its own gated path — and ship a
   `vitest.config.js` alongside them if it's an npm package. Without one in
   the package itself, vitest searches upward, may find an unrelated config,
   and reports "No test files found" while exiting 0.
5. Give it a job in `template/.github/workflows/ci.yml.jinja`, gated on the
   same flag, running `npm test` (not `--if-present`, which is how a
   capability with no tests stayed green for months).
6. **A capability can also ask its own questions** — any `copier.yml`
   question accepts `when:`, the way `needs_datastore` only asks
   `when: "{{ needs_hosting }}"`, and HOSTED's `aws_region` does the same.
   Two things about a skipped question: it still
   resolves to its rendered default, so no template can hit an undefined
   variable — but it gets **no line in `.copier-answers.yml`**. Turning the
   capability on later therefore recomputes those answers from their defaults,
   silently, unless they're written into the answers file in the same edit.
7. Log why it exists in `docs/decisions.md` (this repo's, not the
   generated-project one) — see STANDARDS.md's "How standards get added."

Then update `CopierAnswers` in
[idea-workflow](https://github.com/NateDogg12501/idea-workflow)'s
`orchestrator/src/plan.ts` and the architect prompt that writes it. That
interface mirrors `copier.yml` exactly and is versioned, because its
instances live in Jira comments that may be weeks old — adding a required
answer is a `Plan.version` bump.

## Adding a preset

A preset (the `flavor` question) is a named bundle of capability *defaults*
and owns no files. Adding one is a new entry in `flavor`'s `choices`, the
capability defaults that reference it, a line in STANDARDS.md's "Presets",
and a `docs/decisions.md` entry. If it needs files of its own, it is not a
preset — it is a capability.
