// Who owns which file in a generated project.
//
// `copier update` re-applies template changes as a diff. Whether that is safe
// depends entirely on whether a human has since edited the file it is patching,
// so every path in a generated project falls into one of three buckets. The
// split is documented, with reasoning, in STANDARDS.md's "Template ownership"
// section -- this file is the executable copy of it, and the two are meant to
// be read together. Both `template-doctor.js` and `template-update.js` import
// from here so a rule can't be enforced in one and forgotten in the other.
//
// Paths below are expressed as they appear in a *generated project*, not as
// they appear under `template/` -- see `templatePathToProjectPath`.

// Pipeline infrastructure. The builder is not expected to edit these, and a
// project carrying a stale copy is the P12 failure mode: a fix that is correct,
// merged, and reaching nothing. These may be overwritten wholesale.
const TEMPLATE_OWNED = [
  '.github/workflows/**',
  '.github/actions/**',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/claude-review.yml.example',
  // Describes how the shared deploy pipeline behaves, not how this project
  // uses it. It goes stale in exactly the way a workflow does, and for the
  // same reason: the thing it documents lives in the template.
  'docs/deploy.md',
];

// The application. The builder writes all of it; the template only ever seeded
// it. An update must never overwrite these -- a conflict here means the
// template changed a file it has no business changing after generation.
const PROJECT_OWNED = [
  'backend/**',
  'frontend/**',
  'docs/decisions.md',
  'CLAUDE.md',
  'README.md',
];

// Template-shaped, but legitimately extended by the builder.
// `terraform/main.tf` is the case that forced this third bucket to exist: the
// template lays down the Lambda, the function URL and the table, and then the
// project adds its own resources to the same file. Neither "overwrite" nor
// "never touch" is right, so these are always surfaced for human review and
// never resolved automatically.
const SHARED = [
  'terraform/**',
  'docker-compose.yml',
  '.env.example',
  '.gitignore',
  'scripts/**',
];

// Copier's own bookkeeping. Not owned by either side: it is rewritten by
// `copier update` itself, and hand-editing it makes it a lie about what the
// project was generated as.
const COPIER_OWNED = ['.copier-answers.yml'];

/**
 * Minimal glob support: `**` crosses directory separators, `*` does not.
 *
 * Both are expanded in one pass rather than sequentially, because replacing
 * `*` first would corrupt any `**` already present and replacing `**` first
 * needs a placeholder to protect its output from the `*` rule.
 */
function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*+/g, (stars) => (stars.length >= 2 ? '.*' : '[^/]*'));
  return new RegExp(`^${escaped}$`);
}

const MATCHERS = [
  ['copier', COPIER_OWNED],
  ['template', TEMPLATE_OWNED],
  ['project', PROJECT_OWNED],
  ['shared', SHARED],
].map(([owner, globs]) => [owner, globs.map(globToRegExp)]);

/**
 * Translate a path as it appears under `template/` into the path it renders to
 * in a generated project.
 *
 * The template gates files by *path name* -- a directory literally called
 * `{{ 'actions' if needs_hosting else '' }}` renders to `actions` or to the
 * empty string (see copier.yml). For ownership purposes only the literal
 * matters, so the quoted string inside the conditional is pulled out; a
 * segment that renders empty collapses, exactly as Copier collapses it.
 *
 * Returns null for paths outside `template/` -- this repo's own root files
 * (STANDARDS.md, copier.yml, docs/) are not part of any generated project.
 */
function templatePathToProjectPath(templatePath) {
  if (!templatePath.startsWith('template/')) return null;
  return templatePath
    .slice('template/'.length)
    // The answers file is named by a Copier config value rather than a literal,
    // and `_copier_conf.answers_file` resolves to Copier's default because
    // copier.yml sets no `_answers_file`. Resolve it here rather than letting
    // the generic placeholder-stripping collapse it to nothing.
    .replace(/\{\{\s*_copier_conf\.answers_file\s*\}\}/g, '.copier-answers.yml')
    .split('/')
    .map((segment) =>
      segment
        .replace(/\{\{\s*'([^']*)'\s*if\s+[^}]*\}\}/g, '$1')
        .replace(/\{\{[^}]*\}\}/g, ''),
    )
    .filter((segment) => segment !== '')
    .join('/')
    .replace(/\.jinja$/, '');
}

/** 'copier' | 'template' | 'project' | 'shared' | 'unclassified' */
function ownerOf(projectPath) {
  for (const [owner, regexes] of MATCHERS) {
    if (regexes.some((re) => re.test(projectPath))) return owner;
  }
  return 'unclassified';
}

module.exports = {
  TEMPLATE_OWNED,
  PROJECT_OWNED,
  SHARED,
  COPIER_OWNED,
  templatePathToProjectPath,
  ownerOf,
};
