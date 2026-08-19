#!/usr/bin/env node
//
// template-update -- run `copier update` against one generated project and
// open a pull request with the result.
//
// This is the mechanism half of P16; `template-doctor.js` is the reporting
// half, and you should run that first to find out whether this is worth doing.
//
// What it will not do, deliberately:
//   - push to a project's `main` (production deploys from it)
//   - auto-merge anything
//   - resolve a conflict in a file the project owns, or in a shared one
//
// Usage:
//   node scripts/template-update.js <project> [--org <org>] [--ref <ref>]
//                                             [--keep] [--no-pr]
//
// Requires `gh` (authenticated, with push rights to the project) and Copier.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ownerOf } = require('./ownership.js');

const DEFAULT_ORG = process.env.PROJECT_ORG || 'natedogg-idea-board';
const REPO_ROOT = path.resolve(__dirname, '..');

// Copier is installed on some machines without a PATH shim, so it is invoked
// as a module. See the READMEs' `pipx install copier` -- that produces a
// `copier` binary, this works either way.
const COPIER = [process.env.PYTHON || 'python', ['-m', 'copier']];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function parseArgs(argv) {
  const args = { org: DEFAULT_ORG, ref: null, keep: false, pr: true };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--org') args.org = argv[++i];
    else if (argv[i] === '--ref') args.ref = argv[++i];
    else if (argv[i] === '--keep') args.keep = true;
    else if (argv[i] === '--no-pr') args.pr = false;
    else if (argv[i].startsWith('--')) throw new Error(`unknown argument: ${argv[i]}`);
    else positional.push(argv[i]);
  }
  if (positional.length !== 1) {
    throw new Error('expected exactly one project name');
  }
  args.project = positional[0];
  return args;
}

/**
 * Strip a Copier inline conflict, keeping one side.
 *
 * Copier writes `<<<<<<< before updating` / `=======` / `>>>>>>> after
 * updating`; plain git writes `<<<<<<< ours` / `>>>>>>> theirs`. Both shapes
 * are accepted because which one appears depends on Copier's version.
 */
function resolveConflicts(text, keep /* 'before' | 'after' */) {
  const lines = text.split('\n');
  const out = [];
  let state = 'clean';
  for (const line of lines) {
    if (/^<{7}(\s|$)/.test(line)) {
      state = 'before';
      continue;
    }
    if (state !== 'clean' && /^={7}(\s|$)/.test(line)) {
      state = 'after';
      continue;
    }
    if (state !== 'clean' && /^>{7}(\s|$)/.test(line)) {
      state = 'clean';
      continue;
    }
    if (state === 'clean' || state === keep) out.push(line);
  }
  return out.join('\n');
}

function hasConflictMarkers(text) {
  return /^<{7}(\s|$)/m.test(text);
}

/** Content-identical once carriage returns are ignored. */
function onlyLineEndingsDiffer(a, b) {
  return a.replace(/\r/g, '') === b.replace(/\r/g, '');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const git = (cwd) => (a) => run('git', a, { cwd });

  // The ref to update to. Resolved here rather than left to Copier: with no
  // tags in the template, Copier's notion of "latest" is a dev version string
  // derived from HEAD, and pinning it explicitly keeps the PR title, the
  // branch name and `.copier-answers.yml` all naming the same commit.
  run('git', ['fetch', 'origin', '--quiet'], { cwd: REPO_ROOT });
  const ref = args.ref || run('git', ['rev-parse', '--short', 'origin/main'], { cwd: REPO_ROOT }).trim();

  // Short base path on purpose: Windows' MAX_PATH is reached surprisingly
  // easily by `.git/objects/...` under a deep temp directory, and git fails
  // with "Filename too long" mid-clone even with core.longpaths set.
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tu-'));
  const dir = path.join(workRoot, args.project);
  const g = git(dir);

  try {
    console.log(`Cloning ${args.org}/${args.project} ...`);
    run('git', [
      'clone',
      '--quiet',
      // Both are required, and for different reasons. `longpaths` keeps the
      // clone itself from failing; `autocrlf=false` is what keeps the update
      // reviewable -- with a CRLF working tree every line of every
      // builder-touched file differs from Copier's LF output and each one
      // becomes a whole-file conflict. See STANDARDS.md, "Template ownership".
      '-c', 'core.longpaths=true',
      '-c', 'core.autocrlf=false',
      `https://github.com/${args.org}/${args.project}.git`,
      dir,
    ]);

    const answersPath = path.join(dir, '.copier-answers.yml');
    if (!fs.existsSync(answersPath)) {
      throw new Error(`${args.project} has no .copier-answers.yml -- not generated from this template`);
    }
    const from = (fs.readFileSync(answersPath, 'utf8').match(/^_commit:\s*(\S+)/m) || [])[1];
    if (from === ref) {
      console.log(`${args.project} is already at ${ref}; nothing to do.`);
      return 0;
    }

    const branch = `chore/template-update-${ref}`;
    g(['checkout', '--quiet', '-b', branch]);

    console.log(`Updating ${from} -> ${ref} ...`);
    const [copierCmd, copierArgs] = COPIER;
    run(copierCmd, [...copierArgs, 'update', '--vcs-ref', ref, '--defaults', '--trust', '--conflict', 'inline'], {
      cwd: dir,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    // Sort every touched path into: a real change, a conflict, or pure
    // line-ending churn from Copier's own clone of the template (which
    // inherits the machine's autocrlf for static, non-Jinja files).
    const status = g(['status', '--porcelain']).split('\n').filter(Boolean);
    const changed = [];
    const conflicted = [];
    const noise = [];

    for (const entry of status) {
      const code = entry.slice(0, 2);
      const file = entry.slice(3).trim();
      if (code === 'UU' || code.includes('U')) {
        conflicted.push(file);
        continue;
      }
      const abs = path.join(dir, file);
      if (!fs.existsSync(abs)) {
        changed.push(file);
        continue;
      }
      const now = fs.readFileSync(abs, 'utf8');
      let head = '';
      try {
        head = g(['show', `HEAD:${file}`]);
      } catch {
        changed.push(file);
        continue;
      }
      if (onlyLineEndingsDiffer(now, head)) noise.push(file);
      else changed.push(file);
    }

    // Ownership decides what may be resolved automatically.
    const autoResolved = [];
    const needsHuman = [];
    for (const file of conflicted) {
      const owner = ownerOf(file);
      if (owner === 'template' || owner === 'copier') {
        const abs = path.join(dir, file);
        fs.writeFileSync(abs, resolveConflicts(fs.readFileSync(abs, 'utf8'), 'after'));
        autoResolved.push(file);
        changed.push(file);
      } else if (owner === 'project') {
        // The template changed a file it has no claim on. That is a template
        // bug, not something to paper over in a project's PR.
        throw new Error(
          `refusing to update: the template wants to change project-owned "${file}".\n` +
            'Fix the template so it stops touching this path, then re-run.',
        );
      } else {
        needsHuman.push(file);
        changed.push(file);
      }
    }

    // Discard line-ending-only churn rather than committing ~20 files with no
    // content change, which is enough to make the diff unreadable.
    for (const file of noise) g(['checkout', '--', file]);

    // Normalise the files that *are* changing to LF, so the update never
    // introduces CRLF into blobs that were LF before it ran.
    for (const file of changed) {
      const abs = path.join(dir, file);
      if (!fs.existsSync(abs)) continue;
      const buf = fs.readFileSync(abs);
      if (buf.includes(0x0d)) fs.writeFileSync(abs, buf.toString('utf8').replace(/\r/g, ''));
    }

    if (changed.length === 0) {
      console.log('No content changes after discarding line-ending churn; nothing to propose.');
      return 0;
    }

    g(['add', '--', ...changed]);

    const unresolved = needsHuman.length > 0;
    const summary = [
      `Update from project-template ${from} -> ${ref}`,
      '',
      'Generated by `copier update`.',
      '',
      autoResolved.length
        ? `Template-owned files resolved to the template's version:\n${autoResolved.map((f) => `  - ${f}`).join('\n')}`
        : '',
      unresolved
        ? `CONFLICT MARKERS LEFT IN PLACE for a human -- these paths are shared\nbetween template and project, so neither side may win automatically:\n${needsHuman.map((f) => `  - ${f}`).join('\n')}`
        : '',
      noise.length ? `Discarded ${noise.length} line-ending-only change(s).` : '',
      '',
      'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>',
    ]
      .filter(Boolean)
      .join('\n');

    const msgFile = path.join(workRoot, 'msg.txt');
    fs.writeFileSync(msgFile, `${summary}\n`);
    g(['-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-F', msgFile]);

    console.log('');
    console.log(g(['show', '--stat', '--oneline', 'HEAD']));

    if (!args.pr) {
      console.log(`--no-pr given; branch "${branch}" left in ${dir}`);
      return 0;
    }

    g(['push', '--quiet', '-u', 'origin', branch]);

    const bodyFile = path.join(workRoot, 'body.md');
    fs.writeFileSync(
      bodyFile,
      [
        `Generated by \`copier update\`, from template ref \`${from}\` to \`${ref}\`.`,
        '',
        unresolved
          ? '> **This PR contains unresolved conflict markers and is opened as a draft.**\n> The paths below are shared between the template and this project, so the\n> mechanism will not pick a side. Resolve them, then mark ready for review.\n'
          : '',
        autoResolved.length
          ? `## Template-owned files, resolved to the template's version\n\n${autoResolved.map((f) => `- \`${f}\``).join('\n')}\n\nThese are pipeline infrastructure. If a project-specific edit was lost\nhere, that is what this PR is for — say so rather than merging.\n`
          : '',
        needsHuman.length
          ? `## Needs a human\n\n${needsHuman.map((f) => `- \`${f}\``).join('\n')}\n`
          : '',
        `## Everything else\n\n${changed
          .filter((f) => !autoResolved.includes(f) && !needsHuman.includes(f))
          .map((f) => `- \`${f}\``)
          .join('\n') || '_(none)_'}\n`,
        noise.length
          ? `${noise.length} file(s) differed only by line endings and were discarded rather than committed.\n`
          : '',
        'Not auto-merged by design — see project-template `STANDARDS.md`, "Template ownership".',
        '',
        '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    const prArgs = [
      'pr', 'create',
      '--repo', `${args.org}/${args.project}`,
      '--base', 'main',
      '--head', branch,
      '--title', `Update from project-template ${from} -> ${ref}`,
      '--body-file', bodyFile,
    ];
    if (unresolved) prArgs.push('--draft');
    const url = run('gh', prArgs, { cwd: dir }).trim();
    console.log('');
    console.log(url);
    if (unresolved) console.log('Opened as a DRAFT: unresolved conflicts need a human.');
    return 0;
  } finally {
    if (args.keep) console.log(`(kept working copy: ${workRoot})`);
    else fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

try {
  process.exit(main());
} catch (err) {
  console.error(`error: ${err.message}`);
  if (err.stderr) console.error(err.stderr.toString());
  process.exit(1);
}
