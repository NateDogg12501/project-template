#!/usr/bin/env node
//
// template-doctor -- report which generated projects are behind the template,
// and whether the commits they are missing actually touch anything they own.
//
// This exists because of P12. A bug in the template's `ci.yml.jinja` broke CI
// on every hosted project; the fix landed here and reached nothing. Nobody
// could have said which projects were carrying the broken file, because
// nothing could answer the question. This answers it.
//
// Reporting is deliberately the whole of this script. It does not update
// anything, so it is safe to run against live projects at any time, and it is
// a prerequisite for any propagation mechanism -- you cannot sensibly update
// what you cannot enumerate.
//
// Usage:
//   node scripts/template-doctor.js [--org <org>] [--verbose] [--json]
//
// Requires `gh` (authenticated) and a local clone of this repo with an
// `origin` remote. Reads only; never writes to a project.

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { templatePathToProjectPath, ownerOf } = require('./ownership.js');

// The org generated projects are created in -- copier.yml's `github_owner`
// answer. Overridable because the template itself lives under a different
// owner, and there is no way to derive one from the other.
const DEFAULT_ORG = process.env.PROJECT_ORG || 'natedogg-idea-board';

const REPO_ROOT = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function tryRun(cmd, args, opts) {
  try {
    return { ok: true, out: run(cmd, args, opts) };
  } catch (err) {
    return { ok: false, out: '', err: (err.stderr || err.message || '').toString().trim() };
  }
}

function parseArgs(argv) {
  const args = { org: DEFAULT_ORG, verbose: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--org') args.org = argv[++i];
    else if (argv[i] === '--verbose' || argv[i] === '-v') args.verbose = true;
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

/**
 * `_commit` only tells you what a project was generated from. Whether being
 * behind *matters* depends on what changed since, so every missing commit is
 * classified by the ownership of the files it touched. A project 40 commits
 * behind on nothing but this repo's own STANDARDS.md needs no action; a
 * project 2 behind on `.github/workflows/` is the P12 case.
 */
function classifyRange(fromRef, toRef) {
  const log = run('git', ['log', '--format=%H%x00%h%x00%ad%x00%s', '--date=short', '--name-only', `${fromRef}..${toRef}`]);
  if (!log) return [];

  const commits = [];
  let current = null;
  for (const line of log.split('\n')) {
    if (line.includes('\0')) {
      const [sha, short, date, subject] = line.split('\0');
      current = { sha, short, date, subject, owners: new Set(), paths: [] };
      commits.push(current);
    } else if (line.trim() && current) {
      const projectPath = templatePathToProjectPath(line.trim());
      if (projectPath === null) {
        // A change to this repo's own files (STANDARDS.md, copier.yml, docs/).
        // copier.yml matters -- it can change what gets rendered -- but it is
        // not a path in the generated project, so it is tracked separately.
        current.owners.add(line.trim() === 'copier.yml' ? 'copier.yml' : 'template-repo');
      } else {
        current.owners.add(ownerOf(projectPath));
        current.paths.push(projectPath);
      }
    }
  }
  return commits;
}

function summarize(commits) {
  const counts = { template: 0, project: 0, shared: 0, copier: 0, 'copier.yml': 0 };
  for (const c of commits) {
    for (const key of Object.keys(counts)) if (c.owners.has(key)) counts[key] += 1;
  }
  return counts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/template-doctor.js [--org <org>] [--verbose] [--json]');
    return 0;
  }

  // Without this the comparison silently reports staleness against whatever
  // this clone last fetched, which is the one thing a staleness report must
  // not get wrong.
  const fetched = tryRun('git', ['fetch', 'origin', '--quiet']);
  if (!fetched.ok) {
    console.error(`warning: could not fetch origin, comparing against a possibly stale local ref\n  ${fetched.err}`);
  }

  const headRef = 'origin/main';
  const head = run('git', ['rev-parse', '--short', headRef]);
  const headDate = run('git', ['log', '-1', '--format=%ad', '--date=short', headRef]);
  const templateRemote = run('git', ['remote', 'get-url', 'origin'])
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/\.git$/, '');

  const repoList = tryRun('gh', ['repo', 'list', args.org, '--limit', '200', '--json', 'name']);
  if (!repoList.ok) {
    console.error(`error: could not list repos in "${args.org}" via gh\n  ${repoList.err}`);
    return 1;
  }
  const names = JSON.parse(repoList.out).map((r) => r.name).sort();

  const rows = [];
  for (const name of names) {
    const answers = tryRun('gh', [
      'api',
      `repos/${args.org}/${name}/contents/.copier-answers.yml`,
      '--jq',
      '.content',
    ]);
    // No answers file means the repo was not generated from this template
    // (or predates it). Not an error -- just not our business.
    if (!answers.ok || !answers.out) continue;

    const yaml = Buffer.from(answers.out, 'base64').toString('utf8');
    const commitMatch = yaml.match(/^_commit:\s*(\S+)/m);
    const srcMatch = yaml.match(/^_src_path:\s*(\S+)/m);
    if (!commitMatch) {
      rows.push({ name, error: '.copier-answers.yml has no _commit' });
      continue;
    }

    const ref = commitMatch[1];
    const srcPath = srcMatch ? srcMatch[1] : '(unknown)';

    const known = tryRun('git', ['cat-file', '-e', `${ref}^{commit}`]);
    if (!known.ok) {
      rows.push({
        name,
        ref,
        srcPath,
        error: `ref ${ref} is not a commit in this clone (generated from a branch since deleted, or a different template)`,
      });
      continue;
    }

    const behind = Number(run('git', ['rev-list', '--count', `${ref}..${headRef}`]));
    const refDate = run('git', ['log', '-1', '--format=%ad', '--date=short', ref]);
    const commits = behind > 0 ? classifyRange(ref, headRef) : [];
    rows.push({ name, ref, refDate, srcPath, behind, commits, counts: summarize(commits) });
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          template: { repo: templateRemote, head, headDate },
          projects: rows.map(({ commits, ...rest }) => ({
            ...rest,
            ...(args.verbose && commits ? { commits: commits.map((c) => ({ short: c.short, subject: c.subject, owners: [...c.owners] })) } : {}),
          })),
        },
        null,
        2,
      ),
    );
    return rows.some((r) => r.behind > 0 || r.error) ? 1 : 0;
  }

  console.log(`Template: ${templateRemote} @ ${head} (${headDate})`);
  console.log(`Org:      ${args.org}`);
  console.log('');

  if (rows.length === 0) {
    console.log('No generated projects found (no repo in the org carries a .copier-answers.yml).');
    return 0;
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  for (const row of rows) {
    if (row.error) {
      console.log(`${row.name.padEnd(width)}  ${(row.ref || '-').padEnd(8)}  !! ${row.error}`);
      continue;
    }
    if (row.behind === 0) {
      console.log(`${row.name.padEnd(width)}  ${row.ref.padEnd(8)}  ${row.refDate}  up to date`);
      continue;
    }
    const c = row.counts;
    const notes = [];
    if (c.template) notes.push(`${c.template} touching template-owned files`);
    if (c['copier.yml']) notes.push(`${c['copier.yml']} changing copier.yml`);
    if (c.shared) notes.push(`${c.shared} touching shared files`);
    console.log(
      `${row.name.padEnd(width)}  ${row.ref.padEnd(8)}  ${row.refDate}  ${String(row.behind).padStart(3)} behind` +
        (notes.length ? `  -- ${notes.join(', ')}` : '  -- none affecting the project'),
    );

    if (args.verbose) {
      for (const commit of row.commits) {
        const owners = [...commit.owners].filter((o) => o !== 'template-repo');
        if (owners.length === 0) continue;
        console.log(`${' '.repeat(width + 2)}  ${commit.short}  ${commit.date}  ${commit.subject}`);
        console.log(`${' '.repeat(width + 2)}            [${owners.sort().join(', ')}]`);
      }
      console.log('');
    }
  }

  const stale = rows.filter((r) => r.behind > 0);
  const urgent = rows.filter((r) => r.counts && r.counts.template > 0);
  console.log('');
  console.log(
    `${stale.length}/${rows.length} generated projects are behind; ` +
      `${urgent.length} are missing changes to template-owned files.`,
  );
  if (!args.verbose && stale.length) console.log('Re-run with --verbose to see which commits.');

  // Non-zero when anything is behind, so this can be a scheduled check that
  // actually fails rather than a report nobody reads.
  return stale.length || rows.some((r) => r.error) ? 1 : 0;
}

process.exit(main());
